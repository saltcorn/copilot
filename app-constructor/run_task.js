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
        "Each task creates exactly one view or one page. " +
        "Never create more than one view or page per task, even if the description mentions multiple. " +
        "Call the view or page tool exactly once and then stop.",
      prompt: "{{prompt}}",
      skills: [
        { skill_type: "Generate Page", yoloMode: true },
        { skill_type: "Database design", yoloMode: true },
        { skill_type: "Generate Workflow", yoloMode: true },
        { skill_type: "Generate trigger", yoloMode: true },
        { skill_type: "Generate View", yoloMode: true },
        { skill_type: "Install Plugin", yoloMode: true },
        { skill_type: "Registry editor", yoloMode: true },
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

Important: JsCode server-mode views run on the server and must return an HTML string. The following globals are available: Table, View, User, File, db, user, req, state, markupTags, Actions, emitEvent, moment. The state object contains URL query parameters — use state.start_date, state.end_date etc. to read user inputs submitted via a GET form. Never use process.env, window, document, or fetch in server mode. Never return a { code: "..." } object — always return an HTML string. require() is NOT available — do not import lodash or any other module. Use moment or plain JavaScript Date for all date formatting and arithmetic.

Important: When querying a table with range conditions (e.g. date ranges) in JsCode views or triggers, use operator-suffixed key names in the where object — NOT nested objects. Correct: where["entry_date >="] = start_date; where["entry_date <="] = end_date;. Wrong: where.entry_date = { gte: start_date, lte: end_date }; — Saltcorn does not support nested comparison objects on date fields and will pass the object as a raw string to Postgres.

Important: Some fields are non-stored (virtual) calculated fields — they have no database column and are computed on-the-fly by Saltcorn. Never include such fields in modify_row, SQL UPDATE statements, or recalculate_stored_fields calls. Only fields that exist as actual database columns (regular fields and stored calculated fields) can be written. If a calculated field needs updating, it will refresh automatically when the fields it depends on change.

Important: The "users" table is built-in. Passwords are platform-managed — never add a password field to a view. Signup uses the built-in page at /auth/signup, login at /auth/login. Do NOT create triggers for registration or email verification — the platform handles this natively.

Important: On landing pages, place Log in / Create account buttons in no more than two locations (e.g. navbar and one hero call-to-action). Do not repeat them in a third "Get started" section or anywhere else. For links that take an already-authenticated user to their dashboard, use href="/" — not /auth/login.

Important: Do not name any page or view "Admin dashboard" — that name is reserved by the Saltcorn platform. For pages intended for role 1 (admin), use a name like "App admin dashboard" or prefix it with the application name (e.g. "Law Firm admin dashboard").

Important: Dashboard stat cards must show real data using embedded Saltcorn Statistic views (using embed-view tags, e.g. <embed-view viewname="total_hours_stat"></embed-view>). Never use client-side JavaScript fetch stubs, commented-out fetch code, or static placeholder values (e.g. "—", "Loading...") for statistics. If a Statistic view for a metric does not exist yet, it must have been created in an earlier task — do not invent placeholder JS instead.

Important: When creating a page or view, always set min_role based on the intended audience: 1 for admin-only, 40 for staff and above, 80 for logged-in users and above, 100 for public. Never default to public (100) unless the page or view is explicitly intended for unauthenticated users (e.g. a landing page). A dashboard or view for clients/users is role 80, a staff page or view is role 40, an admin page or view is role 1.

Important: Two-factor authentication (2FA/TOTP) is fully built into the platform. To configure it, call set_entity directly with entity_type "system-configuration-value" and entity_name "twofa_policy_by_role". The entity_definition must be the plain JSON object itself — for example: {"1": "Mandatory", "100": "Disabled"}. Do NOT wrap it in {"type": "json", "value": ...} or any other envelope. Read the current value first with get_entity and merge rather than overwrite. Do NOT create a workflow or trigger to do this.

Important: To set a page as the home page for a role, call set_entity directly with entity_type "system-configuration-value" and entity_name "home_page_by_role". The value is a JSON object mapping role IDs to page names — Role IDs: public=100, user=80, staff=40, admin=1. The entity_definition must be the plain JSON object itself — for example: {"100": "landing", "80": "client_dashboard"}. Do NOT wrap it in {"type": "json", "value": ...} or any other envelope. Read the current value first with get_entity so you can merge rather than overwrite. Do NOT create a workflow or trigger to do this — use set_entity directly.

Important: If the task description mentions adding a viewlink, linking rows to another view, or a button that opens another view from a list — that viewlink column MUST be present in the finished view. Do not skip it. Viewlinks require calling get_relation_paths first to obtain the relation string before generating the layout.

Important: Every List view must include a delete action column unless the table is explicitly read-only. Use the built-in "Delete" action type for this column.

Important: Before creating or updating any view or page that embeds, links to, or opens another view (including viewlinks, action buttons, and ajax_modal calls), call list_entities (entity_type "view") to get all existing view names. Only reference views that appear in that list — never invent a name or assume a view exists. If a view is not in the list, omit it or use a simple "Coming soon" placeholder — never write conversational text, explanations, or instructions to the user inside the HTML. Always create the page with whatever views exist. Do the same for pages: call list_entities (entity_type "page") before linking to any page by name.

Important: A plain Edit view creates or edits a single record — it is NOT a bulk CSV import tool. Never use an Edit view as a solution for CSV import. List views have no built-in CSV export feature — do not add an export button or column to a List view. CSV import and export functionality must always be placed on a dedicated management or admin page as embedded views, using whatever import/export viewtemplate is available.

Important: Every HTML page (page_type HTML) must include a toast notification area so that alerts and success messages are visible. Place this div just before the closing </body> tag: <div id="toasts-area" class="toast-container position-fixed top-0 start-50 p-0" style="z-index:999;" aria-live="polite" aria-atomic="true"></div>

Important: Every tool call must contain only the final, complete result — never intermediate reasoning, planning notes, markdown code fences, TODO comments, or placeholder text. Compose the full content in your reasoning first, then pass only the finished result to the tool. A page or view that contains any of these is broken and will be visible to end users exactly as written.

Your task now is:
${md.body.description}`;
  const safeReq = req?.__ ? req : { ...req, __: (s) => s, user: req?.user };

  await md.update({ body: { ...md.body, status: "Running" } });
  try {
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
    const updatedRun = await WorkflowRun.findOne({ id: run_id });
    const lastInteraction =
      updatedRun.context.interactions[
        updatedRun.context.interactions.length - 1
      ];
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
  } catch (e) {
    await md.update({ body: { ...md.body, status: "To do" } });
    throw e;
  }
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
  const all_task_names = new Set(tasks.map((t) => t.body.name).filter(Boolean));

  const startable = todos.filter((t) =>
    (t.body.depends_on || []).every(
      (nm) => done_names.has(nm) || !all_task_names.has(nm)
    )
  );

  if (startable[0]) {
    console.log("running task", startable[0]);
    const taskUser = startable[0].user_id
      ? await User.findOne({ id: startable[0].user_id })
      : null;
    await runTask(startable[0].id, { user: taskUser, __: (s) => s });
    if (!once) await runNextTask();
  } else if (!once) {
    const settings = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "settings",
    });
    if (settings?.body?.running)
      await settings.update({ body: { ...settings.body, running: false } });
  }
};

module.exports = { runTask, runNextTask };
