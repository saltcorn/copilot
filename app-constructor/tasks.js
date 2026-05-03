const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const MetaData = require("@saltcorn/data/models/metadata");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const Page = require("@saltcorn/data/models/page");
const Plugin = require("@saltcorn/data/models/plugin");
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
const {
  saltcorn_description,
  existing_tables_list,
  existing_entities_list,
  available_plugins_list,
} = require("./prompts");

const makeTaskList = async (req) => {
  const rs = await MetaData.find(
    {
      type: "CopilotConstructMgr",
      name: "task",
    },
    { orderBy: "written_at" }
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
          "Stop running"
        )
      : button(
          {
            class: "btn btn-success ms-2",
            onclick: `view_post("${viewname}", "start", {})`,
          },
          i({ class: "fas fa-play me-1" }),
          "Start running now"
        ),
    button(
      {
        class: "btn btn-outline-success ms-2",
        onclick: `press_store_button(this);view_post("${viewname}", "run_task", {})`,
      },
      i({ class: "fas fa-play me-1" }),
      "Run next task"
    )
  );
  if (rs.length) {
    return div(
      { class: "mt-2" },
      status,
      mkTable(
        [
          { label: "Name", key: (m) => m.body.name },
          { label: "Description", key: (m) => m.body.description },
          {
            label: "Depends on",
            key: (m) => (m.body.depends_on || []).join(", "),
          },
          { label: "Priority", key: (m) => m.body.priority },
          { label: "Status", key: (m) => m.body.status || "To do" },
          {
            label: "Run",
            key: (r) =>
              r.body.status === "Running"
                ? span(
                    {
                      class: "task-spinner",
                      "data-task-id": r.id,
                    },
                    i({ class: "fas fa-spinner fa-spin text-warning" })
                  )
                : r.body.status === "Done"
                ? r.body.run_id
                  ? a(
                      {
                        target: "_blank",
                        href: `/view/Saltcorn%20Agent%20copilot?run_id=${r.body.run_id}`,
                      },
                      i({ class: "fas fa-external-link-alt" })
                    )
                  : ""
                : button(
                    {
                      class: "btn btn-outline-success btn-sm",
                      onclick: `press_store_button(this);view_post("${viewname}", "run_task", {id:${r.id}})`,
                    },
                    i({ class: "fas fa-play" })
                  ),
          },
          {
            label: "",
            key: (r) =>
              r.body.status === "To do" || !r.body.status
                ? button(
                    {
                      class: "btn btn-outline-secondary btn-sm",
                      title: "Mark as done without running",
                      onclick: `view_post("${viewname}", "mark_done_task", {id:${r.id}})`,
                    },
                    i({ class: "fas fa-check" })
                  )
                : "",
          },
          {
            label: "Delete",
            key: (r) =>
              button(
                {
                  class: "btn btn-outline-danger btn-sm",
                  onclick: `view_post("${viewname}", "del_task", {id:${r.id}})`,
                },
                i({ class: "fas fa-trash-alt" })
              ),
          },
        ],
        {
          "To do": rs.filter(
            (t) => !t.body.status || t.body.status === "To do"
          ),
          Running: rs.filter((t) => t.body.status === "Running"),
          Done: rs.filter((t) => t.body.status === "Done"),
        },
        { grouped: true }
      ),
      rs.some((t) => t.body.status === "Running")
        ? script(
            domReady(`
(function() {
  function pollTasks() {
    var spinners = document.querySelectorAll('.task-spinner[data-task-id]');
    if (!spinners.length) return;
    var ids = Array.from(spinners).map(function(el) { return el.getAttribute('data-task-id'); });
    view_post(${JSON.stringify(
      viewname
    )}, 'task_status', { ids: ids }, function(resp) {
      if (resp && resp.any_done) {
        location.reload();
      } else {
        setTimeout(pollTasks, 3000);
      }
    });
  }
  setTimeout(pollTasks, 3000);
})();
`)
          )
        : "",
      button(
        {
          class: "btn btn-outline-danger mb-4",
          onclick: `view_post("${viewname}", "del_all_tasks")`,
        },
        "Delete all"
      )
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
        "Plan tasks"
      )
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
  const schema = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "schema",
  });
  if (!schema) throw new Error("No schema found");
  if (!schema.body.implemented) throw new Error("Schema not implemented");
  const tables = await Table.find({});
  const views = await View.find({});
  const triggers = await Trigger.find({});
  const pages = await Page.find({});
  const entitiesSection = existing_entities_list({ views, triggers, pages });
  const installedPlugins = await Plugin.find({});
  const installedNames = new Set(installedPlugins.map((p) => p.name));
  let storePlugins = [];
  try {
    storePlugins = await Plugin.store_plugins_available();
  } catch (_) {}
  const pluginsSection = available_plugins_list(storePlugins, installedNames);

  const answer = await getState().functions.llm_generate.run(
    `Generate a plan for building this application:

Description: ${spec.body.description}
Audience: ${spec.body.audience}
Core features: ${spec.body.core_features}
Out of scope: ${spec.body.out_of_scope}
Visual style: ${spec.body.visual_style}

These are the requirements of the application: 

${rs.map((r) => `* ${r.body.requirement}`).join("\n")}

${saltcorn_description}

The database has already been built. The following tables are now present in the database:

${existing_tables_list(tables)}

The plan should outline the continued development of the application on top of this database.
Your plan can add additional tables if needed or adjust the table fields, but normally the tables
should be designed optimally for this application.

${entitiesSection ? entitiesSection + "\n\n" : ""}${
      pluginsSection ? pluginsSection + "\n\n" : ""
    }The plan should focus on building views, triggers (including workflows) and pages.

Important trigger planning rules:
* When a task involves a simple field update (e.g. marking an item complete or incomplete), plan it as a trigger using modify_row — NOT a workflow. Use a workflow only when multiple steps, branching, or looping are genuinely required.
* If multiple independent single-step actions are needed (e.g. "mark complete" and "mark incomplete"), describe them as separate triggers in the task description — do not describe them as one combined workflow.
* Do NOT mention "navigate back" or "return to context" in trigger task descriptions. Navigation is configured at the view level (GoBack button), not inside a trigger.
* If a trigger should be accessible as a button in a view, the task description must name the target view and say to add an action segment with action_name set to the trigger's name. If the view already exists, combine trigger creation and view update in the same task. If the view is created in a later task, that task's description must mention adding the trigger button, and it must depend on the trigger task.
* Do NOT plan any task that writes to a virtual (read-only) calculated field. Virtual fields are computed automatically and cannot be stored — any trigger or workflow that tries to update them will be refused. If you find yourself planning a trigger to keep a calculated field "current", delete that task — the field already updates itself.

Important view planning rules:
* Do NOT plan separate tasks for "create" and "edit" on the same table. In Saltcorn, a single Edit view handles both (no id = create, id present = edit). Plan one task covering both, and write task descriptions that say "create and edit" rather than treating them as two separate items.
* When a table has foreign key fields referencing the users table, the task description must explicitly state for each one whether it is an ownership field (automatically set from the logged-in user, omit from the form) or a selector field (the user picks a value, include a selector in the form). Example: "user_id records the owner and is set automatically; shared_with_user_id must have a user selector."
* For FK fields that represent a parent context (e.g. trip_id on packing_items), always include the field as a normal selector in the Edit view form. Do NOT say to omit it. Saltcorn automatically pre-fills the selector from the URL query parameter when the view is opened from a parent context, and the user can select it manually when the view is used standalone.
* A List view that includes an edit link (viewlink column pointing to an Edit view) depends on that Edit view already existing. Always plan the Edit view task before the List view task, and set the List view task's depends_on to include the Edit view task name.
* If a List view includes a viewlink to show record details (a Show view), the Show view must be created as a separate task before the List view task, and the List view task must depend on it. A Show view is a distinct viewtemplate — do NOT use an Edit view or a page as a substitute for it. The Show view and Edit view for the same table are independent — neither depends on the other; they can be planned in any order or in parallel.
* In general, if a view embeds or links to another view, the linked view must be created first and listed as a dependency.

* For every task that creates a view, include the exact view name in the task description. View names must be lowercase, snake_case, unique across all tasks in the plan (no two tasks may produce a view with the same name), and descriptive enough to identify the table and purpose — for example 'packing_items_edit' rather than just 'edit'.

Important user account rules:
* The platform (Saltcorn) provides a built-in user account system with login, registration, and session management. Do NOT plan any tasks for user registration, login pages, password management, or authentication flows — these are already handled by the platform.
* User identity is always available as the logged-in user. Ownership fields (FK to users) are set automatically from the session; no custom logic is needed.
* If a requirement mentions "user accounts", "secure login", "saving data per user", "user-specific data", or "sharing between users", treat it as already satisfied by the platform's built-in user system. Do not generate any task in response to such a requirement.

Important schema/table rules:
* The database schema is already fully designed and implemented before task planning begins. ALL tables and fields needed by the application already exist. Do NOT plan any tasks that create tables, add fields, modify fields, or change the schema in any way. If you find yourself writing a task whose output is a table or a field, delete it — that work is already done.
* Ownership behaviour (auto-setting a FK-to-users field from the logged-in user) is configured in the Edit view, not in the database. Do not create tasks for it at the schema level.
* Do NOT plan tasks to add uniqueness constraints or validation to existing fields — those are already in the schema.
* Do NOT plan a standalone task for "access control", "row-level security", "permissions", or "roles". These are schema-level concerns already handled during schema design, or view-level concerns handled when building each view. The ownership field and sharing logic are already in the schema — there is nothing extra to configure as a separate task.

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
    }
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
  const reqUser = req?.user;
  if (body.id)
    runTask(body.id, { user: reqUser, __: req.__ }).catch((e) =>
      console.error("run_task error", e)
    );
  else runNextTask(true).catch((e) => console.error("run_task error", e));
  return { json: { reload_page: true } };
};

const task_status = async (table_id, viewname, config, body, { req, res }) => {
  const ids = body.ids || [];
  const tasks = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "task",
  });
  const relevant = tasks.filter((t) => ids.includes(String(t.id)));
  const any_done = relevant.some((t) => t.body.status !== "Running");
  return { json: { any_done } };
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
  runNextTask().catch((e) => console.error("start error", e));
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

const mark_done_task = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const r = await MetaData.findOne({ id: body.id });
  if (!r) throw new Error("Task not found");
  await r.update({ body: { ...r.body, status: "Done" } });
  return { json: { reload_page: true } };
};

const del_all_tasks = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
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
  mark_done_task,
  run_task,
  task_status,
  start,
  stop,
};

module.exports = { makeTaskList, task_routes };
