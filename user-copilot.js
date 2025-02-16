const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const FieldRepeat = require("@saltcorn/data/models/fieldrepeat");
const db = require("@saltcorn/data/db");
const WorkflowRun = require("@saltcorn/data/models/workflow_run");
const Workflow = require("@saltcorn/data/models/workflow");
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
const {
  getCompletion,
  getPromptFromTemplate,
  incompleteCfgMsg,
  fieldProperties,
} = require("./common");
const MarkdownIt = require("markdown-it"),
  md = new MarkdownIt();

const configuration_workflow = (req) =>
  new Workflow({
    steps: [
      {
        name: req.__("Prompt"),
        form: async (context) => {
          return new Form({
            fields: [
              {
                name: "sys_prompt",
                label: "System prompt",
                sublabel: "Additional information for the system prompt",
                type: "String",
                fieldview: "textarea",
              },
            ],
          });
        },
      },
      {
        name: req.__("Actions"),
        form: async (context) => {
          const actions = (await Trigger.find({})).filter(
            (action) => action.description
          );
          const hasTable = actions.filter((a) => a.table_id).map((a) => a.name);
          const confirm_view_opts = {};
          for (const a of actions) {
            if (!a.table_id) continue;
            const views = await View.find({ table_id: a.table_id });
            confirm_view_opts[a.name] = views.map((v) => v.name);
          }
          return new Form({
            fields: [
              new FieldRepeat({
                name: "actions",
                label: "Actions",
                fields: [
                  {
                    name: "trigger_name",
                    label: "Action",
                    sublabel: "Only actions with a description can be enabled",
                    type: "String",
                    required: true,
                    attributes: { options: actions.map((a) => a.name) },
                  },
                  { name: "confirm", label: "User confirmation", type: "Bool" },
                  {
                    name: "confirm_view",
                    label: "Confirm view",
                    type: "String",
                    showIf: { confirm: true, trigger_name: hasTable },
                    attributes: {
                      calcOptions: ["trigger_name", confirm_view_opts],
                    },
                  },
                ],
              }),
            ],
          });
        },
      },
    ],
  });

const get_state_fields = () => [];

const run = async (table_id, viewname, config, state, { res, req }) => {
  const prevRuns = (
    await WorkflowRun.find(
      { trigger_id: null, started_by: req.user?.id },
      { orderBy: "started_at", orderDesc: true, limit: 30 }
    )
  ).filter((r) => r.context.interactions && r.context.copilot === viewname);

  const cfgMsg = incompleteCfgMsg();
  if (cfgMsg) return cfgMsg;
  let runInteractions = "";
  if (state.run_id) {
    const run = prevRuns.find((r) => r.id == state.run_id);
    const interactMarkups = [];
    for (const interact of run.context.interactions) {
      switch (interact.role) {
        case "user":
          interactMarkups.push(
            div(
              { class: "interaction-segment" },
              span({ class: "badge bg-secondary" }, "You"),
              md.render(interact.content)
            )
          );
          break;
        case "assistant":
        case "system":
          if (interact.tool_calls) {
            for (const tool_call of interact.tool_calls) {
              const action = config.actions.find(
                (a) => a.trigger_name === tool_call.function.name
              );
              if (action) {
                const row = JSON.parse(tool_call.function.arguments);
                interactMarkups.push(
                  wrapSegment(
                    wrapCard(
                      action.trigger_name,
                      pre(JSON.stringify(row, null, 2))
                    ),
                    "Copilot"
                  )
                );
              }
            }
          } else
            interactMarkups.push(
              div(
                { class: "interaction-segment" },
                span({ class: "badge bg-secondary" }, "Copilot"),
                typeof interact.content === "string"
                  ? md.render(interact.content)
                  : interact.content
              )
            );
          break;
        case "tool":
          //ignore
          if (interact.content !== "Action run") {
            interactMarkups.push(
              wrapSegment(
                wrapCard(
                  interact.name,
                  pre(JSON.stringify(interact.content, null, 2))
                ),
                "Copilot"
              )
            );
          }
          break;
      }
    }
    runInteractions = interactMarkups.join("");
  }
  const input_form = form(
    {
      onsubmit: `event.preventDefault();spin_send_button();view_post('${viewname}', 'interact', $(this).serialize(), processCopilotResponse);return false;`,
      class: "form-namespace copilot mt-2",
      method: "post",
    },
    input({
      type: "hidden",
      name: "_csrf",
      value: req.csrfToken(),
    }),
    input({
      type: "hidden",
      class: "form-control  ",
      name: "run_id",
      value: state.run_id ? +state.run_id : undefined,
    }),
    div(
      { class: "copilot-entry" },
      textarea({
        class: "form-control",
        name: "userinput",
        "data-fieldname": "userinput",
        placeholder: "How can I help you?",
        id: "inputuserinput",
        rows: "3",
        autofocus: true,
      }),
      span(
        { class: "submit-button p-2", onclick: "$('form.copilot').submit()" },
        i({ id: "sendbuttonicon", class: "far fa-paper-plane" })
      )
    )

    /*i(
      small(
        "Skills you can request: " +
          actionClasses.map((ac) => ac.title).join(", ")
      )
    )*/
  );
  return {
    widths: [3, 9],
    gx: 3,
    besides: [
      {
        type: "container",
        contents: div(
          div(
            {
              class: "d-flex justify-content-between align-middle mb-2",
            },
            h5("Sessions"),

            button(
              {
                type: "button",
                class: "btn btn-secondary btn-sm py-0",
                style: "font-size: 0.9em;height:1.5em",
                onclick: "unset_state_field('run_id')",
                title: "New session",
              },
              i({ class: "fas fa-redo fa-sm" })
            )
          ),
          prevRuns.map((run) =>
            div(
              {
                onclick: `set_state_field('run_id',${run.id})`,
                class: "prevcopilotrun border p-2",
              },
              localeDateTime(run.started_at),

              p(
                { class: "prevrun_content" },
                run.context.interactions[0]?.content
              )
            )
          )
        ),
      },
      {
        type: "container",
        contents: div(
          { class: "card" },
          div(
            { class: "card-body" },
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
            div({ id: "copilotinteractions" }, runInteractions),
            input_form,
            style(
              `div.interaction-segment:not(:first-child) {border-top: 1px solid #e7e7e7; }
              div.interaction-segment {padding-top: 5px;padding-bottom: 5px;}
              div.interaction-segment p {margin-bottom: 0px;}
              div.interaction-segment div.card {margin-top: 0.5rem;}            
            div.prevcopilotrun:hover {cursor: pointer; background-color: var(--tblr-secondary-bg-subtle, var(--bs-secondary-bg-subtle, gray));}
            .copilot-entry .submit-button:hover { cursor: pointer}

            .copilot-entry .submit-button {
              position: relative; 
              top: -1.8rem;
              left: 0.1rem;              
            }
            .copilot-entry {margin-bottom: -1.25rem; margin-top: 1rem;}
            p.prevrun_content {
               white-space: nowrap;
    overflow: hidden;
    margin-bottom: 0px;
    display: block;
    text-overflow: ellipsis;}`
            ),
            script(`function processCopilotResponse(res) {
        $("#sendbuttonicon").attr("class","far fa-paper-plane");
        const $runidin= $("input[name=run_id")
        if(res.run_id && (!$runidin.val() || $runidin.val()=="undefined"))
          $runidin.val(res.run_id);
        const wrapSegment = (html, who) => '<div class="interaction-segment"><span class="badge bg-secondary">'+who+'</span>'+html+'</div>'
        $("#copilotinteractions").append(wrapSegment('<p>'+$("textarea[name=userinput]").val()+'</p>', "You"))
        $("textarea[name=userinput]").val("")      

        if(res.response)
            $("#copilotinteractions").append(res.response)
    }
    function restore_old_button_elem(btn) {
        const oldText = $(btn).data("old-text");
        btn.html(oldText);
        btn.css({ width: "" }).prop("disabled", false);
        btn.removeData("old-text");
    }
    function processExecuteResponse(res) {
        const btn = $("#exec-"+res.fcall_id)
        restore_old_button_elem($("#exec-"+res.fcall_id))
        btn.prop('disabled', true);
        btn.html('<i class="fas fa-check me-1"></i>Applied')
        btn.removeClass("btn-primary")
        btn.addClass("btn-secondary")
        if(res.postExec) {
          $('#postexec-'+res.fcall_id).html(res.postExec)
        }
    }
    function submitOnEnter(event) {
        if (event.which === 13) {
            if (!event.repeat) {
                const newEvent = new Event("submit", {cancelable: true});
                event.target.form.dispatchEvent(newEvent);
            }

            event.preventDefault(); // Prevents the addition of a new line in the text field
        }        
    }
    document.getElementById("inputuserinput").addEventListener("keydown", submitOnEnter);
    function spin_send_button() {
      $("#sendbuttonicon").attr("class","fas fa-spinner fa-spin");
    }
`)
          )
        ),
      },
    ],
  };
};

const getCompletionArguments = async (config) => {
  let tools = [];
  const sysPrompts = [];
  for (const action of config?.actions || []) {
    let properties = {};

    const trigger = Trigger.findOne({ name: action.trigger_name });
    if (trigger.table_id) {
      const table = Table.findOne({ id: trigger.table_id });

      table.fields
        .filter((f) => !f.primary_key)
        .forEach((field) => {
          properties[field.name] = {
            description: field.label + " " + field.description || "",
            ...fieldProperties(field),
          };
        });
    }
    tools.push({
      type: "function",
      function: {
        name: action.trigger_name,
        description: trigger.description,
        parameters: {
          type: "object",
          //required: ["action_javascript_code", "action_name"],
          properties,
        },
      },
    });
  }
  const systemPrompt =
    "You are helping users retrieve information and perform actions on a relational database" +
    sysPrompts.join("\n\n");
  if (tools.length === 0) tools = undefined;
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
  await addToContext(run, { implemented_fcall_ids: [fcall_id] });
  return { json: { success: "ok", fcall_id, ...(result || {}) } };
};

const interact = async (table_id, viewname, config, body, { req }) => {
  const { userinput, run_id } = body;
  let run;
  if (!run_id || run_id === "undefined")
    run = await WorkflowRun.create({
      status: "Running",
      started_by: req.user?.id,
      context: {
        copilot: viewname,
        implemented_fcall_ids: [],
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
  return await process_interaction(run, userinput, config, req);
};

const process_interaction = async (
  run,
  input,
  config,
  req,
  prevResponses = []
) => {
  const complArgs = await getCompletionArguments(config);
  complArgs.chat = run.context.interactions;
  //console.log(complArgs);
  //console.log("complArgs", JSON.stringify(complArgs, null, 2));

  const answer = await getState().functions.llm_generate.run(input, complArgs);
  console.log("answer", answer);
  await addToContext(run, {
    interactions:
      typeof answer === "object" && answer.tool_calls
        ? [{ role: "assistant", tool_calls: answer.tool_calls }]
        : [{ role: "assistant", content: answer }],
  });
  const responses = [];

  if (typeof answer === "object" && answer.tool_calls) {
    //const actions = [];
    let hasResult = false;
    for (const tool_call of answer.tool_calls) {
      console.log("call function", tool_call.function);

      await addToContext(run, {
        funcalls: { [tool_call.id]: tool_call.function },
      });
      const action = config.actions.find(
        (a) => a.trigger_name === tool_call.function.name
      );
      console.log({ action });

      if (action) {
        const trigger = Trigger.findOne({ name: action.trigger_name });
        const row = JSON.parse(tool_call.function.arguments);
        responses.push(
          wrapSegment(
            wrapCard(action.trigger_name, pre(JSON.stringify(row, null, 2))),
            "Copilot"
          )
        );
        const result = await trigger.runWithoutRow({ user: req.user, row });
        console.log("ran trigger with result", {
          name: trigger.name,
          row,
          result,
        });

        if (typeof result === "object" && Object.keys(result || {}).length) {
          responses.push(
            wrapSegment(
              wrapCard(
                action.trigger_name + " result",
                pre(JSON.stringify(result, null, 2))
              ),
              "Copilot"
            )
          );
          hasResult = true;
        }
        await addToContext(run, {
          interactions: [
            {
              role: "tool",
              tool_call_id: tool_call.id,
              name: tool_call.function.name,
              content: result || "Action run",
            },
          ],
        });
      }
    }
    if (hasResult)
      return await process_interaction(run, "", config, req, [
        ...prevResponses,
        ...responses,
      ]);
  } else responses.push(wrapSegment(md.render(answer), "Copilot"));

  return {
    json: { success: "ok", response: responses.join(""), run_id: run.id },
  };
};

const wrapSegment = (html, who) =>
  '<div class="interaction-segment"><span class="badge bg-secondary">' +
  who +
  "</span>" +
  html +
  "</div>";

const renderToolcall = async (tool_call, viewname, implemented, run) => {
  const fname = tool_call.function.name;
  const actionClass = actionClasses.find((ac) => ac.function_name === fname);
  const args = JSON.parse(tool_call.function.arguments);

  const inner_markup = await actionClass.render_html(args);
  return wrapAction(
    inner_markup,
    viewname,
    tool_call,
    actionClass,
    implemented,
    run
  );
};

const wrapCard = (title, inner) =>
  span({ class: "badge bg-info ms-1" }, title) +
  div(
    { class: "card mb-3 bg-secondary-subtle" },
    div({ class: "card-body" }, inner)
  );

const wrapAction = (
  inner_markup,
  viewname,
  tool_call,
  actionClass,
  implemented,
  run
) =>
  wrapCard(
    actionClass.title,
    inner_markup + implemented
      ? button(
          {
            type: "button",
            class: "btn btn-secondary d-block mt-3 float-end",
            disabled: true,
          },
          i({ class: "fas fa-check me-1" }),
          "Applied"
        )
      : button(
          {
            type: "button",
            id: "exec-" + tool_call.id,
            class: "btn btn-primary d-block mt-3 float-end",
            onclick: `press_store_button(this, true);view_post('${viewname}', 'execute', {fcall_id: '${tool_call.id}', run_id: ${run.id}}, processExecuteResponse)`,
          },
          "Apply"
        ) + div({ id: "postexec-" + tool_call.id })
  );

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
  name: "User Copilot",
  configuration_workflow,
  display_state_form: false,
  get_state_fields,
  tableless: true,
  run,
  routes: { interact, execute },
};
