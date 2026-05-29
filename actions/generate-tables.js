const { getState } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const Field = require("@saltcorn/data/models/field");
const { apply, removeAllWhiteSpace } = require("@saltcorn/data/utils");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");
const { a, pre, script, div, domReady } = require("@saltcorn/markup/tags");
const { fieldProperties } = require("../common");

class GenerateTables {
  static title = "Generate Tables";
  static function_name = "generate_tables";
  static description = "Generate or update database tables";

  static field_type_config_schema() {
    const types = Object.values(getState().types);
    const fieldTypeCfg = types.map((ty) => {
      const properties = {
        data_type: { type: "string", enum: [ty.name] },
      };
      const attrs = apply(ty.attributes, {}) || [];
      if (Array.isArray(attrs))
        attrs.forEach((a) => {
          properties[a.name] = {
            description:
              a.copilot_description ||
              `${a.label}.${a.sublabel ? ` ${a.sublabel}` : ""}`,
            ...fieldProperties(a),
          };
        });
      return {
        type: "object",
        description: ty.copilot_description || ty.description,
        properties,
      };
    });
    fieldTypeCfg.push({
      type: "object",
      description:
        "A foreign key to a different table. This will reference the primary key on another table.",
      properties: {
        data_type: { type: "string", enum: ["ForeignKey"] },
        reference_table: {
          type: "string",
          description: "Name of the table being referenced",
        },
      },
    });
    fieldTypeCfg.push({
      type: "object",
      description:
        "A reference (file path) to a file on disk. This can be used for example to hold images or documents",
      properties: {
        data_type: { type: "string", enum: ["File"] },
      },
    });
    return fieldTypeCfg;
  }

  static field_item_schema() {
    const fieldTypeCfg = this.field_type_config_schema();
    return {
      type: "object",
      required: ["name", "label", "type_and_configuration", "importance"],
      properties: {
        name: {
          type: "string",
          description:
            "The field name. Must be a valid identifier in both SQL and JavaScript, all lower case, snake_case (underscore instead of spaces)",
        },
        label: {
          type: "string",
          description:
            "A human-readable label for the field. Should be short, 1-4 words, can have spaces and mixed case.",
        },
        not_null: {
          type: "boolean",
          description:
            "A value is required and the field will be NOT NULL in the database",
        },
        unique: {
          type: "boolean",
          description:
            "The value is unique - different rows must have different values for this field",
        },
        type_and_configuration: { anyOf: fieldTypeCfg },
        importance: {
          type: "number",
          description:
            "How important is this field if only some fields can be displayed to the user. From 1 (least important) to 10 (most important).",
        },
        calculated: {
          type: "boolean",
          description:
            "Whether this is a calculated field. Calculated fields derive their value from a JavaScript expression rather than being entered directly. Set to true to make this a calculated field, then provide expression. Use stored=false for virtual fields computed on-the-fly, or stored=true for materialized fields persisted in the database. Do NOT use calculated=true for child-table aggregations (counts, sums) — use aggregation=true instead.",
        },
        stored: {
          type: "boolean",
          description:
            "For calculated fields only: true means the value is stored/materialized in the database; false (default) means computed on-the-fly. Stored calculated fields support joinfield syntax in expressions. Only set when calculated=true.",
        },
        expression: {
          type: "string",
          description:
            "For calculated fields: a JavaScript expression returning the field value. References other fields in the same row by name (e.g. 'price * quantity'). For stored calculated fields, use joinfield syntax to access related-table fields: 'foreignKeyField.targetField' (e.g. 'author_id.full_name') or two-level: 'fkField.throughFkField.deepField'. Only set when calculated=true. Do NOT use this for child-table aggregations — use aggregation=true instead.",
        },
        aggregation: {
          type: "boolean",
          description:
            "Set to true to create a stored aggregation field that counts or sums child-table records. Use this for any field that counts or aggregates rows from a child table (e.g. counting packing items, summing quantities). When aggregation=true, also set aggregate_function, child_table, child_fk_field, aggregate_field, and optionally aggregate_where. Do not set calculated or expression when using aggregation.",
        },
        aggregate_function: {
          type: "string",
          enum: ["Count", "Sum", "Avg", "CountUnique", "Max", "Min"],
          description:
            "Aggregation function to apply. Use 'Count' to count rows, 'Sum' to sum a numeric field. Only set when aggregation=true.",
        },
        child_table: {
          type: "string",
          description:
            "Name of the child table whose rows are aggregated. Only set when aggregation=true.",
        },
        child_fk_field: {
          type: "string",
          description:
            "Name of the foreign-key field on the child table that references this (parent) table. Only set when aggregation=true.",
        },
        aggregate_field: {
          type: "string",
          description:
            "Field on the child table to aggregate. For Count use 'id'. For Sum/Avg/Max/Min use the numeric field name. Only set when aggregation=true.",
        },
        aggregate_where: {
          type: "string",
          description:
            "Optional JavaScript expression to filter which child rows are included, evaluated in the context of a child row. Examples: 'completed' (boolean field is true), 'status === \"done\"'. Only set when aggregation=true and a subset of child rows is needed.",
        },
      },
    };
  }

  static json_schema() {
    return {
      type: "object",
      required: ["tables"],
      properties: {
        tables: {
          type: "array",
          items: {
            type: "object",
            required: ["table_name", "fields"],
            properties: {
              table_name: {
                type: "string",
                description: "The name of the table",
              },
              description: {
                type: "string",
                description:
                  "A short human-readable description of what this table stores and its role in the application",
              },
              fields: {
                type: "array",
                items: this.field_item_schema(),
              },
            },
          },
        },
        reused_table_names: {
          type: "array",
          items: { type: "string" },
          description:
            "Names of existing tables that are already complete and require no changes. " +
            "List them here so the caller knows which tables were reused as-is. Do NOT repeat their field definitions in the tables array.",
        },
      },
    };
  }

  static async system_prompt() {
    const tableLines = [];
    const tables = await Table.find({});
    tables.forEach((table) => {
      const fieldLines = table.fields.map((f) => {
        const virtualTag =
          f.calculated && !f.stored ? " (virtual, read-only)" : "";
        return `  * ${f.name} with type: ${f.pretty_type.replace(
          "Key to",
          "ForeignKey referencing"
        )}${virtualTag}.${f.description ? ` ${f.description}` : ""}`;
      });
      tableLines.push(
        `${table.name}${
          table.description ? `: ${table.description}.` : "."
        } Contains the following fields:\n${fieldLines.join("\n")}`
      );
    });
    return `Use the generate_tables tool to create new database tables or to add/update fields on existing ones.

    Do not call generate_tables more than once. Use a single call even when working with multiple
    tables. Include all tables — new and existing — in that one call.

    The argument to generate_tables is an array of tables, each with an array of fields. You do not
    need to specify a primary key; a primary key called id with auto-incrementing integers is
    automatically generated.

    ## New vs existing tables

    If a table does not yet exist it will be created with all the specified fields.

    If a table already exists, include it in the generate_tables call anyway with the fields you
    want to add or update. The system will automatically add new fields and update the settings of
    existing fields — it will not recreate or drop the table.

    ## Reused tables

    If an existing table is used by the application as-is (no new fields needed), do NOT repeat it
    in the tables array. Instead, add its name to the reused_table_names array. This tells the
    system to include it in the schema diagram without attempting to modify it.

    If a user requests creating a table with certain fields and the table already exists, automatically add any missing fields to that table. Do not ask the user for confirmation or prompt them again—just proceed with the table update.

    If a table has a ForeignKey field that references another table which does not yet exist in the
    database, include that referenced table in the same generate_tables call. Infer reasonable
    fields for it from context.

    ## Calculated fields

    Use calculated fields when the value should be derived from an expression rather than entered
    directly. Set calculated=true and provide an expression (a JavaScript expression evaluated in
    the context of the row — field names are available as variables).

    Examples: 'price * quantity', 'first_name + " " + last_name', 'year - birth_year'

    Choose between stored and non-stored:
    - stored=false (default): value computed on-the-fly; no database column created.
      Good for simple derivations from fields in the same table.
    - stored=true: value persisted in the database and updated on writes. Required if you need to
      sort/filter by the calculated value or if the expression references joined (related) tables.

    For stored calculated fields, joinfield syntax lets expressions reference related-table fields:
    - Single join: 'foreignKeyField.targetField'  (e.g. 'author_id.full_name')
    - Two-level join: 'fkField.throughFkField.deepField'  (e.g. 'order_id.customer_id.country')

    ## Aggregation fields

    For fields that count or aggregate rows from a child table (e.g. counting related records),
    use aggregation=true instead of calculated=true. Aggregation fields are always stored.

    Required properties when aggregation=true:
    - aggregate_function: 'Count', 'Sum', 'Avg', 'CountUnique', 'Max', or 'Min'
    - child_table: name of the child table
    - child_fk_field: name of the FK field on the child table pointing back to this table
    - aggregate_field: field on the child table to aggregate ('id' for Count)
    - aggregate_where: (optional) JS expression to filter child rows, e.g. 'completed' to count
      only rows where completed=true

    Example — count completed packing items for a trip:
    { name: 'packed_count', label: 'Packed Count', type_and_configuration: {data_type: 'Integer'},
      aggregation: true, aggregate_function: 'Count', child_table: 'packing_items',
      child_fk_field: 'trip_id', aggregate_field: 'id', aggregate_where: 'completed' }

    Do NOT use calculated=true with a hand-written expression for child-table counts — the
    expression has no access to child rows and will always return 0.

    The type_and_configuration.data_type for a calculated field should reflect the return type of
    the expression (e.g. Integer, Float, String, Bool).

    ## Table descriptions

    Every table you define MUST include a description — a short sentence explaining what
    the table stores and its role in the application. This description is shown in
    subsequent prompts to give the planner context about the schema, so make it
    informative (e.g. "Stores billable time entries logged by lawyers against a project").

    ## Bulk data import and export

    Do NOT create tables whose purpose is to trigger a bulk import or export (e.g. a
    table with a File field that a user fills in via an Edit view to start an import).
    Bulk import and export is a UI concern — there are plugins that provide dedicated
    viewtemplates operating directly on the target table, which is a much better
    solution than a workaround table with a file field and an Edit view.

    A tracking table that records the status and outcome of an automated import or
    export process (e.g. import_jobs) is acceptable, but only if the table is populated
    automatically by the process — not filled in manually by a user. Such tables must
    have a description that clearly says they are auto-populated and must not be edited
    by hand (e.g. "Auto-populated by the import process. Records status and errors for
    each import run. Not editable by users.").

    ## Existing tables

    The database already contains the following tables:

    ${tableLines.join("\n\n")}

    `;
  }

  static render_html({ tables }, delay) {
    const sctables = this.process_tables(tables);
    const mmdia = buildMermaidMarkup(sctables);
    if (delay === true) {
      return pre({ class: "mermaid", "mm-src": mmdia });
    }
    return (
      pre({ class: "mermaid" }, mmdia) +
      script(
        domReady(`
        ensure_script_loaded("/static_assets/"+_sc_version_tag+"/mermaid.min.js", () => {
          mermaid.initialize({ startOnLoad: false });
          mermaid.run({ querySelector: ".mermaid" });
        });
      `)
      )
    );
  }

  static async execute({ tables }, req) {
    const existingDbTables = await Table.find({});
    const sctables = this.process_tables(tables, existingDbTables);
    for (const table of sctables)
      await Table.create(table.name, { description: table.description || "" });
    for (const table of sctables) {
      for (const field of table.fields) {
        field.table = Table.findOne({ name: table.name });
        await Field.create(field);
      }
    }
    Trigger.emitEvent("AppChange", `Tables created`, req?.user, {
      entity_type: "Table",
      entity_names: sctables.map((t) => t.name),
    });
  }

  static async execute_add_or_update_fields({ table_name, fields }, req) {
    const table = Table.findOne({ name: table_name });
    if (!table) throw new Error(`Table "${table_name}" not found`);

    const existingFieldMap = new Map();
    (table.fields || []).forEach((f) => {
      if (f?.name) existingFieldMap.set(f.name.toLowerCase(), f);
    });

    const sanitized = Array.isArray(fields)
      ? fields.filter((f) => (f?.name || "").toLowerCase() !== "id")
      : [];

    const added = [];
    const updated = [];

    const existingDbTables = await Table.find({});
    for (const f of sanitized) {
      const fname = (f?.name || "").toLowerCase();
      if (!fname) continue;
      const processed = this.process_field(f, [], existingDbTables);
      const existing = existingFieldMap.get(fname);
      if (!existing) {
        processed.table = table;
        await Field.create(processed);
        added.push(f.name);
      } else {
        // Only update non-structural properties; skip if type would change
        const existingType = existing.type?.name ?? existing.type;
        if (existingType === processed.type) {
          const fieldUpdates = {
            label: f.label,
            attributes: processed.attributes,
          };
          if (f.calculated !== undefined)
            fieldUpdates.calculated = !!f.calculated;
          if (f.stored !== undefined) fieldUpdates.stored = !!f.stored;
          if (f.expression !== undefined)
            fieldUpdates.expression = f.expression;
          await db.update("_sc_fields", fieldUpdates, existing.id);
          updated.push(f.name);
        }
      }
    }

    Trigger.emitEvent(
      "AppChange",
      `Fields updated on ${table_name}`,
      req?.user,
      { entity_type: "Table", entity_names: [table_name] }
    );
    return { added, updated };
  }

  static process_field(f, allTablesList = [], dbTables = []) {
    if (f.aggregation) {
      const { data_type } = f.type_and_configuration || {
        data_type: "Integer",
      };
      return {
        name: f.name,
        label: f.label,
        type: data_type,
        calculated: true,
        stored: true,
        expression: "__aggregation",
        attributes: {
          aggregate: f.aggregate_function || "Count",
          agg_field: `${f.aggregate_field || "id"}@${data_type}`,
          agg_relation: `${f.child_table}.${f.child_fk_field}`,
          table: f.child_table,
          ref: f.child_fk_field,
          aggwhere: f.aggregate_where || "",
          importance: f.importance,
        },
      };
    }

    const { data_type, reference_table, ...attributes } =
      f.type_and_configuration || { data_type: "String" };
    let type = data_type;
    const scattributes = { ...attributes, importance: f.importance };
    if (!scattributes.min_length) delete scattributes.min_length;
    if (!scattributes.max_length) delete scattributes.max_length;
    if (data_type === "ForeignKey") {
      type = `Key to ${reference_table}`;
      const refTableHere = allTablesList.find(
        (t) => t.table_name === reference_table
      );
      if (refTableHere) {
        const strFields = (refTableHere.fields || []).filter(
          (rf) => rf.type_and_configuration?.data_type === "String"
        );
        if (strFields.length) {
          const maxImp = strFields.reduce((prev, current) =>
            prev && prev.importance > current.importance ? prev : current
          );
          if (maxImp) scattributes.summary_field = maxImp.name;
        }
      } else if (reference_table === "users") {
        scattributes.summary_field = "email";
      } else {
        const dbTable = dbTables.find((t) => t.name === reference_table);
        if (dbTable) {
          const strFields = (dbTable.fields || []).filter(
            (rf) => rf.type?.name === "String" || rf.type === "String"
          );
          if (strFields.length) {
            const maxImp = strFields.reduce((prev, curr) => {
              const pi = prev?.attributes?.importance ?? 0;
              const ci = curr?.attributes?.importance ?? 0;
              return pi >= ci ? prev : curr;
            });
            scattributes.summary_field = maxImp.name;
          }
        }
      }
    }
    return {
      ...f,
      type,
      required: f.not_null,
      calculated: f.calculated || false,
      stored: f.stored || false,
      expression: f.expression,
      attributes: scattributes,
    };
  }

  static process_tables(tables, dbTables = []) {
    return tables.map((table) => {
      const sanitizedFields = Array.isArray(table.fields)
        ? table.fields.filter((f) => (f?.name || "").toLowerCase() !== "id")
        : [];
      return new Table({
        name: table.table_name,
        description: table.description || "",
        fields: sanitizedFields.map((f) =>
          this.process_field(f, tables, dbTables)
        ),
      });
    });
  }
}

const EOL = "\n";
const indentString = (str, indent) => `${" ".repeat(indent)}${str}`;

const srcCardinality = (field) => (field.required ? "||" : "|o");

const buildTableMarkup = (table) => {
  const fields = table.getFields();
  const members = fields
    // .filter((f) => !f.reftable_name)
    .map((f) =>
      indentString(`${removeAllWhiteSpace(f.type_name)} ${f.name}`, 6)
    )
    .join(EOL);
  const keys = table
    .getForeignKeys()
    .map((f) =>
      indentString(
        `"${table.name}"${srcCardinality(f)}--|| "${f.reftable_name}" : "${
          f.name
        }"`,
        2
      )
    )
    .join(EOL);
  return `${keys}
  "${table.name}" {${EOL}${members}${EOL}  }`;
};

const buildMermaidMarkup = (tables) => {
  const lines = tables.map((table) => buildTableMarkup(table)).join(EOL);
  return `${indentString("erDiagram", 2)}${EOL}${lines}`;
};

module.exports = GenerateTables;
module.exports.buildMermaidMarkup = buildMermaidMarkup;

/* todo

- tag
- generate descriptions
- generate views

*/
