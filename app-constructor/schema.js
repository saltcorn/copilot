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
const { saltcorn_description, existing_tables_list } = require("./prompts");
const GenerateTables = require("../actions/generate-tables");
const GenerateTablesSkill = require("../agent-skills/database-design");

const showSchema = async (req) => {
  const schema = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "schema",
  });

  if (schema) {
    const preview = GenerateTables.render_html(
      { tables: schema.body.tables },
      true
    );

    return div(
      { class: "mt-2" },
      preview,
      !schema.body.implemented &&
        div(
          { class: "mb-4 d-block mt-3" },
          button(
            {
              class: "btn btn-primary me-2",
              onclick: `view_post("${viewname}", "implement_schema")`,
            },
            "Implement schema"
          ),
          button(
            {
              class: "btn btn-outline-danger",
              onclick: `view_post("${viewname}", "del_schema")`,
            },
            "Delete schema"
          )
        )
    );
  } else {
    return div(
      { class: "mt-2" },
      p("Schema not found"),
      button(
        {
          class: "btn btn-primary",
          onclick: `press_store_button(this);view_post("${viewname}", "gen_schema")`,
        },
        "Generate schema"
      )
    );
  }
};

const gen_schema = async (table_id, viewname, config, body, { req, res }) => {
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  if (!spec) throw new Error("Specification not found");
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "requirement",
  });
  if (!rs.length) throw new Error("No requirements found");

  const databaseDesignTool = new GenerateTablesSkill({}).provideTools();
  const existing_tables = await Table.find({});
  const answer = await getState().functions.llm_generate.run(
    `Generate the database schema for this application:

Description: ${spec.body.description}
Audience: ${spec.body.audience}
Core features: ${spec.body.core_features}
Out of scope: ${spec.body.out_of_scope}
Visual style: ${spec.body.visual_style}

These are the requirements of the application: 

${rs.map((r) => `* ${r.body.requirement}`).join("\n")}

${saltcorn_description}

${existing_tables_list(existing_tables)}

Design a complete database schema that covers ALL requirements listed above. Every distinct entity in the application must have its own table. Do not produce a minimal or partial schema — all tables needed to implement every requirement must be included in this single call. Do not leave any tables for a later step.

The tables listed above are already implemented in the database — include them in the schema as-is so the full data model is visible, but do not change their fields. Only add new tables for entities not yet covered. The implementation step will skip any table whose name already exists.

For every field that must be unique (e.g. unique email, unique slug, unique combination keys expressed as individual unique fields), set unique=true on that field.
For every field that must not be empty, set not_null=true.
Do NOT leave uniqueness or required constraints for a later step — express them fully in this schema.

Note: ownership configuration (automatically populating a FK-to-users field from the logged-in user) is a VIEW-level concern and cannot be expressed in the schema. Do not attempt to annotate fields as "ownership fields" here — simply define the foreign key field normally. Ownership will be configured when the Edit views are generated.

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

  await MetaData.create({
    type: "CopilotConstructMgr",
    name: "schema",
    body: { tables: tc.input.tables, implemented: false },
    user_id: req.user?.id,
  });
  return { json: { reload_page: true } };
};

const del_schema = async (table_id, viewname, config, body, { req, res }) => {
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "schema",
  });
  for (const r of rs) await r.delete();
  return { json: { reload_page: true } };
};

const implement_schema = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const md = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "schema",
  });

  const { apply_copilot_tables } = new GenerateTablesSkill({}).userActions;
  const existingNames = new Set((await Table.find({})).map((t) => t.name));
  const newTables = md.body.tables.filter((t) => {
    if (existingNames.has(t.name)) {
      getState().log(
        2,
        `AppConstructor: skipping table "${t.name}" — already exists in database`
      );
      return false;
    }
    return true;
  });
  await apply_copilot_tables({ tables: newTables, user: req.user });
  md.body.implemented = true;
  await md.update({ body: md.body });

  return { json: { reload_page: true } };
};

const schema_routes = { gen_schema, del_schema, implement_schema };

module.exports = { showSchema, schema_routes };
