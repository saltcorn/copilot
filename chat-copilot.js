const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const { findType } = require("@saltcorn/data/models/discovery");
const { save_menu_items } = require("@saltcorn/data/models/config");
const db = require("@saltcorn/data/db");
const WorkflowRun = require("@saltcorn/data/models/workflow_run");
const { renderForm } = require("@saltcorn/markup");
const {
  div,
  script,
  domReady,
  pre,
  code,
  input,
  h4,
  style,
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
    onSubmit: `event.preventDefault();view_post('${viewname}', 'interact', $(this).serialize(), processCopilotResponse);return false;`,
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
  form.hidden("run_id");
  return div(
    h4("How can i help you?"),
    div({ id: "copilotinteractions" }),
    style(`p.userinput {border-left: 3px solid #858585; padding-left: 5px;}`),
    script(`function processCopilotResponse(res) {
        console.log(res);
        const $runidin= $("input[name=run_id")
        if(res.run_id && (!$runidin.val() || $runidin.val()=="undefined"))
          $runidin.val(res.run_id);
        $("#copilotinteractions").append('<p class="userinput">'+$("textarea[name=userinput]").val()+'</p>')
        $("#copilotinteractions").append('<p>'+res.response+'</p>')
        $("textarea[name=userinput]").val("")
    }`),
    renderForm(form, req.csrfToken())
  );
};

const interact = async (table_id, viewname, config, body, { req }) => {
  console.log(body);
  const { userinput, run_id } = body;
  let run;
  if (!run_id || run_id === "undefined")
    run = await WorkflowRun.create({
      context: { interactions: [{ role: "user", content: userinput }] },
    });
  else {
    run = await WorkflowRun.findOne({ id: +run_id });
    await run.update({
      context: {
        interactions: [
          ...run.context.interactions,
          { role: "user", content: userinput },
        ],
      },
    });
  }
  console.log("chat history", run.context.interactions);

  const answer = await getState().functions.llm_generate.run(userinput, {
    chat: run.context.interactions,
  });
  await run.update({
    context: {
      interactions: [
        ...run.context.interactions,
        { role: "system", content: answer },
      ],
    },
  });
  return { json: { success: "ok", response: answer, run_id: run.id } };
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
