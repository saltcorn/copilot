const { RelationsFinder, RelationType } = require("@saltcorn/common-code");

/**
 * Relation path documentation included in LLM system prompts (viewgen, builder-gen).
 *
 * TWO FORMATS EXIST:
 *
 * New format (always generate this):
 *   view: "viewname"  +  relation: ".sourcetable.segment1.segment2..."
 *
 *   Segment types:
 *     Outbound FK (to parent):    FK field name alone,         e.g. trip_id
 *     Inbound FK  (child rows):   childtable$fkfield,          e.g. packing_items$trip_id
 *
 *   Examples:
 *     .trips.packing_items$trip_id            ChildList:    all packing_items for a trip
 *     .packing_items.trip_id                  ParentShow:   the trip that owns a packing item
 *     .artists.artist_plays_on_album$artist.album  ChildList through a join table
 *     .users.orders$user_id.order_lines$order_id   RelationPath: multi-level
 *
 * Legacy format (may appear in existing configs — do not generate, understand only):
 *   The type and path are encoded together in the view field, no separate relation field.
 *     "Own:viewname"                     → same table, no relation
 *     "ParentShow:viewname.table.fkfield" → outbound FK to parent
 *     "ChildList:viewname.table.inbkey"  → inbound FK, one-to-many
 *     "OneToOneShow:viewname.table.inbkey" → inbound FK, unique
 *     "Independent:viewname"             → no FK relationship
 *
 * Relation types by new-format path structure:
 *   Own          – zero segments, source and target are the same table
 *   ParentShow   – single outbound-FK segment
 *   OneToOneShow – single inbound-FK segment on a unique field
 *   ChildList    – one or more inbound-FK segments (may mix outbound for join tables)
 *   RelationPath – complex multi-level path mixing both segment types
 */
const RELATION_PATH_DOC = `
## Relation paths

Every view_link and embedded view segment requires two fields:
- \`view\`: the view name (plain string, e.g. \`"packing_items_list"\`)
- \`relation\`: a dot-separated path string (e.g. \`".trips.packing_items$trip_id"\`)

**Always use this format. Never generate anything else.**

---

### Relation path format

\`.sourcetable.segment1.segment2...\`

Segment types:
- **Outbound FK** (to a parent): FK field name alone — e.g. \`trip_id\`
- **Inbound FK** (child rows): \`childtable$fkfield\` — e.g. \`packing_items$trip_id\`
- **Same table** (no FK traversal): just the source table, no segments — e.g. \`".invoice_line_items"\`

Examples:
| relation string | meaning |
|---|---|
| \`.invoice_line_items\` | same-table link (no FK traversal) |
| \`.trips.packing_items$trip_id\` | all packing_items for a trip |
| \`.packing_items.trip_id\` | the trip that owns a packing_item |
| \`.artists.artist_plays_on_album$artist.album\` | albums via join table |
| \`.users.orders$user_id.order_lines$order_id\` | multi-level |

---

### Legacy format — read-only, never generate

Any \`view\` field value that contains a colon (e.g. \`"ChildList:trips_list.packing_items.trip_id"\`,
\`"Own:viewname"\`, \`"ParentShow:viewname.table.fkfield"\`) is legacy. You may encounter it in
existing configs. Parse it to understand the relation, then always write back in the new format.

| legacy view field | new format equivalent |
|---|---|
| \`"Own:viewname"\` | \`relation: ".sourcetable"\` |
| \`"Independent:viewname"\` | no \`relation\` field needed |
| \`"ParentShow:viewname.table.fkfield"\` | \`relation: ".sourcetable.fkfield"\` |
| \`"ChildList:viewname.table.inbkey"\` | \`relation: ".sourcetable.childtable$inbkey"\` |
| \`"OneToOneShow:viewname.table.inbkey"\` | \`relation: ".sourcetable.childtable$inbkey"\` |

---

### Using get_relation_paths

Call it **once** with all source_table/target_view pairs you need. The tool always returns new-format
path strings — use them as the \`relation\` field directly.

**Depth escalation:** Start with \`max_depth=2\`. After receiving results, analyse each pair: does the
result contain a path that matches the intended relation type? If yes, use it. If a pair has no
suitable path (no paths at all, or none of the right type), call again with \`max_depth=4\`, then
\`max_depth=6\` if still none. Do not escalate just because multiple paths are listed.

Selecting among returned paths:
- **ChildList** — target view shows multiple rows belonging to the current row.
- **ParentShow** — target view shows the single parent the current row belongs to.
- **OneToOneShow** — exactly one related child row via a unique FK.
- **Own** — same table, no FK traversal. Relation string is just \`.sourcetable\`.
- If multiple paths of the same type exist, pick the one whose FK field name best matches the task.
- Prefer shorter paths (fewer segments) unless a longer one is clearly more appropriate.
`;

const typeToLabel = (type) => {
  if (type === RelationType.OWN)
    return "Own – source and target are the same table. Use this relation string as-is (no extra segments after the table name).";
  if (type === RelationType.INDEPENDENT)
    return "Independent – no FK relationship exists";
  if (type === RelationType.PARENT_SHOW)
    return "ParentShow – outbound FK to a parent record (many-to-one)";
  if (type === RelationType.ONE_TO_ONE_SHOW)
    return "OneToOneShow – unique inbound FK (one-to-one)";
  if (type === RelationType.CHILD_LIST)
    return "ChildList – inbound FK, one parent → many child rows";
  return "RelationPath – complex multi-level path";
};

/**
 * @param {string} sourceTableName
 * @param {string} targetViewName
 * @param {{ tables, views }} schemaData  pre-fetched via build_schema_data()
 * @returns {Array<Relation>}  raw Relation objects from RelationsFinder
 */
function getRelationPaths(
  sourceTableName,
  targetViewName,
  schemaData,
  maxDepth = 6
) {
  if (!schemaData) return [];
  try {
    const finder = new RelationsFinder(
      schemaData.tables,
      schemaData.views,
      maxDepth
    );
    return finder.findRelations(sourceTableName, targetViewName, []);
  } catch {
    return [];
  }
}

/**
 * Resolve multiple source_table/target_view pairs against pre-fetched schema data.
 * All per-pair work is synchronous — call build_schema_data() once before invoking this.
 * @param {Array<{source_table: string, target_view: string}>} pairs
 * @param {{ tables, views }} schemaData
 * @returns {Array<string>}  one formatted result string per pair
 */
function getRelationPathsForPairs(pairs, schemaData, maxDepth = 6) {
  if (!schemaData)
    return pairs.map(({ source_table, target_view }) =>
      formatRelationPathResult(source_table, target_view, {
        error: "Schema data unavailable",
      })
    );
  const finder = new RelationsFinder(
    schemaData.tables,
    schemaData.views,
    maxDepth
  );
  return pairs.map(({ source_table, target_view }) => {
    const targetView = (schemaData.views || []).find(
      (v) => v.name === target_view
    );
    if (!targetView)
      return formatRelationPathResult(source_table, target_view, {
        error: `View "${target_view}" not found in current schema`,
      });
    let relations;
    try {
      relations = finder.findRelations(source_table, target_view, []);
    } catch (e) {
      return formatRelationPathResult(source_table, target_view, {
        error: `Failed to find relations: ${e.message}`,
      });
    }
    return formatRelationPathResult(source_table, target_view, {
      paths: relations.map((r) => ({
        relation_string: r.relationString,
        type: String(r.type),
        label: typeToLabel(r.type),
      })),
    });
  });
}

/**
 * Pick the most useful relation from a list: Own > Parent > Child > first.
 * Used as a fallback in builder-gen when the model doesn't specify a relation.
 */
function pickBestRelation(relations) {
  if (!relations.length) return null;
  let own = null,
    parent = null,
    child = null;
  for (const r of relations) {
    if (r.type === RelationType.OWN) own = r;
    else if (r.type === RelationType.PARENT_SHOW) parent = r;
    else if (
      r.type === RelationType.CHILD_LIST ||
      r.type === RelationType.ONE_TO_ONE_SHOW
    )
      child = r;
  }
  return own || parent || child || relations[0];
}

/**
 * Format the result of getRelationPaths into a human-readable string for the model.
 * Handles both found and not-found cases for one source_table/target_view pair.
 */
function formatRelationPathResult(source_table, target_view, result) {
  if (result.error) return `${source_table} → ${target_view}: ${result.error}`;
  if (!result.paths.length)
    return `${source_table} → ${target_view}: no relation paths found (no FK relationship)`;
  const lines = result.paths
    .map((p) => `    "${p.relation_string}" — ${p.label}`)
    .join("\n");
  return `${source_table} → ${target_view}:\n${lines}`;
}

const GET_RELATION_PATHS_FUNCTION = {
  name: "get_relation_paths",
  description:
    "Get all valid relation path strings for one or more source_table/target_view pairs. " +
    "Call this before setting any 'relation' property on view_link columns or embedded view segments. " +
    "Always start with max_depth=2 to keep the result compact. " +
    "After receiving the results, analyse whether each pair has a suitable path for its intended relation type. " +
    "If a pair has no suitable path, call again with max_depth=4, then max_depth=6 if still none. " +
    "Stop as soon as every pair has a suitable path.",
  parameters: {
    type: "object",
    required: ["pairs"],
    properties: {
      pairs: {
        type: "array",
        description:
          "All source_table/target_view pairs you need relation paths for. Include every pair in one call.",
        items: {
          type: "object",
          required: ["source_table", "target_view"],
          properties: {
            source_table: {
              type: "string",
              description: "The table of the view being built or updated.",
            },
            target_view: {
              type: "string",
              description: "The view to link to or embed.",
            },
          },
        },
      },
      max_depth: {
        type: "integer",
        description:
          "Maximum join depth to search. Start with 2. Escalate to 4, then 6, only if a pair has no suitable path in the current results — not just because paths exist, but because none match the intended relation type.",
        default: 2,
      },
    },
  },
};

module.exports = {
  RELATION_PATH_DOC,
  GET_RELATION_PATHS_FUNCTION,
  getRelationPaths,
  getRelationPathsForPairs,
  pickBestRelation,
};
