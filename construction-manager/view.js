const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const { findType } = require("@saltcorn/data/models/discovery");
const { save_menu_items } = require("@saltcorn/data/models/config");
const db = require("@saltcorn/data/db");
const WorkflowRun = require("@saltcorn/data/models/workflow_run");
const { localeDateTime } = require("@saltcorn/markup");
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
const run = async (table_id, viewname, cfg, state, { req, res }) => {
  const layout = {
    type: "tabs",
    ntabs: 5,
    tabId: "",
    showif: [],
    titles: ["Specification", "Requirements", "Tasks", "Feedback", "Errors"],
    contents: [
      { type: "blank", contents: "Hello spec" },
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

const interact = async (table_id, viewname, config, body, reqres) => {
  const view = get_agent_view();
  return await view.runRoute("interact", body, reqres.res, reqres);
};

const execute_user_action = async (
  table_id,
  viewname,
  config,
  body,
  reqres,
) => {
  const view = get_agent_view();
  return await view.runRoute("execute_user_action", body, reqres.res, reqres);
};

module.exports = {
  name: viewname,
  display_state_form: false,
  get_state_fields,
  tableless: true,
  singleton: true,
  run,
  routes: { interact, execute_user_action },
};
