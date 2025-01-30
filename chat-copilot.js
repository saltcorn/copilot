const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const { findType } = require("@saltcorn/data/models/discovery");
const { save_menu_items } = require("@saltcorn/data/models/config");
const db = require("@saltcorn/data/db");
const Workflow = require("@saltcorn/data/models/workflow");
const { renderForm } = require("@saltcorn/markup");
const {
  div,
  script,
  domReady,
  pre,
  code,
  input,
  h4,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const {
  getCompletion,
  getPromptFromTemplate,
  incompleteCfgMsg,
} = require("./common");

const get_state_fields = () => [];

const run = async (table_id, viewname, cfg, state, { res, req }) => {
  const cfgMsg = incompleteCfgMsg();
  if (cfgMsg) return cfgMsg;
  const form = new Form({
    onSubmit: `event.preventDefault();view_post('${viewname}', 'interact', $(this).serialize());return false;`,
    formStyle: "vert",
    submitLabel: "Send",
    fields: [
      {
        type: "String",
        label: " ",
        name: "userinput",
        fieldview: "textarea",
      },
    ],
  });
  return div(h4("How can i help you?"), renderForm(form, req.csrfToken()));
};

const interact = async (table_id, viewname, config, body, { req }) => {
  console.log(body);
};

module.exports = {
  name: "Saltcorn Copilot",
  display_state_form: false,
  get_state_fields,
  tableless: true,
  singleton: true,
  run,
  routes: { interact },
};
