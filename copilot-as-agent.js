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

const get_state_fields = () => [];

const sys_prompt = ``;

const run = async (table_id, viewname, cfg, state, reqres) => {
  const agent_action = new Trigger({
    action: "Agent",
    when_trigger: "Never",
    configuration: {
      sys_prompt,
      skills: [{ skill_type: "Generate Page" }],
    },
  });
  const view = new View({
    viewtemplate: "Agent Chat",
    configuration: {
      agent_action,
    },
  });
  return await view.run(state, reqres);
};

module.exports = {
  name: "Saltcorn Agen-copilot",
  display_state_form: false,
  get_state_fields,
  tableless: true,
  singleton: true,
  run,
  routes: { interact, execute },
};
