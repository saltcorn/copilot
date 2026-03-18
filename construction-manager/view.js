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
const { localeDateTime, renderForm } = require("@saltcorn/markup");
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

const get_state_fields = () => [];

const sys_prompt = ``;
const viewname = "Saltcorn construction manager";

const get_agent_view = () => {
  const agent_action = new Trigger({
    action: "Agent",
    when_trigger: "Never",
    configuration: {
      viewname,
      sys_prompt,
      skills: [
        { skill_type: "Generate Page" },
        { skill_type: "Database design" },
        { skill_type: "Generate Workflow" },
        { skill_type: "Generate View" },
      ],
    },
  });
  return new View({
    viewtemplate: "Agent Chat",
    name: viewname,
    min_role: 1,
    configuration: {
      agent_action,
      viewname,
    },
  });
};

const makeSpecForm = (req, values) =>
  new Form({
    blurb: "Provide a high-level description of the application",
    fields: [
      {
        name: "description",
        label: "Description",
        type: "String",
        fieldview: "textarea",
      },
    ],
    xhrSubmit: true,
    action: `/view/${encodeURIComponent("Saltcorn construction manager")}/submit_specs`,
    values,
  });

const run = async (table_id, viewname, cfg, state, { req, res }) => {
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  
  const specForm = makeSpecForm(req, spec.body);
  
  const layout = {
    type: "tabs",
    ntabs: 5,
    tabId: "",
    showif: [],
    titles: ["Specification", "Requirements", "Tasks", "Feedback", "Errors"],
    contents: [
      {
        type: "blank",
        contents: div({ class: "mt-2" }, renderForm(specForm, req.csrfToken())),
      },
      { type: "blank", contents: "Hello reqs" },
    ],
    deeplink: true,
    tabsStyle: "Tabs",
    independent: false,
    startClosed: false,
    setting_tab_n: 4,
    acc_init_opens: [],
    serverRendered: false,
    disable_inactive: false,
  };
  return renderLayout({
    blockDispatch: {},
    layout,
    role: req.user?.role_id || 100,
    req,
    hints: getState().getLayout(req.user).hints || {},
  });
};

const submit_specs = async (table_id, viewname, config, body, {req,res}) => {
  const { _csrf, ...spec } = body;
  const existing = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  
  if (existing)
    await db.updateWhere("_sc_metadata", { body: spec }, existing.id);
  else
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "spec",
      user_id: req.user?.id || undefined,
      body: spec,
    });
};

module.exports = {
  name: viewname,
  display_state_form: false,
  get_state_fields,
  tableless: true,
  singleton: true,
  run,
  routes: { submit_specs },
};
