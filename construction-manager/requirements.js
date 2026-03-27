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

const requirementsList = async (req) => {
  const rs = await MetaData.find(
    {
      type: "CopilotConstructMgr",
      name: "requirement",
    },
    { orderBy: "written_at" },
  );
  const starFieldview = getState().types.Integer.fieldviews.show_star_rating;

  if (rs.length) {
    return div(
      { class: "mt-2" },
      mkTable(
        [
          { label: "Requirement", key: (m) => m.body.requirement },
          {
            label: "Priority",
            key: (m) =>
              starFieldview.run(m.body.priority, req, { min: 1, max: 5 }),
          },
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
        rs,
      ),
      button(
        {
          class: "btn btn-outline-danger mb-4",
          onclick: `view_post("${viewname}", "del_all_reqs")`,
        },
        "Delete all",
      ),
    );
  } else {
    return div(
      { class: "mt-2" },
      p("No requirements found"),
      button(
        {
          class: "btn btn-primary",
          onclick: `press_store_button(this);view_post("${viewname}", "gen_reqs")`,
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
      tools: [requirements_tool],
      ...tool_choice("make_requirements"),
      systemPrompt:
        "You are a project manager. The user wants to build an application, and you must analyse their application description",
    },
  );

  const tc = answer.getToolCalls()[0];

  for (const reqm of tc.input.requirements)
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "requirement",
      body: reqm,
      user_id: req.user?.id,
    });
  return { json: { reload_page: true } };
};

const del_req = async (table_id, viewname, config, body, { req, res }) => {
  const r = await MetaData.findOne({
    id: body.id,
  });

  if (!r) throw new Error("Requirement not found");
  await r.delete();
  return { json: { reload_page: true } };
};
const del_all_reqs = async (table_id, viewname, config, body, { req, res }) => {
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "requirement",
  });
  for (const r of rs) await r.delete();
  return { json: { reload_page: true } };
};

const req_routes = { gen_reqs, del_req, del_all_reqs };

module.exports = { requirementsList, req_routes };
