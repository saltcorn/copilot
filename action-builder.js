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
const {
  getCompletion,
  getPromptFromTemplate,
  incompleteCfgMsg,
} = require("./common");

const get_state_fields = () => [];

const getForm = async ({ viewname, body, hasCode }) => {
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
    ...(hasCode
      ? [
          {
            name: "code",
            label: "Generated code",
            fieldview: "textarea",
            attributes: { mode: "application/javascript" },
            input_type: "code",
          },
        ]
      : []),
  ];
  const form = new Form({
    action: `/view/${viewname}`,
    fields,
    submitLabel: body?.prompt ? "Re-generate code" : "Generate code",
    additionalButtons: body?.prompt
      ? [
          {
            label: "Save as trigger",
            onclick: "save_as_action(this)",
            class: "btn btn-primary",
            afterSave: true,
          },
        ]
      : undefined,
  });
  return form;
};

const js = (viewname) =>
  script(`
function save_as_action(that) {
  const form = $(that).closest('form');
  view_post("${viewname}", "save_as_action", $(form).serialize())
}
`);

const run = async (table_id, viewname, cfg, state, { res, req }) => {
  const form = await getForm({ viewname });
  const cfgMsg = incompleteCfgMsg();
  if (cfgMsg) return cfgMsg;
  else return renderForm(form, req.csrfToken());
};

const runPost = async (
  table_id,
  viewname,
  config,
  state,
  body,
  { req, res }
) => {
  const form = await getForm({ viewname, body, hasCode: true });
  form.validate(body);

  form.hasErrors = false;
  form.errors = {};

  const fullPrompt = await getPromptFromTemplate(
    "action-builder.txt",
    form.values.prompt
  );

  const completion = await getCompletion("JavaScript", fullPrompt);

  form.values.code = completion;
  res.sendWrap("Action Builder Copilot", [
    renderForm(form, req.csrfToken()),
    js(viewname),
  ]);
};

const save_as_action = async (table_id, viewname, config, body, { req }) => {
  const form = await getForm({ viewname, body, hasCode: true });
  form.validate(body);
  if (!form.hasErrors) {
    const { name, when_trigger, table_id, channel, prompt, code } = form.values;
    await Trigger.create({
      name,
      when_trigger,
      table_id,
      channel,
      description: prompt,
      action: "run_js_code",
      configuration: { code },
    });

    return { json: { success: "ok", notify: `Trigger ${name} created` } };
  }
  return { json: { error: "Form incomplete" } };
};

module.exports = {
  name: "Action Builder Copilot",
  display_state_form: false,
  get_state_fields,
  tableless: true,
  singleton: true,
  run,
  runPost: runPost,
  routes: { save_as_action },
};
