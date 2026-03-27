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
const {
  localeDateTime,
  renderForm,
  mkTable,
  post_delete_btn,
} = require("@saltcorn/markup");
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
  a,
  textarea,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const renderLayout = require("@saltcorn/markup/layout");
const { viewname } = require("./common");
const { runTask, runNextTask } = require("./run_task");

const makeTaskList = async (req) => {
  const rs = await MetaData.find(
    {
      type: "CopilotConstructMgr",
      name: "task",
    },
    { orderBy: "written_at" },
  );
  const settings = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "settings",
  });
  const running = !!settings?.body?.running;
  const status = div(
    running ? "Currently running" : "Currently not running",
    running
      ? button(
          {
            class: "btn btn-danger ms-2",
            onclick: `view_post("${viewname}", "stop", {})`,
          },
          i({ class: "fas fa-stop me-1" }),
          "Stop running",
        )
      : button(
          {
            class: "btn btn-success ms-2",
            onclick: `view_post("${viewname}", "start", {})`,
          },
          i({ class: "fas fa-play me-1" }),
          "Start running now",
        ),
    button(
      {
        class: "btn btn-outline-success ms-2",
        onclick: `press_store_button(this);view_post("${viewname}", "run_task", {})`,
      },
      i({ class: "fas fa-play me-1" }),
      "Run next task",
    ),
  );
  if (rs.length) {
    return div(
      { class: "mt-2" },
      status,
      mkTable(
        [
          { label: "Name", key: (m) => m.body.name },
          { label: "Description", key: (m) => m.body.description },
          { label: "Depends on", key: (m) => m.body.depends_on.join(", ") },
          { label: "Priority", key: (m) => m.body.priority },
          { label: "Status", key: (m) => m.body.status || "To do" },
          {
            label: "Run",
            key: (r) =>
              r.body.run_id
                ? a(
                    //{ href: `javascript:view_run(${r.body.run_id})` },
                    {
                      target: "_blank",
                      href: `/view/Saltcorn%20Agent%20copilot?run_id=${r.body.run_id}`,
                    },
                    i({ class: "fas fa-external-link-alt" }),
                  )
                : button(
                    {
                      class: "btn btn-outline-success btn-sm",
                      onclick: `press_store_button(this);view_post("${viewname}", "run_task", {id:${r.id}})`,
                    },
                    i({ class: "fas fa-play" }),
                  ),
          },
          {
            label: "Delete",
            key: (r) =>
              button(
                {
                  class: "btn btn-outline-danger btn-sm",
                  onclick: `view_post("${viewname}", "del_task", {id:${r.id}})`,
                },
                i({ class: "fas fa-trash-alt" }),
              ),
          },
        ],
        {
          "To do": rs.filter((t) => !t.body.status || t.body.status === "To do"),
          Done: rs.filter((t) => t.body.status === "Done"),
        },
        { grouped: true },
      ),
      button(
        {
          class: "btn btn-outline-danger",
          onclick: `view_post("${viewname}", "del_all_tasks")`,
        },
        "Delete all",
      ),
    );
  } else {
    return div(
      { class: "mt-2" },
      p("No tasks found"),
      button(
        {
          class: "btn btn-primary",
          onclick: `press_store_button(this);view_post("${viewname}", "gen_tasks")`,
        },
        "Plan tasks",
      ),
    );
  }
};

const gen_tasks = async (table_id, viewname, config, body, { req, res }) => {
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  if (!spec) throw new Error("Specification not found");
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "requirement",
  });
  if (!rs.length) throw new Error("No requirements found");
  const answer = await getState().functions.llm_generate.run(
    `Generate a plan for building this application:

Description: ${spec.body.description}
Audience: ${spec.body.audience}
Core features: ${spec.body.core_features}
Out of scope: ${spec.body.out_of_scope}
Visual style: ${spec.body.visual_style}

These are the requirements of the application: 

${rs.map((r) => `* ${r.body.requirement}`).join("\n")}

This application will be implemented in Saltcorn, a database application development
environment. You should first design and build the database schema. Then build the 
required views for implementing a CRUD user interface for the database tables.

Your plan should not include any clarification or questions to the product owner. The 
information you have been given so far is all that is available. Every step in the plan 
should be immediately implementable in Saltcorn. You are writing the steps in the plan
for a person who is competent in using saltcorn but has no other business knowledge.

Now use the plan_tasks tool to make a plan of tasks for this software application
`,
    {
      ...task_tool,
      systemPrompt:
        "You are a project manager. The user wants to build an application, and you must analyse their application description",
    },
  );

  const tc = answer.getToolCalls()[0];

  for (const task of tc.input.tasks)
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "task",
      body: task,
      user_id: req.user?.id,
    });
  return { json: { reload_page: true } };
};

const del_task = async (table_id, viewname, config, body, { req, res }) => {
  const r = await MetaData.findOne({
    id: body.id,
  });

  if (!r) throw new Error("Task not found");
  await r.delete();
  return { json: { reload_page: true } };
};
const run_task = async (table_id, viewname, config, body, { req, res }) => {
  if (body.id) await runTask(body.id, req);
  else await runNextTask(true);

  return { json: { reload_page: true } };
};

const start = async (table_id, viewname, config, body, { req, res }) => {
  const settings = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "settings",
  });
  if (settings)
    await settings.update({ body: { ...settings.body, running: true } });
  else
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "settings",
      body: { running: true },
    });
  return { json: { reload_page: true } };
};
const stop = async (table_id, viewname, config, body, { req, res }) => {
  const settings = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "settings",
  });
  if (settings)
    await settings.update({ body: { ...settings.body, running: false } });
  else
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "settings",
      body: { running: false },
    });
  return { json: { reload_page: true } };
};

const del_all_tasks = async (
  table_id,
  viewname,
  config,
  body,
  { req, res },
) => {
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "task",
  });
  for (const r of rs) await r.delete();
  return { json: { reload_page: true } };
};

const task_tool = {
  tools: [
    {
      type: "function",
      function: {
        name: "plan_tasks",
        description: "Provide a series of tasks for building the application",
        parameters: {
          type: "object",
          required: ["tasks"],
          additionalProperties: false,
          properties: {
            tasks: {
              type: "array",
              items: {
                type: "object",
                required: ["requirement", "priority"],
                additionalProperties: false,
                properties: {
                  name: {
                    type: "string",
                    description: "A short name for the task",
                  },
                  description: {
                    type: "string",
                    description: "A full description of the task",
                  },
                  priority: {
                    type: "number",
                    description:
                      "Priority 1-5. 5: Most important, 1: Least important",
                  },
                  depends_on: {
                    type: "array",
                    description:
                      "The names of the tasks that must be completed before this tasks can be started",
                    items: {
                      type: "string",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
  tool_choice: {
    type: "function",
    function: {
      name: "make_requirements",
    },
  },
};

const task_routes = {
  gen_tasks,
  del_task,
  del_all_tasks,
  run_task,
  start,
  stop,
};

module.exports = { makeTaskList, task_routes };
