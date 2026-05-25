const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const MetaData = require("@saltcorn/data/models/metadata");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const { findType } = require("@saltcorn/data/models/discovery");
const { save_menu_items } = require("@saltcorn/data/models/config");
const db = require("@saltcorn/data/db");
const WorkflowRun = require("@saltcorn/data/models/workflow_run");
const {
  localeDateTime,
  renderForm,
  mkTable,
  post_delete_btn,
} = require("@saltcorn/markup");
const {
  div,
  script,
  domReady,
  pre,
  code,
  input,
  h4,
  style,
  h5,
  button,
  text_attr,
  i,
  p,
  span,
  small,
  form,
  textarea,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const renderLayout = require("@saltcorn/markup/layout");
const { viewname, tool_choice } = require("./common");
const { requirements_tool } = require("./tools");
const { getResearchAnswersText } = require("./research");
const { saltcorn_description, existing_tables_list } = require("./prompts");
const GenerateTables = require("../actions/generate-tables");
const { buildMermaidMarkup } = GenerateTables;
const GenerateTablesSkill = require("../agent-skills/database-design");

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

const doGenSchema_UNUSED = async (spec, rs, userId) => {
  const generatingMd = await MetaData.create({
    type: "CopilotConstructMgr",
    name: "generating_schema",
    body: {},
    user_id: userId,
  });
  try {
    const researchText = await getResearchAnswersText();
    const databaseDesignTool = new GenerateTablesSkill({}).provideTools();
    const existing_tables = await Table.find({});
    const answer = await getState().functions.llm_generate.run(
      `Generate the database schema for this application:

${spec.body.specification}
${
  researchText
    ? `\nThe user was asked clarifying questions about the application. Here are the questions and their answers:\n\n${researchText}\n`
    : ""
}
These are the requirements of the application:

${rs.map((r) => `* ${r.body.requirement}`).join("\n")}

${saltcorn_description}

${existing_tables_list(existing_tables)}

Design a complete database schema that covers ALL requirements listed above. Every distinct entity in the application must have its own table. Do not produce a minimal or partial schema — all tables needed to implement every requirement must be included in this single call. Do not leave any tables for a later step.

The tables listed above already exist in the database. Do NOT modify or extend them — treat them as fixed. Handle them as follows:
- If an existing table is already complete and used as-is: add its name to reused_table_names. Do NOT define its fields again in the tables array.
- New tables not yet in the database: include them in the tables array with all their fields as usual.

For every field that must be unique (e.g. unique email, unique slug, unique combination keys expressed as individual unique fields), set unique=true on that field.
For every field that must not be empty, set not_null=true. Description, notes, and other free-text fields should NOT be not_null unless the requirements explicitly state they are required.
Do NOT leave uniqueness or required constraints for a later step — express them fully in this schema.

Note: ownership configuration (automatically populating a FK-to-users field from the logged-in user) is a VIEW-level concern and cannot be expressed in the schema. Do not attempt to annotate fields as "ownership fields" here — simply define the foreign key field normally. Ownership will be configured when the Edit views are generated.

Note: email and SMTP configuration (host, port, credentials, sender address) is managed by the Saltcorn platform administrator in system settings — it is NOT stored in the application database. Do NOT include any table for SMTP settings, email configuration, or mail server credentials. If the application needs to send emails, that is handled by a trigger action; no schema table is needed for it.

Now use the ${
        databaseDesignTool.function.name
      } tool to generate the complete database schema for this software application
`,
      {
        tools: [databaseDesignTool],
        ...tool_choice(databaseDesignTool.function.name),
        systemPrompt:
          "You are a database designer. The user wants to build an application, and you must analyse their application description and requirements and design a complete schema. Every entity needed by any requirement must have its own table. Never produce a partial schema.",
      }
    );

    const tc = answer.getToolCalls()[0];

    const noNewTables = !tc.input.tables || tc.input.tables.length === 0;
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "schema",
      body: { tables: tc.input.tables || [], implemented: noNewTables },
      user_id: userId,
    });

    const reusedNames = tc.input.reused_table_names || [];
    if (reusedNames.length) {
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: "reused_schema",
        body: { table_names: reusedNames },
        user_id: userId,
      });
    }
  } finally {
    await generatingMd.delete();
    try {
      getState().emitDynamicUpdate(db.getTenantSchema(), {
        eval_js:
          "if(typeof copilotRefreshSchema==='function')copilotRefreshSchema();",
      });
    } catch (_) {}
  }
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
