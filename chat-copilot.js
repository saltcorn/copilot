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
  h5,
  button,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const {
  getCompletion,
  getPromptFromTemplate,
  incompleteCfgMsg,
} = require("./common");

const get_state_fields = () => [];

const run = async (table_id, viewname, cfg, state, { res, req }) => {
  console.log(await require("./actions/generate-tables").system_prompt());

  const cfgMsg = incompleteCfgMsg();
  if (cfgMsg) return cfgMsg;
  const form = new Form({
    onSubmit: `event.preventDefault();press_store_button(this, true);view_post('${viewname}', 'interact', $(this).serialize(), processCopilotResponse);return false;`,
    formStyle: "vert",
    submitLabel: "Send",
    class: "copilot",
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
    script({
      src: `/static_assets/${db.connectObj.version_tag}/mermaid.min.js`,
    }),
    script(
      { type: "module" },
      `mermaid.initialize({securityLevel: 'loose'${
        getState().getLightDarkMode(req.user) === "dark"
          ? ",theme: 'dark',"
          : ""
      }});`
    ),
    h4("How can i help you?"),
    div(
      { class: "mb-3" },
      "Skills you can request: " +
        actionClasses.map((ac) => ac.title).join(", ")
    ),
    div({ id: "copilotinteractions" }),
    style(`p.userinput {border-left: 3px solid #858585; padding-left: 5px;}`),
    script(`function processCopilotResponse(res) {
        restore_old_button_elem($("form.copilot").find("button"))
        const $runidin= $("input[name=run_id")
        if(res.run_id && (!$runidin.val() || $runidin.val()=="undefined"))
          $runidin.val(res.run_id);

        $("#copilotinteractions").append('<p class="userinput">'+$("textarea[name=userinput]").val()+'</p>')
        $("textarea[name=userinput]").val("")

        for(const action of res.actions||[]) {
            $("#copilotinteractions").append('<div class="card mb-3">'+action+'</div>')
          
        }

        if(res.response)
            $("#copilotinteractions").append('<p>'+res.response+'</p>')
    }
    function restore_old_button_elem(btn) {
        const oldText = $(btn).data("old-text");
        btn.html(oldText);
        btn.css({ width: "" });
        btn.removeData("old-text");
    }
    function processExecuteResponse(res) {
        const btn = $("#exec-"+res.fcall_id)
        restore_old_button_elem($("#exec-"+res.fcall_id))
        btn.prop('disabled', true);
        btn.html('<i class="fas fa-check me-1"></i>Implemented')
        btn.removeClass("btn-primary")
        btn.addClass("btn-secondary")
        if(res.postExec) {
          $('#postexec-'+res.fcall_id).html(res.postExec)
        }
    }
`),
    renderForm(form, req.csrfToken())
  );
};

const actionClasses = [
  require("./actions/generate-workflow"),
  require("./actions/generate-tables"),
];

const getCompletionArguments = async () => {
  const tools = [];
  const sysPrompts = [];
  for (const actionClass of actionClasses) {
    tools.push({
      type: "function",
      function: {
        name: actionClass.function_name,
        description: actionClass.description,
        parameters: await actionClass.json_schema(),
      },
    });
    sysPrompts.push(await actionClass.system_prompt());
  }
  const systemPrompt =
    "You are building application components in a database application builder called Saltcorn.\n\n" +
    sysPrompts.join("\n\n");
  return { tools, systemPrompt };
};

/*

build a workflow that asks the user for their name and age

*/

const execute = async (table_id, viewname, config, body, { req }) => {
  const { fcall_id, run_id } = body;

  const run = await WorkflowRun.findOne({ id: +run_id });

  const fcall = run.context.funcalls[fcall_id];
  const actionClass = actionClasses.find(
    (ac) => ac.function_name === fcall.name
  );
  const result = await actionClass.execute(JSON.parse(fcall.arguments), req);
  return { json: { success: "ok", fcall_id, ...(result || {}) } };
};

const interact = async (table_id, viewname, config, body, { req }) => {
  const { userinput, run_id } = body;
  let run;
  if (!run_id || run_id === "undefined")
    run = await WorkflowRun.create({
      status: "Running",
      context: {
        interactions: [{ role: "user", content: userinput }],
        funcalls: {},
      },
    });
  else {
    run = await WorkflowRun.findOne({ id: +run_id });
    await addToContext(run, {
      interactions: [{ role: "user", content: userinput }],
    });
  }
  const complArgs = await getCompletionArguments();
  complArgs.chat = run.context.interactions;
  //console.log(complArgs);

  //build a database for a bicycle rental company
  //add a boolean field called "paid" to the payments table

  const answer = await getState().functions.llm_generate.run(
    userinput,
    complArgs
  );
  await addToContext(run, {
    interactions:
      typeof answer === "object" && answer.tool_calls
        ? [
            { role: "assistant", tool_calls: answer.tool_calls },
            ...answer.tool_calls.map((tc) => ({
              role: "tool",
              tool_call_id: tc.id,
              name: tc.function.name,
              content: "Action suggested to user.",
            })),
          ]
        : [{ role: "assistant", content: answer }],
  });
  console.log("answer", answer);

  if (typeof answer === "object" && answer.tool_calls) {
    const actions = [];
    for (const tool_call of answer.tool_calls) {
      const fname = tool_call.function.name;
      const actionClass = actionClasses.find(
        (ac) => ac.function_name === fname
      );
      const args = JSON.parse(tool_call.function.arguments);
      await addToContext(run, {
        funcalls: { [tool_call.id]: tool_call.function },
      });

      const inner_markup = await actionClass.render_html(args);
      const markup =
        div({ class: "card-header" }, h5(actionClass.title)) +
        div(
          { class: "card-body" },
          inner_markup,
          button(
            {
              type: "button",
              id: "exec-" + tool_call.id,
              class: "btn btn-primary d-block mt-3",
              onclick: `press_store_button(this, true);view_post('${viewname}', 'execute', {fcall_id: '${tool_call.id}', run_id: ${run.id}}, processExecuteResponse)`,
            },
            "Implement"
          ),
          div({ id: "postexec-" + tool_call.id })
        );
      actions.push(markup);
    }
    return { json: { success: "ok", actions, run_id: run.id } };
  } else return { json: { success: "ok", response: answer, run_id: run.id } };
};

const addToContext = async (run, newCtx) => {
  if (run.addToContext) return await run.addToContext(newCtx);
  let changed = true;
  Object.keys(newCtx).forEach((k) => {
    if (Array.isArray(run.context[k])) {
      if (!Array.isArray(newCtx[k]))
        throw new Error("Must be array to append to array");
      run.context[k].push(...newCtx[k]);
      changed = true;
    } else if (typeof run.context[k] === "object") {
      if (typeof newCtx[k] !== "object")
        throw new Error("Must be object to append to object");
      Object.assign(run.context[k], newCtx[k]);
      changed = true;
    } else {
      run.context[k] = newCtx[k];
      changed = true;
    }
  });
  if (changed) await run.update({ context: run.context });
};

module.exports = {
  name: "Saltcorn Copilot",
  display_state_form: false,
  get_state_fields,
  tableless: true,
  singleton: true,
  run,
  routes: { interact, execute },
};

/* todo

previous runs on side
update visuals
  - textarea input group
  - more chat like


*/
