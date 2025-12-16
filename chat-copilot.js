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
const {
  getCompletion,
  getPromptFromTemplate,
  incompleteCfgMsg,
} = require("./common");
const MarkdownIt = require("markdown-it"),
  md = new MarkdownIt();

const get_state_fields = () => [];

const run = async (table_id, viewname, cfg, state, { res, req }) => {
  const prevRuns = (
    await WorkflowRun.find(
      { trigger_id: null /*started_by: req.user?.id*/ }, //todo uncomment
      { orderBy: "started_at", orderDesc: true, limit: 30 }
    )
  ).filter(
    (r) =>
      r.context.interactions &&
      (r.context.copilot === "_system" || !r.context.copilot)
  );
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
              p(interact.content)
            )
          );
          break;
        case "assistant":
        case "system":
          if (interact.tool_calls) {
            for (const tool_call of interact.tool_calls) {
              const markup = await renderToolcall(
                tool_call,
                viewname,
                (run.context.implemented_fcall_ids || []).includes(
                  tool_call.id
                ),
                run
              );
              interactMarkups.push(
                div(
                  { class: "interaction-segment" },
                  span({ class: "badge bg-secondary" }, "Copilot"),
                  markup
                )
              );
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
          break;
      }
    }
    runInteractions = interactMarkups.join("");
  }
  const input_form = form(
    {
      onsubmit:
        "event.preventDefault();spin_send_button();view_post('Saltcorn Copilot', 'interact', $(this).serialize(), processCopilotResponse);return false;",
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
    ),

    i(
      small(
        "Skills you can request: " +
          classesWithSkills()
            .map((ac) => ac.title)
            .join(", ")
      )
    )
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

        for(const action of res.actions||[]) {
            $("#copilotinteractions").append(wrapSegment(action, "Copilot"))
          
        }

        if(res.response)
            $("#copilotinteractions").append(wrapSegment('<p>'+res.response+'</p>', "Copilot"))
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

const ellipsize = (s, nchars) => {
  if (!s || !s.length) return "";
  if (s.length <= (nchars || 20)) return text_attr(s);
  return text_attr(s.substr(0, (nchars || 20) - 3)) + "...";
};

const actionClasses = [
  require("./actions/generate-workflow"),
  require("./actions/generate-tables"),
  require("./actions/generate-js-action"),
  require("./actions/generate-page"),
  require("./actions/generate-view"),
];

const classesWithSkills = () => {
  const state = getState();
  const skills = state.copilot_skills || [];
  return [...actionClasses, ...skills];
};

const getCompletionArguments = async () => {
  const tools = [];
  const sysPrompts = [];
  for (const actionClass of classesWithSkills()) {
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
  const actionClass = classesWithSkills().find(
    (ac) => ac.function_name === fcall.name
  );
  let result;
  if (actionClass.follow_on_generate) {
    const toolCallIndex = run.context.interactions.findIndex(
      (i) => i.tool_call_id === fcall_id
    );
    const follow_on_gen = run.context.interactions.find(
      (i, ix) => i.role === "assistant" && ix > toolCallIndex
    );
    result = await actionClass.execute(
      JSON.parse(fcall.arguments),
      req,
      follow_on_gen.content
    );
  } else {
    result = await actionClass.execute(JSON.parse(fcall.arguments), req);
  }
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
        copilot: "_system",
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
  const complArgs = await getCompletionArguments();
  complArgs.chat = run.context.interactions;
  //console.log(complArgs);

  //build a database for a bicycle rental company
  //add a boolean field called "paid" to the payments table

  const answer = await getState().functions.llm_generate.run(
    userinput,
    complArgs
  );
  if (answer.ai_sdk)
    for (const tool_call of answer.tool_calls)
      await addToContext(run, {
        interactions: [
          ...answer.messages,
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: tool_call.toolCallId,
                toolName: tool_call.toolName,
                output: {
                  type: "text",
                  value: "Action suggested to user.",
                },
              },
            ],
          },
        ],
      });
  else
    await addToContext(run, {
      interactions:
        typeof answer === "object" && answer.tool_calls
          ? [
              { role: "assistant", tool_calls: answer.tool_calls },
              ...answer.tool_calls.map((tc) => ({
                role: "tool",
                tool_call_id: tc.id || tc.toolCallId,
                name: tc.function?.name || tc.toolName,
                content: "Action suggested to user.",
              })),
            ]
          : [{ role: "assistant", content: answer }],
    });
  if (typeof answer === "object" && answer.tool_calls) {
    const actions = [];
    for (const tool_call of answer.tool_calls) {
      await addToContext(run, {
        funcalls: {
          [tool_call.id || tool_call.toolCallId]:
            tool_call.function || tool_call,
        },
      });

      const followOnGen = await getFollowOnGeneration(tool_call);
      if (followOnGen) {
        const { response_schema, prompt } = followOnGen;
        const follow_on_answer = await getState().functions.llm_generate.run(
          prompt,
          {
            debugResult: true,
            chat: run.context.interactions,
            response_format: response_schema
              ? {
                  type: "json_schema",
                  json_schema: {
                    name: "generate_page",
                    schema: response_schema,
                  },
                }
              : undefined,
          }
        );


        await addToContext(run, {
          interactions: [
            { role: "user", content: prompt },
            { role: "assistant", content: follow_on_answer },
          ],
        });

        const markup = await renderToolcall(
          tool_call,
          viewname,
          false,
          run,
          follow_on_answer
        );

        actions.push(markup);
      } else {
        const markup = await renderToolcall(tool_call, viewname, false, run);

        actions.push(markup);
      }
    }
    return { json: { success: "ok", actions, run_id: run.id } };
  } else
    return {
      json: { success: "ok", response: md.render(answer), run_id: run.id },
    };
};

const getFollowOnGeneration = async (tool_call) => {
  const fname = tool_call.function?.name || tool_call.toolName;
  const actionClass = classesWithSkills().find(
    (ac) => ac.function_name === fname
  );
  const args = tool_call.function?.arguments
    ? JSON.parse(tool_call.function?.arguments)
    : tool_call.input;

  if (actionClass.follow_on_generate) {
    return await actionClass.follow_on_generate(args);
  } else return null;
};

const renderToolcall = async (
  tool_call,
  viewname,
  implemented,
  run,
  follow_on_answer
) => {
  const fname = tool_call.function?.name || tool_call.toolName;
  const actionClass = classesWithSkills().find(
    (ac) => ac.function_name === fname
  );
  const args = tool_call.function?.arguments
    ? JSON.parse(tool_call.function.arguments)
    : tool_call.input;

  const inner_markup = await actionClass.render_html(args, follow_on_answer);
  return wrapAction(
    inner_markup,
    viewname,
    tool_call,
    actionClass,
    implemented,
    run
  );
};

const wrapAction = (
  inner_markup,
  viewname,
  tool_call,
  actionClass,
  implemented,
  run
) =>
  span({ class: "badge bg-info ms-1" }, actionClass.title) +
  div(
    { class: "card mb-3 bg-secondary-subtle" },
    div(
      { class: "card-body" },
      inner_markup,
      implemented
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
              onclick: `press_store_button(this, true);view_post('${viewname}', 'execute', {fcall_id: '${
                tool_call.id || tool_call.toolCallId
              }', run_id: ${run.id}}, processExecuteResponse)`,
            },
            "Apply"
          ),
      div({ id: "postexec-" + tool_call.id })
    )
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
  name: "Saltcorn Copilot",
  display_state_form: false,
  get_state_fields,
  tableless: true,
  singleton: true,
  run,
  routes: { interact, execute },
};
