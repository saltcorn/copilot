const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const db = require("@saltcorn/data/db");
const Workflow = require("@saltcorn/data/models/workflow");
const { renderForm } = require("@saltcorn/markup");
const { div, script, domReady, pre, code } = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");

const get_state_fields = () => [];

const getForm = async ({ viewname, body }) => {
  const tables = await Table.find({});
  const table_triggers = ["Insert", "Update", "Delete", "Validate"];

  const hasChannel = Object.entries(getState().eventTypes)
    .filter(([k, v]) => v.hasChannel)
    .map(([k, v]) => k);
  const fields = [
    {
      name: "name",
      label: "Name",
      type: "String",
      required: true,
      sublabel: "Name of action",
    },
    {
      name: "when_trigger",
      label: "When",
      input_type: "select",
      required: true,
      options: Trigger.when_options.map((t) => ({ value: t, label: t })),
      sublabel: "Event type which runs the trigger",
      help: { topic: "Event types" },
      attributes: {
        explainers: {
          Often: "Every 5 minutes",
          Never:
            "Not scheduled but can be run as an action from a button click",
        },
      },
    },
    {
      name: "table_id",
      label: "Table",
      input_type: "select",
      options: [...tables.map((t) => ({ value: t.id, label: t.name }))],
      showIf: { when_trigger: table_triggers },
      sublabel: "The table for which the trigger condition is checked.",
    },
    {
      name: "channel",
      label: "Channel",
      type: "String",
      sublabel: "Leave blank for all channels",
      showIf: { when_trigger: hasChannel },
    },
    {
      name: "prompt",
      label: "Action description",
      fieldview: "textarea",
      sublabel: "What would you like this action to do?",
      type: "String",
    },
  ];
  const form = new Form({
    action: `/view/${viewname}`,
    fields,
    onChange: "$(this).submit()",
    noSubmitButton: true,
    additionalButtons: [
      {
        label: "Generate",
        onclick: "generate_action(this)",
        class: "btn btn-primary",
      },
      {
        label: "Save as action",
        onclick: "save_as_action(this)",
        class: "btn btn-primary",
      },
    ],
  });
  return form;
};

const run = async (table_id, viewname, cfg, state, { res, req }) => {
  const form = await getForm({ viewname });
  return renderForm(form, req.csrfToken());
};

module.exports = (config) => ({
  name: "Action Builder Copilot",
  display_state_form: false,
  get_state_fields,
  tableless: true,
  singleton: true,
  run,
});
