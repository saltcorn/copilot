const Table = require("@saltcorn/data/models/table");
const { div, pre, p, small } = require("@saltcorn/markup/tags");
const { viewname } = require("./common");
const GenerateTables = require("../actions/generate-tables");
const { buildMermaidMarkup } = GenerateTables;

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
  const mmdia = buildMermaidMarkup(userTables);
  return div(
    { class: "mt-2" },
    small(
      { class: "text-muted d-block mb-2" },
      `${userTables.length} table${
        userTables.length !== 1 ? "s" : ""
      } — reflects current database state`
    ),
    pre({ class: "schema-mermaid" }, mmdia)
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

  window.copilotRenderSchemaMermaid = () => {
    const pre = document.querySelector('#schema-list-area .schema-mermaid');
    if (!pre) return;
    const doRender = () => {
      mermaid.run({ nodes: [pre], suppressErrors: true });
    };
    const pane = pre.closest('.tab-pane');
    if (pane && !pane.classList.contains('active')) {
      const link = document.querySelector('[data-bs-target="#' + pane.id + '"]');
      if (link) link.addEventListener('shown.bs.tab', doRender, { once: true });
      else {
        const o = new MutationObserver(() => {
          if (pane.classList.contains('active')) { o.disconnect(); doRender(); }
        });
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
