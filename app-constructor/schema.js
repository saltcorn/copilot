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
const { saltcorn_description } = require("./prompts");

const showSchema = async (req) => {
  const schema = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "schema",
  });

  if (schema) {
    return div(
      { class: "mt-2" },
      "There is a schema",
      button(
        {
          class: "btn btn-outline-danger mb-4",
          onclick: `view_post("${viewname}", "del_schema")`,
        },
        "Delete schema",
      ),
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
        "Generate schema",
      ),
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

  const GenerateTablesSkill = require("../agent-skills/database-design");
  const databaseDesignTool = new GenerateTablesSkill({}).provideTools();

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

Now use the ${databaseDesignTool.function.name} tool to generate the database schema for this software application
`,
    {
      tools: [databaseDesignTool],
      ...tool_choice(databaseDesignTool.function.name),
      systemPrompt:
        "You are a database designer. The user wants to build an application, and you must analyse their application description and the requirements and come up with a good database design",
    },
  );

  const tc = answer.getToolCalls()[0];

  console.log("schema", tc);
  

  return { json: { reload_page: true } };
};

const schema_routes = { gen_schema };

module.exports = { showSchema, schema_routes };
