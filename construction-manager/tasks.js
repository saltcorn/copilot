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
const { viewname, tool_choice } = require("./common");
const { runTask, runNextTask } = require("./run_task");
const { task_tool } = require("./tools");

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
          "To do": rs.filter(
            (t) => !t.body.status || t.body.status === "To do",
          ),
          Done: rs.filter((t) => t.body.status === "Done"),
        },
        { grouped: true },
      ),
      button(
        {
          class: "btn btn-outline-danger mb-4",
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
environment. 

Saltcorn applications contain the following entity types:

* Tables: These are relational database tables and consists of fields of specified types and rows 
with a value for each field. Fields optionally can be required and/or unique. Every field has a name, 
which is a an identifier that is balid in both JavaScript and SQL, and a label, which is any short 
user-friendly string. Every table has a primary key
(composite primary keys are not supported) which by default is an auto-incrementing integer with 
name \`id\` and label ID. Fields can also be of Key type (foreign key) referencing a primary key 
in another table, or its own table for a self-join. Tables can have 
calculated fields, which can be stored or non-stored. Both stored and non-stored fields are 
defined by a JavaScript expression, but only stored fields can reference other tables with join 
fields and aggregations.

* Views: Views are elementary user interfaces into a database table. A view is defined by applying a 
view template (also sometime called a view pattern, the two are synonymous) to a table with a certain
configuration. The view template defines the fundamental relationship between the UI and the table. For
instance, the Show view template displays a single database row, the Edit view template is a form that 
can create a new row or edit an existing row, the List view template displays multiple rows in a grid. 
Views can embed views, for instance Show can embed another row through a Key field relationship, or 
some views are defined by an underlying view. For instance, the Feed view repeats an underlying view 
for multiple tables. New viewtemplates are provided by plugin modules.

* Triggers: Triggers connect elementary actions (provided by plugin modules) to either a button in the 
user interface, or a periodic (hourly, daily etc) or table (for instance insert on specifc table) event. 
The elementary action each has a number of configuration fields that must be filled in after connecting 
the action to an event, table or button.

* Page: A page has static content but can also embed views for synamic content. Pages can be either 
defined by a Saltcorn layout, for pages that can be edited with drag and drop, or by HTML for more 
flexible graphic designs. HTML pages should be used for landing pages.

* Plugin modules: plugin modules can supply new field types, view templates or actions. Before they can be used,
they need to be installed before they can be used. A plugin may also have a configuration that sets options
for that plugin. Layout themes is Saltcorn are plugin modules.

You should first build the database schema. Then build the 
required views for implementing a CRUD user interface for the database tables. If approriate 

Your plan should not include any clarification or questions to the product owner. The 
information you have been given so far is all that is available. Every step in the plan 
should be immediately implementable in Saltcorn. You are writing the steps in the plan
for a person who is competent in using saltcorn but has no other business knowledge.

Do not include any steps that contain planning, design or review instructions. You are only writing a
plan for the engineer building the application. Every step in the plan should have the construction or the modification
of one or several application entity types. 

Now use the plan_tasks tool to make a plan of tasks for building software application
`,
    {
      tools: [task_tool],
      ...tool_choice("plan_tasks"),
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

const task_routes = {
  gen_tasks,
  del_task,
  del_all_tasks,
  run_task,
  start,
  stop,
};

module.exports = { makeTaskList, task_routes };
