const Table = require("@saltcorn/data/models/table");
const MetaData = require("@saltcorn/data/models/metadata");
const { div, pre, p, small, span, button } = require("@saltcorn/markup/tags");
const { viewname, projectType } = require("./common");
const GenerateTables = require("../actions/generate-tables");
const { buildMermaidMarkup } = GenerateTables;

const PHASE_COLORS = [
  { fill: "#93c5fd", stroke: "#1e40af" },
  { fill: "#86efac", stroke: "#166534" },
  { fill: "#fcd34d", stroke: "#92400e" },
  { fill: "#d8b4fe", stroke: "#6b21a8" },
  { fill: "#f9a8d4", stroke: "#9d174d" },
  { fill: "#fdba74", stroke: "#9a3412" },
];
const NO_PHASE_COLOR = { fill: "#cbd5e1", stroke: "#334155" };

const showSchema = async (req, pt) => {
  const allTables = await Table.find({});
  const userTables = allTables.filter((t) => !t.name.startsWith("_sc_"));
  if (!userTables.length) {
    return div(
      { class: "mt-2" },
      p(
        { class: "text-muted" },
        "No tables in the database yet. Data model tasks in each phase will create them."
      )
    );
  }

  const phaseRecords = await MetaData.find({
    type: pt,
    name: "table_phase",
  });
  const tablePhaseMap = {};
  for (const r of phaseRecords) tablePhaseMap[r.body.table_name] = r.body;

  // Collect phases seen, sorted by index
  const phasesSeen = new Map();
  for (const r of phaseRecords)
    if (!phasesSeen.has(r.body.phase_idx))
      phasesSeen.set(r.body.phase_idx, r.body.phase_name);
  const orderedPhases = [...phasesSeen.entries()].sort(([a], [b]) => a - b);

  // Group table names by phase for the legend
  const phaseTableNames = new Map();
  const allUnassignedNames = [];
  for (const t of userTables) {
    const entry = tablePhaseMap[t.name];
    if (entry) {
      if (!phaseTableNames.has(entry.phase_idx))
        phaseTableNames.set(entry.phase_idx, []);
      phaseTableNames.get(entry.phase_idx).push(t.name);
    } else {
      allUnassignedNames.push(t.name);
    }
  }

  // Filter pre-existing (unassigned) tables: only show those with at least one
  // FK edge to or from a phase-assigned table. If no phase tables exist yet,
  // show everything.
  const assignedNameSet = new Set(
    userTables.filter((t) => tablePhaseMap[t.name]).map((t) => t.name)
  );
  const connectedUnassigned = new Set();
  if (assignedNameSet.size > 0) {
    for (const t of userTables) {
      const fkTargets = (t.fields || [])
        .filter((f) => f.reftable_name && !f.reftable_name.startsWith("_sc_"))
        .map((f) => f.reftable_name);
      for (const tgt of fkTargets) {
        if (assignedNameSet.has(t.name) && !assignedNameSet.has(tgt))
          connectedUnassigned.add(tgt);
        if (assignedNameSet.has(tgt) && !assignedNameSet.has(t.name))
          connectedUnassigned.add(t.name);
      }
    }
  }
  const unassignedNames =
    assignedNameSet.size === 0
      ? allUnassignedNames
      : allUnassignedNames.filter((n) => connectedUnassigned.has(n));

  // Only include unassigned tables that survived the filter in the diagram
  const diagramTables =
    assignedNameSet.size === 0
      ? userTables
      : userTables.filter(
          (t) => assignedNameSet.has(t.name) || connectedUnassigned.has(t.name)
        );

  // Pre-compute fill color per table name for the client script
  const colorMap = {};
  for (const t of userTables) {
    const entry = tablePhaseMap[t.name];
    colorMap[t.name] = entry
      ? PHASE_COLORS[entry.phase_idx % PHASE_COLORS.length]
      : NO_PHASE_COLOR;
  }

  const mmdia = buildMermaidMarkup(diagramTables);

  const tableBadge = (color, name) =>
    span(
      {
        class: "badge rounded-pill",
        style: `background:${color.fill};color:${color.stroke};border:1.5px solid ${color.stroke}`,
      },
      name
    );

  const legendGroups = [
    ...(unassignedNames.length
      ? [
          div(
            { class: "d-flex flex-wrap align-items-center gap-1" },
            span({ class: "me-1 text-muted small" }, "Pre-existing:"),
            ...unassignedNames.map((n) => tableBadge(NO_PHASE_COLOR, n))
          ),
        ]
      : []),
    ...orderedPhases
      .map(([idx, name]) => {
        const color = PHASE_COLORS[idx % PHASE_COLORS.length];
        const names = phaseTableNames.get(idx) || [];
        if (!names.length) return null;
        return div(
          { class: "d-flex flex-wrap align-items-center gap-1" },
          span(
            { class: "me-1 text-muted small" },
            `Phase ${idx + 1}${name ? `: ${name}` : ""}:`
          ),
          ...names.map((n) => tableBadge(color, n))
        );
      })
      .filter(Boolean),
  ];

  const controls = div(
    { class: "d-flex gap-1 mb-2 align-items-center" },
    button(
      {
        type: "button",
        class: "btn btn-sm btn-outline-secondary",
        onclick: "schemaHelper.zoom(0.15)",
        title: "Zoom in",
      },
      "+"
    ),
    button(
      {
        type: "button",
        class: "btn btn-sm btn-outline-secondary",
        onclick: "schemaHelper.zoom(-0.15)",
        title: "Zoom out",
      },
      "−"
    ),
    button(
      {
        type: "button",
        class: "btn btn-sm btn-outline-secondary",
        onclick: "schemaHelper.reset()",
        title: "Reset view",
      },
      "⊙"
    ),
    small({ class: "text-muted ms-1" }, "Scroll to zoom · Drag to pan")
  );

  return div(
    { class: "mt-2" },
    `<style>
      #schema-list-area .label.name .nodeLabel p,
      #schema-list-area .label.name .nodeLabel {
        font-weight: 700 !important;
        color: #000 !important;
      }
    </style>`,
    small(
      { class: "text-muted d-block mb-2" },
      `${userTables.length} table${
        userTables.length !== 1 ? "s" : ""
      } — reflects current database state`
    ),
    controls,
    div(
      {
        id: "schema-diagram-wrapper",
        style:
          "overflow:hidden;cursor:grab;border:1px solid #dee2e6;border-radius:4px;background:#fff;height:600px;color-scheme:light",
      },
      pre(
        {
          class: "schema-mermaid",
          "data-color-map": JSON.stringify(colorMap),
          style: "overflow:visible;margin:0;",
        },
        mmdia
      )
    ),
    legendGroups.length
      ? div({ class: "d-flex flex-column gap-2 mt-2" }, ...legendGroups)
      : ""
  );
};

const schema_list_html = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const pt = projectType(body.project_id ?? req.query?.project_id);
  const html = await showSchema(req, pt);
  return { json: { html } };
};

const schema_routes = {
  schema_list_html,
};

const schemaStaticScript = `<script>
(function(){
  const _schemVn = ${JSON.stringify(viewname)};

  // Ensure mermaid won't auto-process on its own — we drive rendering manually
  if (typeof mermaid !== 'undefined') {
    try { mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' }); } catch (_) {}
  }

  // ── Zoom/pan helper ──────────────────────────────────────────────────────────
  let _tx = 0, _ty = 0, _scale = 1.0, _mouseDown = false;

  const _getSvg = () => document.querySelector('#schema-list-area svg');
  const _applyTransform = () => {
    const svg = _getSvg();
    if (svg) svg.style.transform = 'translateX(' + _tx + 'px) translateY(' + _ty + 'px) scale(' + _scale + ')';
  };
  window.schemaHelper = {
    zoom: (val) => {
      _scale = Math.min(20, Math.max(0.1, _scale + val));
      _applyTransform();
    },
    translateX: (val) => { _tx += val; _applyTransform(); },
    translateY: (val) => { _ty += val; _applyTransform(); },
    reset: () => { _tx = 0; _ty = 0; _scale = 1.0; _applyTransform(); },
  };

  const _onWheel = (e) => { e.preventDefault(); schemaHelper.zoom(-0.001 * e.deltaY); };
  const _onMouseDown = () => { _mouseDown = true; };
  const _onMouseUp = () => { _mouseDown = false; };
  const _onMouseMove = (e) => {
    if (_mouseDown) {
      document.getSelection().removeAllRanges();
      schemaHelper.translateX(e.movementX);
      schemaHelper.translateY(e.movementY);
    }
  };

  const _wireEvents = () => {
    const wrapper = document.getElementById('schema-diagram-wrapper');
    if (!wrapper || wrapper._schemaEventsWired) return;
    wrapper._schemaEventsWired = true;
    wrapper.addEventListener('wheel', _onWheel, { passive: false });
    wrapper.addEventListener('mousedown', _onMouseDown);
    wrapper.addEventListener('mouseup', _onMouseUp);
    window.addEventListener('mousemove', _onMouseMove);
    wrapper.addEventListener('mouseleave', _onMouseUp);
  };
  // ── End zoom/pan helper ──────────────────────────────────────────────────────

  function applyColors(el, colorMap) {
    for (const g of el.querySelectorAll('g[id^="entity-"]')) {
      const name = g.id.replace(/^entity-/, '').replace(/-\\d+$/, '');
      const colors = colorMap[name];
      if (!colors) continue;
      const path = g.querySelector('path');
      if (path) {
        path.style.fill = colors.fill;
        path.style.stroke = colors.stroke;
      }
    }
    for (const node of el.querySelectorAll('g.label.name .nodeLabel, g.label.name .nodeLabel p')) {
      node.style.color = '#000';
      node.style.fontWeight = '700';
    }
  }

  window.copilotRenderSchemaMermaid = () => {
    const pre = document.querySelector('#schema-list-area .schema-mermaid');
    if (!pre || typeof mermaid === 'undefined') return;
    const colorMap = pre.dataset.colorMap ? JSON.parse(pre.dataset.colorMap) : {};
    const mermaidText = pre.textContent.trim();
    if (!mermaidText) return;

    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
    tmp.textContent = mermaidText;
    document.body.appendChild(tmp);

    mermaid.run({ nodes: [tmp], suppressErrors: true })
      .then(() => {
        const target = document.querySelector('#schema-list-area .schema-mermaid');
        if (target) {
          target.innerHTML = tmp.innerHTML;
          applyColors(target, colorMap);
          _applyTransform();
          _wireEvents();
        }
        tmp.remove();
      })
      .catch(e => {
        console.warn('mermaid schema render error', e);
        tmp.remove();
      });
  };

  window.copilotRefreshSchema = function() {
    view_post(_schemVn, 'schema_list_html', {}, (r) => {
      const el = document.getElementById('schema-list-area');
      if (r && r.html && el) {
        el.innerHTML = r.html;
        schemaHelper.reset();
        copilotRenderSchemaMermaid();
      }
    });
  };

  if (document.readyState !== 'loading') copilotRenderSchemaMermaid();
  else document.addEventListener('DOMContentLoaded', copilotRenderSchemaMermaid);
})()
</script>`;

module.exports = { showSchema, schema_routes, schemaStaticScript };
