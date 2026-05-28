const Table = require("@saltcorn/data/models/table");
const MetaData = require("@saltcorn/data/models/metadata");
const { div, pre, p, small, span } = require("@saltcorn/markup/tags");
const { viewname } = require("./common");
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

const showSchema = async (req) => {
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
    type: "CopilotConstructMgr",
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
  const unassignedNames = [];
  for (const t of userTables) {
    const entry = tablePhaseMap[t.name];
    if (entry) {
      if (!phaseTableNames.has(entry.phase_idx))
        phaseTableNames.set(entry.phase_idx, []);
      phaseTableNames.get(entry.phase_idx).push(t.name);
    } else {
      unassignedNames.push(t.name);
    }
  }

  // Pre-compute fill color per table name for the client script
  const colorMap = {};
  for (const t of userTables) {
    const entry = tablePhaseMap[t.name];
    colorMap[t.name] = entry
      ? PHASE_COLORS[entry.phase_idx % PHASE_COLORS.length]
      : NO_PHASE_COLOR;
  }

  const mmdia = buildMermaidMarkup(userTables);

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

  return div(
    { class: "mt-2" },
    small(
      { class: "text-muted d-block mb-2" },
      `${userTables.length} table${
        userTables.length !== 1 ? "s" : ""
      } — reflects current database state`
    ),
    pre(
      {
        class: "schema-mermaid",
        "data-color-map": JSON.stringify(colorMap),
      },
      mmdia
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
  const html = await showSchema(req);
  return { json: { html } };
};

const schema_routes = {
  schema_list_html,
};

const schemaStaticScript = `<script>
(function(){
  const _schemVn = ${JSON.stringify(viewname)};

  function applyColors(pre, colorMap) {
    for (const g of pre.querySelectorAll('g[id^="entity-"]')) {
      const name = g.id.replace(/^entity-/, '').replace(/-\\d+$/, '');
      const colors = colorMap[name];
      if (!colors) continue;
      const path = g.querySelector('path');
      if (path) {
        path.style.fill = colors.fill;
        path.style.stroke = colors.stroke;
      }
    }
  }

  let _schemaPending = null;
  function _cancelSchemaPending() {
    if (!_schemaPending) return;
    const { link, handler, observer } = _schemaPending;
    if (link) link.removeEventListener('shown.bs.tab', handler);
    if (observer) observer.disconnect();
    _schemaPending = null;
  }

  window.copilotRenderSchemaMermaid = () => {
    _cancelSchemaPending();
    const pre = document.querySelector('#schema-list-area .schema-mermaid');
    if (!pre) return;
    const colorMap = pre.dataset.colorMap ? JSON.parse(pre.dataset.colorMap) : {};
    const doRender = () => {
      _schemaPending = null;
      const result = mermaid.run({
        nodes: [pre],
        suppressErrors: true,
        postRenderCallback: () => applyColors(pre, colorMap),
      });
      if (result && typeof result.then === 'function')
        result.then(() => applyColors(pre, colorMap));
      else if (!result)
        setTimeout(() => applyColors(pre, colorMap), 200);
    };
    const pane = pre.closest('.tab-pane');
    if (pane && !pane.classList.contains('active')) {
      // Saltcorn tabs use href="#TabName", not data-bs-target
      const link = document.querySelector(
        '[data-bs-target="#' + pane.id + '"], a[href="#' + pane.id + '"]'
      );
      if (link) {
        const handler = () => { _schemaPending = null; doRender(); };
        _schemaPending = { link, handler, observer: null };
        link.addEventListener('shown.bs.tab', handler, { once: true });
      } else {
        const o = new MutationObserver(() => {
          if (pane.classList.contains('active')) { o.disconnect(); _schemaPending = null; doRender(); }
        });
        _schemaPending = { link: null, handler: null, observer: o };
        o.observe(pane, { attributes: true, attributeFilter: ['class'] });
      }
    } else doRender();
  };

  window.copilotRefreshSchema = function() {
    view_post(_schemVn, 'schema_list_html', {}, (r) => {
      const el = document.getElementById('schema-list-area');
      if (r && r.html && el) {
        el.innerHTML = r.html;
        copilotRenderSchemaMermaid();
      }
    });
  };

  if (document.readyState !== 'loading') copilotRenderSchemaMermaid();
  else document.addEventListener('DOMContentLoaded', copilotRenderSchemaMermaid);
})()
</script>`;

module.exports = { showSchema, schema_routes, schemaStaticScript };
