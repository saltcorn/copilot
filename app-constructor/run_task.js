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
const User = require("@saltcorn/data/models/user");
const { viewname } = require("./common");

/**
 * @param {number} md_id - MetaData id of the task to run
 * @param {object} req - Express request (may be empty `{}` from scheduler)
 */
const runTask = async (md_id, req) => {
  const md = await MetaData.findOne({
    id: md_id,
  });

  if (!md) return { error: "Task not found" };
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  if (!spec) return { error: "Specification not found" };
  const agent_action = new Trigger({
    action: "Agent",
    when_trigger: "Never",
    configuration: {
      viewname: viewname,
      sys_prompt:
        "When a task requires creating multiple views, triggers, or pages, you MUST create ALL of them by calling the appropriate tool for each one. " +
        "Do not produce a text-only response until every entity named in the task has been created. " +
        "Only stop calling tools when the task is fully complete.",
      prompt: "{{prompt}}",
      skills: [
        { skill_type: "Generate Page", yoloMode: true },
        { skill_type: "Database design", yoloMode: true },
        { skill_type: "Generate Workflow", yoloMode: true },
        { skill_type: "Generate trigger", yoloMode: true },
        { skill_type: "Generate View", yoloMode: true },
        { skill_type: "Install Plugin", yoloMode: true },
      ],
    },
  });
  const prompt = `You are engaged in building the following application:

Description: ${spec.body.description}
Audience: ${spec.body.audience}
Core features: ${spec.body.core_features}
Out of scope: ${spec.body.out_of_scope}
Visual style: ${spec.body.visual_style}

Important: The database schema is already fully implemented. Do NOT use generate_tables or modify any tables or fields — all tables and fields already exist.

Important: Some fields are non-stored (virtual) calculated fields — they have no database column and are computed on-the-fly by Saltcorn. Never include such fields in modify_row, SQL UPDATE statements, or recalculate_stored_fields calls. Only fields that exist as actual database columns (regular fields and stored calculated fields) can be written. If a calculated field needs updating, it will refresh automatically when the fields it depends on change.

Important: The "users" table is built-in. Passwords are platform-managed — never add a password field to a view. Signup uses a built-in form, not an Edit view.

Your task now is:
${md.body.description}`;
  const safeReq = req?.__
    ? req
    : { ...req, __: (s) => s, user: req?.user };

  await md.update({ body: { ...md.body, status: "Running" } });
  const actionres = await agent_action.runWithoutRow({
    row: { prompt },
    req: safeReq,
    user: safeReq.user,
  });
  const run_id = actionres.json.run_id;
  const run = await WorkflowRun.findOne({ id: run_id });
  await agent_action.runWithoutRow({
    row: {
      prompt:
        "Write a description of what you did, for the purposes of a progress report. Write 1-4 sentences. Do not use any tools or write any code",
    },
    req: safeReq,
    run,
    user: safeReq.user,
  });
  const lastInteraction =
    run.context.interactions[run.context.interactions.length - 1];
  const lastText =
    typeof lastInteraction.content === "string"
      ? lastInteraction.content
        : lastInteraction.content.text
        ? lastInteraction.content.text
          : Array.isArray(lastInteraction.content)
          ? lastInteraction.content[0].text
          : lastInteraction.content;
  await MetaData.create({
    type: "CopilotConstructMgr",
    name: "progress",
    body: { text: lastText, run_id, task_id: md.id },
    user_id: req?.user?.id,
  });

  await md.update({ body: { ...md.body, status: "Done", run_id } });
};

/**
 * Run the next startable task
 * @param {boolean} [once=false] - true: run one task and stop, false: iterate all tasks
 */
const runNextTask = async (once = false) => {
  if (!once) {
    const settings = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "settings",
    });
    if (!settings?.body?.running) return;
  }
  const tasks = await MetaData.find(
    {
      type: "CopilotConstructMgr",
      name: "task",
    },
    { orderBy: "id" }
  );
  if (tasks.some((t) => t.body.status === "Running")) return;
  const todos = tasks.filter(
    (t) => !t.body.status || t.body.status === "To do"
  );
  const done = tasks.filter((t) => t.body.status === "Done");
  const done_names = new Set(done.map((t) => t.body.name));

  const startable = todos.filter((t) =>
    t.body.depends_on.every((nm) => done_names.has(nm))
  );

  if (startable[0]) {
    console.log("running task", startable[0]);
    const taskUser = startable[0].user_id
      ? await User.findOne({ id: startable[0].user_id })
      : null;
    await runTask(startable[0].id, { user: taskUser, __: (s) => s });
    if (!once) await runNextTask();
  }
};

module.exports = { runTask, runNextTask };
