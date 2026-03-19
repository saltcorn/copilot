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
const { viewname } = require("./common");

const requirementsList = async (req) => {
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "requirement",
  });
  if (rs.length) {
    return mkTable(
      [
        { label: "Requirement", key: "requirement" },

        {
          label: "Delete",
          key: (r) =>
            button(
              {
                class: "btn btn-outline-danger btn-sm",
                onclick: `view_post("${viewname}", "del_req", {id:${r.id}})`,
              },
              i({ class: "fas fa-trash-alt" }),
            ),
        },
      ],
      rs.map((m) => m.body),
    );
  } else {
    return div(
      { class: "mt-2" },
      p("No requirements found"),
      button(
        {
          class: "btn btn-primary",
          onclick: `view_post("${viewname}", "gen_reqs")`,
        },
        "Generate requirements",
      ),
    );
  }
};

const gen_reqs = async (table_id, viewname, config, body, { req, res }) => {
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  if (!spec) throw new Error("Specification not found");
  const answer = await getState().functions.llm_generate.run(
    `Generate the requirements for this application:

Description: ${spec.body.description}
Audience: ${spec.body.audience}
Core features: ${spec.body.core_features}
Out of scope: ${spec.body.out_of_scope}
Visual style: ${spec.body.visual_style}

Now use the make_requirements tool to list the requirements for this software application
`,
    {
      ...requirements_tool,
      systemPrompt:
        "You are a project manager. The user wants to build an application, and you must analyse their application description",
    },
  );
  console.log("answer", answer);
  const tc = answer.getToolCalls()[0];
  console.log("tool call", tc);
  for (const reqm of tc.input.requirements)
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "requirement",
      body: reqm,
      user_id: req.user?.id,
    });
  return { reload_page: true };
};

const requirements_tool = {
  tools: [
    {
      type: "function",
      function: {
        name: "make_requirements",
        description: "Provide a list of requirements for the application",
        parameters: {
          type: "object",
          required: ["requirements"],
          additionalProperties: false,
          properties: {
            requirements: {
              type: "array",
              items: {
                type: "object",
                required: ["requirement", "priority"],
                additionalProperties: false,
                properties: {
                  requirement: {
                    type: "string",
                    description: "A statement of the requirement",
                  },
                  priority: {
                    type: "number",
                    description:
                      "Priority 1-5. 5: Most important, 1: Least important",
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
  tool_choice: {
    type: "function",
    function: {
      name: "make_requirements",
    },
  },
};

module.exports = { requirementsList, gen_reqs };
