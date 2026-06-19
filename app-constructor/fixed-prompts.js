// Arrays of logical rules for the app constructor prompt system.
// Originals in prompts.js are kept intact; these will replace them in a future refactor.
// Join with "\n\n" to reproduce block-style sections.

const saltcorn_description = [
  `This application will be implemented in Saltcorn, a database application development
environment.

Saltcorn applications contain the following entity types:`,

  `* Tables: These are relational database tables and consist of fields of specified types
and rows with a value for each field. Fields optionally can be required and/or unique.
Every field has a name, which is an identifier that is valid in both JavaScript and SQL,
and a label, which is any short user-friendly string. Every table has a primary key
(composite primary keys are not supported) which by default is an auto-incrementing integer
with name \`id\` and label ID. The \`id\` primary key field is always unique and not-null by
definition — never set unique=true or not_null=true on it. Fields can also be of Key type
(foreign key) referencing a primary key in another table, or its own table for a self-join.
Tables can have calculated fields, which can be stored or non-stored. Both stored and
non-stored fields are defined by a JavaScript expression, but only stored fields can
reference other tables with join fields and aggregations.`,

  `* Views: Views are elementary user interfaces into a database table. A view is defined by
applying a view template (also sometimes called a view pattern, the two are synonymous) to
a table with a certain configuration. The view template defines the fundamental relationship
between the UI and the table. For instance, the Show view template displays a single database
row, the Edit view template is a form that can create a new row or edit an existing row, the
List view template displays multiple rows in a grid. Views can embed views, for instance Show
can embed another row through a Key field relationship, or some views are defined by an
underlying view. For instance, the Feed view repeats an underlying view for multiple tables.
New viewtemplates are provided by plugin modules.`,

  `* Triggers: Triggers connect elementary actions (provided by plugin modules) to either a
button in the user interface, or a periodic (hourly, daily etc) or table (for instance insert
on specific table) event. The elementary action each has a number of configuration fields
that must be filled in after connecting the action to an event, table or button.`,

  `* Page: A page has static content but can also embed views for dynamic content. Pages can
be either defined by a Saltcorn layout, for pages that can be edited with drag and drop, or
by HTML for more flexible graphic designs. HTML pages should be used for landing pages.`,

  `* Plugin modules: plugin modules can supply new field types, view templates or actions.
Before they can be used, they need to be installed. A plugin may also have a configuration
that sets options for that plugin. Layout themes in Saltcorn are plugin modules.`,
];

const task_planning_rules = [
  "The plan should focus on building views, triggers (including workflows) and pages.",

  `Important trigger planning rules:
* When a task involves a simple field update (e.g. marking an item complete or incomplete),
  plan it as a trigger using modify_row — NOT a workflow. Use a workflow only when multiple
  steps, branching, or looping are genuinely required.
* If multiple independent single-step actions are needed (e.g. "mark complete" and
  "mark incomplete"), describe them as separate triggers in the task description — do not
  describe them as one combined workflow.
* Do NOT mention "navigate back" or "return to context" in trigger task descriptions.
  Navigation is configured at the view level (GoBack button), not inside a trigger.
* If a trigger should be accessible as a button in a view, prefer two separate tasks:
  (1) a task that creates the trigger, (2) a task that updates the existing view to add an
  action segment with action_name set to the trigger's name — this second task must depend on
  the first. Only combine them into one task when the view is being created for the first
  time in the same plan (i.e. the view does not yet exist), in which case the single
  view-creation task must also add the action button and depend on the trigger task.
* Do NOT plan any task that uses run_bash_script or executes shell commands. If a requirement
  seems to need a shell command (e.g. file conversion, PDF generation, sending email), look
  for a Saltcorn plugin or built-in action that covers it instead.
* Only reference a plugin when no built-in action, field type, or view template covers the
  requirement. Inserting rows, updating fields, looping, computing aggregates, and running
  conditional logic are all covered by built-in workflow steps — only reach for a plugin when
  there is no built-in equivalent. For example, do NOT use the 'sql' plugin to insert rows
  or compute totals — use built-in workflow steps instead.
* Do NOT plan any task that writes to a virtual (read-only) calculated field. Virtual fields
  are computed automatically and cannot be stored — any trigger or workflow that tries to
  update them will be refused. If you find yourself planning a trigger to keep a calculated
  field "current", delete that task — the field already updates itself.`,

  `Important existing-entity rules:
* MANDATORY pre-flight check: before writing any task, scan the already-implemented pages
  list above. If the page you are about to plan is already in that list, DO NOT add it —
  planning a task to create an existing page is always wrong. This check must happen for
  every page task, no exceptions.
* Before planning any view or page task, check the list of already-implemented views and
  pages above. If an existing view or page already covers the required functionality — even
  under a slightly different name — do NOT create a new one. Reference the existing entity by
  its exact name in dependent tasks.
* Never create a new view that is a renamed variant of an existing one (e.g. prefixing with
  "my_", "user_", "filtered_"). If the existing view needs filtering for a specific context,
  embed it as-is and describe the filtering in the embedding page or view task.
* For every role's required dashboard or key page, verify it is either in the existing pages
  list or has a task planned for it. A requirement that mentions a dashboard or home screen
  for a role and has no corresponding existing page MUST have a task.
* If a page was previously created under one name and a requirement refers to the same concept
  under a different name, use the existing page's actual name — do not plan a second page for
  the same purpose.`,

  `Important view planning rules:
* Each task must create exactly one view. Never put two or more views in the same task. Edit,
  Show, and List for the same table are always three separate tasks with three separate names,
  descriptions, and dependencies.
* Do NOT plan separate tasks for "create" and "edit" on the same table. In Saltcorn, a single
  Edit view handles both (no id = create, id present = edit). One task, one Edit view,
  description says "create and edit".
* Edit, Show, and List views for a table always go together as three separate tasks. Whenever
  you plan a List view AND a Show view for the same table, you MUST also plan an Edit view for
  that table — a List without an Edit leaves users unable to create or modify records. Only
  omit the Edit view when the requirements explicitly say the data is read-only.
* The three tasks must be ordered: Edit and Show first (independent of each other, in any
  order), List last. The List task MUST list both the Edit task and the Show task in its
  depends_on — without exception. If you plan a List that depends on neither, that is a bug
  in the plan.
* Before finalising the plan, for every List view task, verify that its depends_on includes
  the corresponding Edit task and the corresponding Show task (if they exist). If either is
  missing, add it.
* When a List view links to a Show view or Edit view, the task description must say: "Add a
  viewlink column to [view_name] for the current row" — not just "link each row". This wording
  makes it unambiguous that a viewlink column must be added to the list for each target view.
* When the plan includes a view that requires a specific row id to function — such as a
  many-to-many assignment view (e.g. assigning teachers to a class, tagging, linking
  students to groups), a detail view, or a related-record manager — plan it as its own
  dedicated task. Do NOT bundle its creation into the same task as the view that embeds it —
  the embedded view must exist before the embedding task runs and must be listed in depends_on.
  When such a view is meant to be embedded inside a Show view, plan a dedicated Show view
  whose only purpose is to carry the parent row id in state and embed the view. Keep the
  main Show view (which displays the record's fields) separate and unmodified. Name this
  dedicated Show view after its functional purpose, not its technical role — e.g.
  "class_teachers_assign" not "class_teachers_shell_show". Access it via a viewlink in the
  List view — not via a dashboard page embed. Add both the embedded view task and this
  dedicated Show task to the List task's depends_on.
* Every link or viewlink that targets a Show view MUST include the row's \`id\` as a URL query
  parameter (e.g. \`?id={{id}}\`). A Show view with no \`id\` in the URL displays "No row
  selected". This applies to viewlinks in List views, page links, and any other navigation
  pointing at a Show view.
* Every List view task description must include a delete action column unless the table is
  explicitly read-only. State it explicitly: "Add a delete action column."
* In general, if a view embeds or links to another view, the linked view's task must be listed
  as a dependency.
* When a table has foreign key fields referencing the users table, the task description must
  explicitly state for each one whether it is an ownership field (automatically set from the
  logged-in user, omit from the form) or a selector field (the user picks a value, include a
  selector in the form). Example: "user_id records the owner and is set automatically;
  shared_with_user_id must have a user selector."
  Critical distinction: tables that represent a user's role or profile (e.g. parents,
  students, teachers — where the record IS the user's role in the system) have a user_id
  that is a SELECTOR, not an ownership field. These records are created by admins or staff
  who assign the correct user account; the logged-in user creating the record is NOT
  necessarily the user the record represents. Never auto-set user_id from the session on
  role/profile tables — always include a user selector in the form.
* For FK fields that represent a parent context (e.g. trip_id on packing_items), always
  include the field as a normal selector in the Edit view form. Do NOT say to omit it.
  Saltcorn automatically pre-fills the selector from the URL query parameter when the view is
  opened from a parent context, and the user can select it manually when the view is used
  standalone.
* NEVER omit a NOT NULL (required) FK field from the Edit view form unless it references the
  users table directly AND it is being used as an ownership field. Any other required FK field
  — including FKs to non-user tables even if they are "set by the system" — MUST be included
  as a selector in the form. A required field omitted from the form with no mechanism to set
  it will produce a NOT NULL database error on save. "Will be set automatically" is not a
  valid plan unless the field directly references the users table.
* For every task that creates a view, include the exact view name in the task description.
  View names must be lowercase, snake_case, unique across all tasks in the plan, and
  descriptive enough to identify the table and purpose — for example 'packing_items_edit'
  rather than just 'edit'.
* Do NOT plan an Edit view for any table whose description says it is auto-populated or not
  editable by users (e.g. audit logs, import/export job tracking tables). These tables may
  have List and Show views for read-only visibility, but never an Edit view.`,

  `Important user account rules:
* The platform (Saltcorn) provides a built-in user account system with login, registration,
  and session management. Do NOT plan any tasks for user registration, login pages, password
  management, authentication flows, or email verification — these are already handled by the
  platform. Users register at /auth/signup and log in at /auth/login.
* User identity is always available as the logged-in user. Ownership fields (FK to users) are
  set automatically from the session; no custom logic is needed.
* If a requirement mentions "user accounts", "secure login", "saving data per user",
  "user-specific data", or "sharing between users", treat it as already satisfied by the
  platform's built-in user system. Do not generate any task in response to such a requirement.
* Do NOT create any Edit, Show, or List view whose underlying table is the built-in \`users\`
  table. The users table is managed entirely by the platform — records are created via
  /auth/signup and managed via the platform's built-in admin panel. Never plan a task that
  creates a view on the users table.`,

  `Important date field rules:
* When a view task includes a date field that should pre-fill to today, the task description
  must say to use "default_now": true in the flatpickr configuration — never "default":
  "today".`,

  `Important role rules:
* Every view and page task description MUST state the min_role explicitly, e.g. "Set min_role
  to admin (1)." or "Set min_role to user (80).". Never omit it.
* Role values: admin=1, staff=40, user=80, public=100. Use the value that matches who will
  use the view or page — admin (1) only for views that admins exclusively need (system config,
  user management); staff (40) for views used by internal employees who are not admins (e.g.
  lawyers, agents, staff members); user (80) for views used by logged-in non-staff users
  (e.g. clients, customers, members); public (100) only when the page must be accessible
  without login. Do not default everything to admin — setting min_role too restrictively
  locks out the intended users.`,

  `Important dashboard rules:
* When a dashboard for a specific role (teacher, parent, student, etc.) should show lists
  filtered to the logged-in user's own records, use a Show view of the user's profile/role
  table as an intermediary. The page embeds this Show view with extra_state_fml supplying
  the profile table's FK-to-users field (e.g. "{user_id: user.id}"), and the Show view
  embeds the list with a relation path from the profile table to the list's table. This
  makes the list show only rows reachable from the logged-in user's profile record.
  This always requires TWO separate tasks — never bundle them:
  1. A task that updates the profile Show view to embed the list(s) with the relation path
     (e.g. "update_teachers_show_embed"). This task depends on the Show view and the list view.
  2. A task that creates the dashboard page and embeds the Show view with extra_state_fml
     (e.g. "teacher_dashboard"). This task depends on the Show view update task (step 1).
  The dashboard page task's description must say: "Create a Page ... embed [profile]_show
  with extra_state_fml = {<fk_field>: user.id}" — it does NOT update any Show view.
  The Show view update task's description must say: "Update [profile]_show to embed
  [list]_list using the relation path from [profile] to [list]" — it does NOT create a Page.
* A dashboard page that shows aggregate statistics (totals, counts, revenue, etc.) must NEVER
  use client-side JavaScript fetch stubs or placeholder values. Every stat card must be backed
  by a real Saltcorn Statistic view embedded with an embed-view tag.
* For each statistic shown on a dashboard, plan a separate Statistic view task (e.g.
  "total_billable_hours_stat", "revenue_by_client_stat"). The dashboard page task must list
  all these Statistic view tasks in its depends_on.
* Statistic view tasks must be planned before the dashboard page task and have descriptive
  names that make their metric clear.
* No list view may be left orphaned. Every list view planned in the phase must be reachable
  from at least one dashboard or page — embedded directly or linked via a navigation section.
  Check each list view and confirm it appears in at least one page or dashboard task's
  description.
* No detail page may be left unreachable. Whenever a page is planned that requires an
  ?id= query parameter (a detail page, a record page), the plan MUST also include a task
  that adds a link or viewlink button to the relevant list view pointing to that page with
  the row id in the URL (e.g. /page/order_detail?id= interpolated with the current row id).
  This link task must list the page task and the list view task in its depends_on. A detail
  page with no inbound link is always a planning error — the user has no way to reach it.`,

  `Important home page rules:
* Every role should land on the right page after visiting /. Plan a single task "Set home
  pages by role" that depends on all relevant page tasks and configures home_page_by_role for
  every role in one step.
* Role IDs: public=100, user=80, staff=40, admin=1.
* Landing/marketing page (public-facing intro): min_role must be 100 (public). It MUST include
  visible links to /auth/login (Log in) and /auth/signup (Create an account). Set as home for
  role 100 (public).
* If there is an admin dashboard page, set it as home for role 1 (admin).
* If there is a dashboard or main page for regular users or staff, set it as home for role 80
  (user) and/or role 40 (staff) as appropriate.
* The "Set home pages by role" task description must list every role→page mapping explicitly
  using the exact page names planned in this task list, e.g.: "Set home_page_by_role: public
  (100) → landing, user (80) → client_dashboard, staff (40) → staff_dashboard, admin (1) →
  app_admin_dashboard." Never use "admin_dashboard" as a page name — it is reserved by the
  platform.`,

  `Important bulk import/export rules:
* A plain Edit view creates or edits a single record — it is NOT a bulk import tool. Never
  plan an Edit view as a solution for bulk data import.
* List views have no built-in export feature — do not plan an export button or column as part
  of a list view.
* Bulk import and export functionality (e.g. CSV) must always be placed on a dedicated
  management or admin page as embedded views, using whatever import/export viewtemplate is
  available from an installed plugin.
* Bulk import and bulk export for the same table are always two separate tasks with two
  separate view names. Never combine them into a single task.`,

  `Important plugin rules:
* If multiple plugins need to be installed, combine them ALL into a single task named
  "Install plugins" that lists every required plugin name. Do NOT create a separate task per
  plugin.`,

  `Important dependency rules:
* Every name in a task's depends_on MUST exactly match the name field of another task in the
  same plan_tasks call. Never reference a name that is not present in the tasks array — not a
  concept, not a table name, not a made-up label. If you find yourself writing a depends_on
  entry whose name does not appear as a task name in the list, either add the missing task or
  remove the dependency.
* Before calling plan_tasks, mentally verify: for every task, every name in its depends_on
  array appears as the name of another task in the array.
* Before calling plan_tasks, check for circular dependencies. A circular dependency means task
  A depends on B, and B depends on A (directly or transitively). A circular dependency causes
  a deadlock — neither task can ever start. To fix it: identify which dependency in the cycle
  is the weakest (i.e. view A only needs to embed view B, but B does not strictly require A
  to exist). Remove that dependency from A's depends_on so A can be created first. Then decide
  whether B's content is still useful without being embedded in A at creation time. If the
  embed is important, add a separate update task (e.g. "update_A_embed_B") whose description
  says to update view A to embed view B, and whose depends_on lists both A and B. Only add
  this extra update task when the embed is genuinely important for the finished product — do
  not create update tasks for minor or optional embeds, as each extra task is expensive. A
  good rule of thumb: add an update task only if omitting the embed from the final view would
  visibly break a user workflow.`,

  `Important email rules:
* Use the built-in \`send_email\` trigger action to send emails. SMTP configuration (host,
  credentials, sender address) is managed by the platform administrator in System
  Configuration — it is not an application concern. Do NOT create any table for SMTP or email
  settings, and do NOT plan any task to configure SMTP.
* Every \`{{}}\` interpolation in any workflow step (email body, email subject, filename,
  prompt template, etc.) must reference a variable that already exists in the workflow context
  at the point the step runs. Do NOT use fallback expressions such as
  \`{{invoice_date || new Date().toISOString()}}\` — if the variable is not defined, the
  interpolation engine throws before the \`||\` fallback can execute. If a value might not be
  in context at that point, retrieve or compute it in an earlier step and store it under a
  known key.`,

  `Important schema/table rules:
* The database schema is already fully designed and implemented before task planning begins.
  ALL tables and fields needed by the application already exist. Do NOT plan any tasks that
  create tables, add fields, modify fields, or change the schema in any way. If you find
  yourself writing a task whose output is a table or a field, delete it — that work is
  already done.
* Ownership behaviour (auto-setting a FK-to-users field from the logged-in user) is configured
  in the Edit view, not in the database. Do not create tasks for it at the schema level.
* Do NOT plan tasks to add uniqueness constraints or validation to existing fields — those are
  already in the schema.
* Do NOT plan a standalone task for "access control", "row-level security", "permissions", or
  "roles". These are schema-level concerns already handled during schema design, or view-level
  concerns handled when building each view. The ownership field and sharing logic are already
  in the schema — there is nothing extra to configure as a separate task.`,
];

const implementation_rules = [
  `Important: JsCode server-mode views run on the server and must return an HTML string.
The following globals are available: Table, View, User, File, db, user, req, state,
markupTags, Actions, emitEvent, moment.
The state object contains URL query parameters — use state.start_date, state.end_date etc.
to read user inputs submitted via a GET form.
Never use process.env, window, document, or fetch in server mode. Never return a
{ code: "..." } object — always return an HTML string.
require() is NOT available — do not import lodash or any other module. Use moment or plain
JavaScript Date for all date formatting and arithmetic.`,

  `Important: Workflow TableQuery steps can only query user-created application tables.
Internal Saltcorn system tables whose names start with _sc_ (such as _sc_files,
_sc_triggers, _sc_views, _sc_pages, etc.) are NOT registered as application tables and will
throw "Table X not found" at runtime if used in a TableQuery step.`,

  `Important: After a page_to_pdf workflow step with to_file=true, the workflow context
automatically contains pdf_file_id (the database id of the saved file) and pdf_path_to_serve.
No extra run_js_code or TableQuery step is needed to look up the file — just use pdf_file_id
directly in the following modify_row step.`,

  `Important: Any export or output step (PDF generation, CSV export, email with attached data,
etc.) reads the database at the moment it runs. It will only reflect rows that already exist
at that point. Always place every export/output step AFTER all insert, update, and aggregate
steps that produce the data it needs to include. The correct order is: (1) insert/update all
rows, (2) compute and store aggregates, (3) export/output, (4) send notifications (if needed).
Moving an export step earlier — for example right after inserting a parent row but before its
child rows are inserted — will produce empty or incomplete output even though the data looks
correct when viewed in the browser later.`,

  `Important: The workflow step_type for running custom JavaScript is \`run_js_code\`
(snake_case). Do NOT use \`RunJsCode\` or any PascalCase variant — those will throw "Action
or trigger not found" at runtime. Built-in step types (TableQuery, ForLoop, SetContext, etc.)
are PascalCase, but run_js_code is the exception and must always be written in snake_case.`,

  `Important: \`run_js_code\` bodies execute inside a CommonJS (vm2) sandbox — ES module
syntax is not supported and will throw "SyntaxError: 'import' and 'export' may only appear
at the top level". Never use \`import\`, \`export\`, \`export const\`, or \`export default\` in
any \`run_js_code\` body. Use plain variable assignments (\`const x = ...\`) and the
\`return\` statement to produce output. The step name is set in the workflow step definition,
not inside the code — do NOT write \`export const name = '...'\`.`,

  `Important: \`run_js_code\` is a plain code body — NOT a named function or module.
Never wrap the code in \`async function run(params, context) { ... }\` or any other function
declaration. Write the statements directly, as if they are the body of an async function.
Workflow context variables (set by SetContext, ForLoop, or trigger row fields) are available
as direct local variables — e.g. use \`id\` directly, not \`params.id\` or \`context.id\`.
Never hallucinate a \`params\` or \`context\` argument — those do not exist.
To read or write application data, use the provided Table API:
  const tbl = await Table.findOne({ name: 'my_table' });
  const row = await tbl.getRow({ id });
  await tbl.updateRow({ field: value }, id);
  const newId = await tbl.insertRow({ field: value });
  const rows = await tbl.getRows({ where: { field: value } });
Never use \`fetch\` or any HTTP call to read or update your own application's data — that is
always a hallucination. Internal data operations MUST go through the Table API.
Do not add comment blocks describing "exports", "params", "apiUrl", or "Expected inputs" —
those concepts do not apply inside \`run_js_code\`.`,

  `Important: Saltcorn where-clause objects use nested operator objects — NEVER use
space-separated key suffixes. Space-separated keys like \`"entry_date >="\` or
\`"project_id in"\` are stripped by sqlSanitize (spaces are removed), producing invalid column
names like \`entry_date>=\` or \`project_idin\` that crash Postgres.
The correct operators are: \`{field: {gt: value}}\` for >, \`{field: {gt: value, equal: true}}\`
for >=, \`{field: {lt: value}}\` for <, \`{field: {lt: value, equal: true}}\` for <=,
\`{field: {in: [...array...]}}\` for IN (generates \`field = ANY($1)\`),
\`{field: null}\` for IS NULL.
This applies in both JsCode and workflow TableQuery steps.`,

  `Important: To add an action button to a Show view, add a segment directly into the
\`layout.above\` array — do NOT add to the top-level \`actions\` array alone.
The \`actions\` array is metadata only; it does NOT render any button.
The layout segment that renders the button looks like:
\`{"type": "action", "rndid": "act1", "action_name": "trigger_name", "action_label": "Label",
"action_style": "btn-primary", "confirm": true, "minRole": 40}\`.
CRITICAL: every action segment MUST include a \`rndid\` field — a short unique string such as
"act1", "act2", "issue_inv", etc. If \`rndid\` is missing or undefined, the button will be
rendered but clicking it sends \`rndid: "undefined"\` to the server, which crashes with
"Cannot read properties of undefined (reading 'action_name')". Never omit \`rndid\`.
Each action segment in the same layout must have a different \`rndid\`.
The \`action_name\` must exactly match the trigger's name. The \`actions\` array entry is
optional and can be omitted entirely.
When the trigger was created in the same plan, copy its name verbatim from the trigger task's
description or name field — do not paraphrase, abbreviate, or infer it.
When the trigger already exists, read its exact name from the existing triggers list — never
guess based on what you think the name should be.`,

  `Important: When a trigger is invoked from a Show view action button, the trigger MUST have
its \`table\` set to the view's table. Saltcorn will then automatically pass the full row as
the initial workflow context — every field value is available by its field name (e.g. \`id\`,
\`name\`, \`contact_email\`). Do NOT attempt to pass row data through a \`state\` property on
the \`actions\` array entry — that property is not supported and is silently ignored.
If the trigger has no table set, the workflow starts with no context and all field references
will throw "is not defined".`,

  `Important: Some fields are non-stored (virtual) calculated fields — they have no database
column and are computed on-the-fly by Saltcorn. Never include such fields in modify_row, SQL
UPDATE statements, or recalculate_stored_fields calls. Only fields that exist as actual
database columns (regular fields and stored calculated fields) can be written. If a calculated
field needs updating, it will refresh automatically when the fields it depends on change.`,

  `Important: When a Show view needs to display related rows (e.g. an invoice showing its line
items), embed a List view for those related rows — NOT an Edit view. Embedding an Edit view
inside a Show view is almost never correct: it renders a form with inputs, save buttons, and
date pickers inline in a read display. The only rare exception is an intentional inline-edit
pattern where the user explicitly needs to edit related rows directly inside the parent Show
view. For all other cases — displaying related data, print pages, dashboards — use a List view.
If no suitable List view exists yet, plan a separate List view task for the related table and
list it in depends_on before the Show view task.`,

  `Important: Do NOT use the GoBack action for cancel buttons in Edit views. The GoBack action
always calls history.back(), which breaks when the view is opened inside a popup modal.
Instead, add a link segment with url set to the following JavaScript — it closes the Saltcorn
modal (#scmodal) if one is open, and falls back to history.back() for standalone use:
javascript:var m=document.getElementById('scmodal');var mi=m&&bootstrap.Modal.getInstance(m);if(mi)mi.hide();else history.back()
— style it as btn btn-outline-secondary to match the standard cancel appearance.`,

  `Important: In List view create_view_showif expressions (and any other showif / formula
fields evaluated against the URL state), the variable \`state\` does NOT exist. The state
object is passed as \`row\`, and each key of the state is also available as a bare variable.
Use \`row.project_id\` or just \`project_id\` — never \`state.project_id\`.`,

  `Important: A Saltcorn modify_row trigger has exactly these configuration fields:
\`name\` (string), \`action\` = "modify_row", \`when_trigger\` ("Insert" or "Update" — NEVER
"Validate"), optionally \`table_name\`, and \`configuration.row_expr\` — a single-line JS
expression returning an object of field→value pairs.
Example: \`{hours: Math.round(parseFloat(hours) * 100) / 100}\`.
Do NOT invent other formats (no \`match\`, \`actions\`, \`set\`, \`columns\` keys — those belong
to other platforms). NEVER use \`when_trigger: "Validate"\` with modify_row — Validate fires
before the row exists in the database so there is no id to update, causing a crash on insert.
Use \`when_trigger: "Insert"\` to normalise on new rows, and a separate
\`when_trigger: "Update"\` trigger if normalisation is also needed on edits.
Keys in the row_expr object MUST be bare field names — NEVER table-qualified names like
\`{"table_name.field_name": value}\`. Table-qualified names are silently mangled by SQL
sanitization (the dot is stripped), producing a non-existent column name and a runtime error.
Use only \`{field_name: value}\`.`,

  `Important: modify_row \`row_expr\` values and all other formula/expression fields are parsed
as a single JavaScript expression by acorn. They MUST be written on one line — no literal
newlines anywhere in the expression, including inside string literals. A literal newline
inside a quoted string causes "Unterminated string constant" and crashes the trigger.
Write the entire expression on a single line: \`{field1: expr1, field2: expr2}\`.
This single-line rule applies ONLY to \`row_expr\` and similar single-expression fields —
NOT to \`run_js_code\` steps in workflows. Workflow \`run_js_code\` code is a full JavaScript
function body and must use real newlines (encoded as \`\\n\` in JSON). Never write literal
backslash-n (\`\\\\n\`) inside \`run_js_code\` code to simulate newlines — vm2 will reject it
with "Expecting Unicode escape sequence".`,

  `Important: In workflow TerminateWorkflow steps, the "return value" / error message field is
evaluated as a JavaScript expression — it is NOT plain text. Always wrap the message in
quotes: \`"No billable hours found."\`. A bare unquoted sentence causes a SyntaxError at
runtime.`,

  `Important: When a workflow step inserts a row (e.g. \`insert_any_row\`, \`upsert_one\`), the
row expression MUST include a value for every NOT NULL field (marked as NOT NULL in the table
listing above) that has no database default. A NOT NULL field that has a default value (shown
as "default: X" in the table listing) can be safely omitted — the database will fill it in
automatically. Omitting a NOT NULL field causes a "null value in column X violates not-null
constraint" error at runtime. If the real value is computed in a later step (e.g. a total
calculated after inserting line items), supply a safe placeholder — \`0\` for numeric fields,
\`''\` for text — so the initial insert succeeds, then update the row in the subsequent step.
Exception: File-type fields hold a file ID and cannot be given a placeholder value — always
declare File fields as \`required: false\` (nullable) unless the file is guaranteed to exist
at the moment the row is first inserted.`,

  `Important: In Show view layouts, every field must be its own separate segment with
\`"type": "field"\` (singular). There is NO \`"type": "fields"\` (plural) segment — using it
crashes with "unknown layout segment" at runtime. Never bundle multiple fields into a single
segment. Each field appears as an individual element in the layout array, for example:
\`{"type": "field", "field_name": "invoice_date", "fieldview": "show"}\`.`,
];

const fieldview_selection_rules = [
  `For numeric fields (Integer, Float, Money, Decimal) the default fieldview is "edit" — a
plain text input. Only use a specialised numeric fieldview (e.g. "number_slider", "range",
"spin") when it is clearly appropriate for the data: a slider makes sense for a bounded
rating or percentage, not for an open-ended value like a price, rate, or quantity. The
existence of an alternative fieldview in the platform is not a reason to use it — "edit" is
the right default and should be the first choice unless there is a specific UX reason to do
otherwise.`,

  `For date fields always prefer fieldview "flatpickr" when available — it provides the best
user experience and works for both regular dates and day-only dates. Only use fieldview
"edit_day" as a fallback when the field has day_only=true and flatpickr is not installed.
Never set a flatpickr configuration key "default" to a string like "today" — it is not a
valid date value and will throw at runtime. To pre-fill the picker with the current date/time,
set "default_now": true in the flatpickr field configuration instead. When the underlying
Date field has day_only=true, also set "day_only": true in the flatpickr fieldview
configuration — this disables the time picker and formats the value correctly.`,

  `For String fields that have an options attribute (a comma-separated list of fixed choices),
use fieldview "select" — this renders a dropdown with those options. Do not use
"select_by_code" for fields with fixed options.`,

  `File-type fields use dedicated fieldviews — never the generic "edit" or "show" fieldview.
In edit/form views use "upload" (file input) or "select" (pick existing file). In read-only
views (Show, List) use "Download link", "Link", "Show Image", or "Thumbnail". Using "edit"
or "show" on a File field causes a runtime error.`,
];

const task_planning_closing = [
  `Your plan should not include any clarification or questions to the product owner. The
information you have been given so far is all that is available. Every step in the plan
should be immediately implementable in Saltcorn. You are writing the steps in the plan for a
person who is competent in using saltcorn but has no other business knowledge.`,

  `Do not include any steps that contain planning, design or review instructions. You are only
writing a plan for the engineer building the application. Every step in the plan should have
the construction or the modification of one or several application entity types.`,

  `Description length: keep descriptions concise. Simple tasks (a single view, trigger, or
page) need only 1–3 sentences. Complex tasks (multi-step workflows, views with several
embedded components) may use more, but stop once all actionable specifics are covered — do
not re-explain steps already implied by the context, add parenthetical asides, or repeat the
same point in different words. Never pad a short task description just to appear thorough.`,
];

const req_gen_rules = [
  `Important rules for generating requirements:
* Every requirement must be directly traceable to something stated in the description,
  audience, or core features above. Do not infer, invent, or add features that are not
  explicitly mentioned — even if they seem like an obvious addition.
* Do not generate any requirement that falls under the Out of scope section above.
* Only generate requirements for core functionality. Do not generate requirements for
  features described as optional, "nice to have", "could support", or "can be added
  later" — omit them entirely.
* Do NOT generate a requirement for integration with any external third-party system
  (e.g. QuickBooks, Xero, Stripe, Slack, external APIs, webhooks) unless the
  specification explicitly names the system AND describes exactly what must be
  exchanged. A vague mention like "integration with accounting systems" is not
  sufficient — skip it.
* Do not generate requirements that are already handled by the platform (e.g. user
  registration, login, password management — these are built-in).
* Priority reflects how central the feature is to the core purpose of the application.
  Assign 5 to features without which the application cannot function at all, 3–4 to
  features that are important but not blocking, 1–2 to minor convenience features. Do
  not assign 5 to everything.`,
];

const phase_gen_rules = [
  `Rules for generating phases and their requirements:
* Break the application into 3–6 phases. Fewer is better — only split where there is a
  genuine dependency boundary or a meaningful delivery milestone.
* Every requirement must be directly traceable to something stated in the specification.
  Do not infer, invent, or add features that are not explicitly mentioned.
* Only include requirements for core functionality. Omit anything described as optional,
  "nice to have", or "can be added later".
* Do NOT include requirements for integration with external third-party systems unless
  the specification explicitly names the system and describes exactly what must be
  exchanged.
* Do not include requirements already handled by the platform. Saltcorn provides
  built-in user registration (/auth/signup), login (/auth/login), password management,
  and role-based access control — do not generate requirements to build custom versions
  of these. Application pages such as a landing page or a dashboard are valid
  requirements and must be included; a landing page will naturally link to /auth/login
  and /auth/signup.
* Priority reflects how central the requirement is to the core purpose of its phase.
  Assign 5 to requirements without which the phase cannot be considered done, 3–4 to
  important but not blocking, 1–2 to minor enhancements. Do not assign 5 to everything.
* Each phase's requirements must be self-contained: a later phase may depend on earlier
  phases having been built, but should not require anything from future phases.
* Place foundational data and authentication requirements in the earliest phase.`,
];

const phase_scope_rule =
  "Plan only the tasks needed to implement the requirements listed above. Do not plan\n" +
  "tasks for requirements belonging to other phases. This applies especially to database\n" +
  "tables — do not create a table unless it is directly needed by a requirement listed\n" +
  "above, even if you can tell it will be needed in a later phase.";

const no_roles_table_rule =
  "Important: Do NOT plan any task that creates a Roles table, a permissions table, or\n" +
  "any table describing what roles are allowed to do. Saltcorn has a built-in role system\n" +
  "(1=admin, 40=staff, 80=user, 100=public) and every entity (view, page, table) already\n" +
  "has a min_role property for access control. There is nothing to store in the database\n" +
  "— access control is configured on each entity directly.";

const exec_tool_call_rule =
  "Important: Every tool call must contain only the final, complete result — never\n" +
  "intermediate reasoning, planning notes, markdown code fences, TODO comments, or\n" +
  "placeholder text. Compose the full content in your reasoning first, then pass only\n" +
  "the finished result to the tool. A page or view that contains any of these is\n" +
  "broken and will be visible to end users exactly as written.";

const exec_schema_rule_plugin =
  "Important: This is a plugin installation task. Install the plugin described using\n" +
  "the Install Plugin skill. Do not create tables, views, pages, or triggers.";

const exec_schema_rule_data_model =
  "Important: This is a data model task. Use the database design tool to create or\n" +
  "modify tables and fields, or use the Registry editor (set_entity) for platform\n" +
  "configuration such as creating custom roles. Do not create any views, pages, or\n" +
  "triggers — only schema and platform configuration changes belong in this task.";

const exec_schema_rule_feature =
  "Important: This is a feature task. Do NOT use generate_tables or modify any tables\n" +
  "or fields — schema changes are handled by separate data model tasks that run\n" +
  "before this one.";

const plugin_type_instruction = [
  `Generate ONLY tasks with task_type "plugin" — tasks that install plugins from the
Saltcorn plugin store.`,

  `Before deciding which plugins to plan, carefully read the full application specification
and phase requirements and reason through what the application will need. Do not wait for
keywords — infer from context:
- Will the application store or display dates or times in any form? (e.g. entry dates,
  deadlines, schedules, appointments, logs) → a date/time picker plugin will be needed
- Will the application handle money, rates, prices, fees, invoices, or any numeric value
  representing a currency or billing amount? → a money or decimal field plugin will be needed
- Will any entity be related to multiple instances of another entity in both directions?
  (e.g. lawyers assigned to projects, products in orders) → a many-to-many plugin will be needed
- Will users enter or display formatted or multi-line text beyond a plain string?
  → a rich text editor plugin will be needed
- Will any page show charts, graphs, totals, or aggregated statistics?
  → a chart plugin will be needed
- Will the application deal with physical locations, addresses, or maps?
  → a map plugin will be needed
- Will users upload or attach files or images? → a file upload plugin will be needed
For each need you identify, check the available plugin list above for a matching plugin that
is not already installed, and plan a task for it.`,

  `Critical: only plan a plugin installation task when the built-in actions, field types,
and view templates genuinely cannot cover the requirement. Inserting rows, updating fields,
running workflow steps, and computing aggregates are all covered by built-in workflow actions
— only install a plugin when no built-in equivalent exists. For example, do NOT install the
'sql' plugin to insert rows or compute totals — use built-in workflow steps instead.`,

  "Each task installs exactly one plugin. If no plugins are needed, call plan_tasks with an empty tasks array.",
];

const data_model_type_instruction = [
  `Generate ONLY tasks with task_type "data_model" — tasks that create or modify database
tables or fields. Do not generate any feature tasks.`,

  `Each task should implement exactly one deliverable — one table or a closely related set of
fields. Keep tasks small and focused. Tasks may depend on other tasks within this phase using
the depends_on field.`,

  `Critical: only create tables and fields that are directly required by the requirements of
THIS phase listed above. Do not anticipate future phases or add tables speculatively because
they will eventually be needed. If a requirement is not listed above, it belongs to another
phase — do not implement it here.`,

  `Important: Each task description must fully specify uniqueness (unique=true) and required
(not_null=true) constraints on every field — do not leave these for a later step. Never
mention constraints on the 'id' field — it is the primary key and is always unique and
not-null by definition.`,

  "Important: Ownership (auto-populating a FK-to-users field from the logged-in user) is a view-level concern — task descriptions must not mention it. Just describe the FK field normally.",

  "Important: Do NOT plan any task that creates a table for SMTP, email configuration, or mail server credentials — email config is managed by the platform administrator.",
];

const feature_type_instruction = [
  `Generate ONLY tasks with task_type "feature" — tasks that create views, pages, triggers,
or workflows. Do not generate any data_model tasks.`,
];

const error_fix_closing = [
  "Either call plan_tasks with exactly one fix task, or call cannot_fix if you cannot " +
    "determine a concrete fix from the information above. Do not invent a task just to " +
    "produce output — prefer cannot_fix over a vague or speculative task.",

  "Rules for the plan_tasks description (only if you can diagnose the fix):\n" +
    "- Name the exact Saltcorn entity (view, trigger, page) to fix.\n" +
    "- Describe what is wrong and what kind of fix is needed. Where you can clearly identify " +
    "them from the config shown above, state each broken field, its current value, and the correct value. " +
    "If you are not certain of the exact values, describe the problem instead — do not guess specific values.\n" +
    "- Cover ALL fields of the same error class in one task.\n" +
    "- Prefer fixing a broken reference over removing the element that contains it. " +
    "Only remove an element when there is genuinely no valid replacement. " +
    "Example: a viewlink column referencing a missing view should have its view name " +
    "updated to an existing view — not have the column deleted.\n" +
    "- End with: 'Use get_entity to load the current config, diagnose the exact values, apply the fix, and save with set_entity.'\n" +
    "- One or two sentences. No prose, no save/test instructions.",
];

const feature_exec_rules = [
  `Important: The "users" table is built-in. Passwords are platform-managed — never add
a password field to a view. Signup uses the built-in page at /auth/signup, login at
/auth/login. Do NOT create triggers for registration or email verification — the
platform handles this natively. Do NOT create any Edit, Show, or List view whose
underlying table is the built-in users table — user records are managed entirely by
the platform.`,

  `Important: On landing pages, place Log in / Create account buttons in no more than
two locations (e.g. navbar and one hero call-to-action). Do not repeat them in a third
"Get started" section or anywhere else. For links that take an already-authenticated
user to their dashboard, use href="/" — not /auth/login.`,

  `Important: Never add Log in (/auth/login) or Create account (/auth/signup) links to
role-specific dashboards or any page whose min_role is not public (100). A teacher
dashboard, student dashboard, parent dashboard, or any page with min_role 40, 80, or 1
is only reachable by users who are already authenticated — adding auth links there is
wrong and confusing. Auth links belong only on public-facing pages (landing pages,
marketing pages, min_role 100).`,

  `Important: Saltcorn page URLs always use the prefix /page/. To link to a page named
"teacher_dashboard", the href must be "/page/teacher_dashboard" — NOT "/teacher_dashboard".
This applies to every link, button, or navigation item that points to a Saltcorn page,
regardless of where the link appears (landing page, navbar, other pages, etc.).
Views use /view/view_name — also with the /view/ prefix, not a bare name.

To add a link column to a List view that navigates to a detail page with the current row
id, use a Link column (not ViewLink — ViewLink only targets views, not pages). The URL
must be a JavaScript formula (isFormula.url = true) using a template literal so that the
row's id is substituted at render time. Static URL strings are NOT interpolated —
{{id}} does NOT work in link URLs and must never be used there.
The column entry in the columns array and the corresponding layout.besides contents
segment MUST both include url, text, and isFormula — omitting any field leaves the
link empty or broken:
  columns entry:
    {"type":"Link","url":"\`/page/order_detail?id=\${id}\`","text":"Detail",
     "link_src":"URL","link_style":"btn btn-sm btn-outline-secondary",
     "isFormula":{"url":true}}
  layout.besides contents segment:
    {"type":"link","url":"\`/page/order_detail?id=\${id}\`","text":"Detail",
     "link_src":"URL","link_style":"btn btn-sm btn-outline-secondary",
     "isFormula":{"url":true}}
Both the columns array entry and the layout segment must be present and consistent.
In the url formula, row fields are available by name: id, title, name, etc.
Use a JS template literal (backtick string): \`/page/order_detail?id=\${id}\``,

  `Important: Do not name any page or view "Admin dashboard" — that name is reserved by
the Saltcorn platform. For pages intended for role 1 (admin), use a name like "App
admin dashboard" or prefix it with the application name (e.g. "Law Firm admin
dashboard").`,

  `Important: Dashboard stat cards must show real data using embedded Saltcorn Statistic
views (using embed-view tags, e.g. <embed-view viewname="total_hours_stat"></embed-view>).
Never use client-side JavaScript fetch stubs, commented-out fetch code, or static
placeholder values (e.g. "—", "Loading...") for statistics. If a Statistic view for a
metric does not exist yet, it must have been created in an earlier task — do not invent
placeholder JS instead.`,

  `Important: When creating a page or view, always set min_role based on the intended
audience: 1 for admin-only, 40 for staff and above, 80 for logged-in users and above,
100 for public. Never default to public (100) unless the page or view is explicitly
intended for unauthenticated users (e.g. a landing page). A dashboard or view for
clients/users is role 80, a staff page or view is role 40, an admin page or view is
role 1.`,

  `Important: Two-factor authentication (2FA/TOTP) is fully built into the platform. To
configure it, call set_entity directly with entity_type "system-configuration-value"
and entity_name "twofa_policy_by_role". The entity_definition must be the plain JSON
object itself — for example: {"1": "Mandatory", "100": "Disabled"}. Do NOT wrap it in
{"type": "json", "value": ...} or any other envelope. Read the current value first with
get_entity and merge rather than overwrite. Do NOT create a workflow or trigger to do
this.`,

  `Important: To set a page as the home page for a role, call set_entity directly with
entity_type "system-configuration-value" and entity_name "home_page_by_role". The
value is a JSON object mapping role IDs to page names — Role IDs: public=100, user=80,
staff=40, admin=1. The entity_definition must be the plain JSON object itself — for
example: {"100": "landing", "80": "client_dashboard"}. Do NOT wrap it in {"type":
"json", "value": ...} or any other envelope. Read the current value first with
get_entity so you can merge rather than overwrite. Do NOT create a workflow or trigger
to do this — use set_entity directly.`,

  `Important: If the task description mentions adding a viewlink, linking rows to another
view, or a button that opens another view from a list — that viewlink column MUST be
present in the finished view. Do not skip it. Viewlinks require calling
get_relation_paths first to obtain the relation string before generating the layout.`,

  `Important: Every List view must include a delete action column unless the table is
explicitly read-only. Use the built-in "Delete" action type for this column.`,

  `Important: Before creating or updating any view or page that embeds, links to, or
opens another view (including viewlinks, action buttons, and ajax_modal calls), call
list_entities (entity_type "view") to get all existing view names. Only reference
views that appear in that list — never invent a name or assume a view exists. If a
view is not in the list, omit it or use a simple "Coming soon" placeholder — never
write conversational text, explanations, or instructions to the user inside the HTML.
Always create the page with whatever views exist. Do the same for pages: call
list_entities (entity_type "page") before linking to any page by name.`,

  `Important: Before placing any reference to a view on a page — whether as an embed, a
button, a link, or any other navigation element — check whether that view requires state
(e.g. an id) that the page cannot supply. A page can only supply state from URL query
params (accessed in extra_state_fml with a $ prefix, e.g. $id for ?id=45) or from
extra_state_fml using user.id for the logged-in user's own record.
If a view requires a specific row id that is neither in the URL nor derivable from the
logged-in user, do NOT reference it on the page in any form:
• Do NOT embed it — it will render empty or broken.
• Do NOT add a button or link to it — the URL will have no id and the view will show
  "No row selected" or crash. This applies even if the link looks like a simple
  navigation button (e.g. "Class-teacher assignments" linking to a view that needs a
  class id). A link without the required id is always wrong.
Instead:
• Add a ViewLink column in the relevant List view, where the row id is resolved via the
  relation path.
• Or embed the view inside a Show view of the relevant table using state: "shared" and
  the relation path.
If there is no clean way to supply the required state on a dashboard page, place the
access point in the List view or a Show view — not on the dashboard at all.`,

  `Important: To embed a list on a dashboard page filtered to the logged-in user's own
records (e.g. a teacher seeing only their classes), use this two-level pattern:
1. On the page: embed a Show view of the user's profile/role table (e.g. teachers_show)
   with state: "shared" and extra_state_fml set to the profile table's FK-to-users field,
   e.g. extra_state_fml: "{ user_id: user.id }" (replace user_id with the actual field
   name that is the FK from the profile table to users).
2. Inside that Show view: embed the list view with state: "shared" and a relation field
   containing the path from the profile table to the list's table, found via
   get_relation_paths. Example: relation: ".teachers.forms$form_teacher_id.classes$form_id"
   traverses teachers → forms → classes.
The page segment looks like:
  {"type":"view","view":"teachers_show","state":"shared","extra_state_fml":"{ user_id: user.id }"}
The Show view layout segment for the list looks like:
  {"type":"view","view":"classes_list","state":"shared","relation":".teachers.forms$form_teacher_id.classes$form_id"}
Always call get_relation_paths to find the correct relation string — do not guess it.
This pattern is always split into two separate tasks by the planner:
- Task A updates the Show view to embed the list — it calls set_entity on the Show view
  and is done when the Show view layout is saved. It does NOT create a page.
- Task B creates the dashboard page and embeds the Show view with extra_state_fml — it
  calls set_entity to create the page and is done when the page exists. It does NOT
  update the Show view.
CRITICAL: If your task description says "Create a Page", you must call set_entity to
create the page. Updating a Show view alone does not fulfil a page-creation task.
If your task description says "Update [view] to embed [list]", you must call set_entity
on the view. Creating a page alone does not fulfil a view-update task.`,

  `Important: A plain Edit view creates or edits a single record — it is NOT a bulk CSV
import tool. Never use an Edit view as a solution for CSV import. List views have no
built-in CSV export feature — do not add an export button or column to a List view.
CSV import and export functionality must always be placed on a dedicated management or
admin page as embedded views, using whatever import/export viewtemplate is available.`,

  `Important: Every HTML page (page_type HTML) must include a toast notification area so
that alerts and success messages are visible. Place this div just before the closing
</body> tag:
<div id="toasts-area" class="toast-container position-fixed top-0 start-50 p-0"
style="z-index:999;" aria-live="polite" aria-atomic="true"></div>`,

  `CRITICAL: When creating a page, default to page_type "Layout page". This creates a
proper Saltcorn layout built from segments (view embeds, containers, columns, etc.)
and is the correct choice for dashboards, print pages, and any page that embeds views.
Use page_type "Marketing page" only for public-facing promotional pages (landing pages,
brochures). Use page_type "Application page" only for standalone HTML pages that do
not embed Saltcorn views. In particular, NEVER use "Marketing page" or "Application
page" for any page used with page_to_pdf — page_to_pdf cannot render HTML-backed
pages. If you find yourself about to write raw HTML (<!doctype>, <html>, <head>,
<body>), stop and ask yourself: does this task explicitly require a standalone HTML
page — like a public landing page, a marketing page, or a dashboard? If not, use
page_type "Layout page". Do not output HTML to the conversation.`,

  `Important: Passing state into an embedded view — two independent concerns:
• state: "shared" passes the parent view's URL/state variables (e.g. query params)
  down into the embedded view. It does not describe a relationship.
• relation: ".sourcetable.segment..." describes the FK path from the parent view's
  table to the embedded view's table, so Saltcorn knows which row to show. Use
  get_relation_paths to find the correct string.
These two fields are independent and can coexist on the same segment:
  {"type":"view","view":"my_view","state":"shared","relation":".parenttable.fk_field"}
Inside a Show or Edit view, always set the relation field so Saltcorn can resolve the
correct row. Add state: "shared" as well if the embedded view also needs URL state
variables passed through.
• On a Page: the relation field is not processed — use state: "shared" to pass URL
  query params through to embedded views.
  There are TWO completely separate mechanisms for referencing a row id — do NOT confuse them:
  1. \`{{id}}\` — Saltcorn HTML template syntax. Use ONLY inside raw HTML string values
     (e.g. href="/page/order_detail?id={{id}}"). This is rendered server-side when the
     surrounding view/page displays a row. It is NOT JavaScript and cannot be used in
     extra_state_fml.
  2. \`$id\` — JavaScript expression for extra_state_fml on a page or Show view. Reads the
     ?id= value from the URL query string. Use this whenever you need to pass a URL query
     parameter into an embedded view's state formula.
  The \`user\` variable (no prefix) gives the logged-in user object.
  Examples:
    URL query param:   extra_state_fml: "{order_id: $id}"   (passes ?id=45 as order_id)
    Logged-in user:    extra_state_fml: "{user_id: user.id}"
    HTML href:         href="/page/order_detail?id={{id}}"   (in a raw HTML block inside a List)
  Full segment example: {"type":"view","view":"my_view","state":"shared","extra_state_fml":"{order_id: $id}"}
  Never write {order_id: id} — \`id\` without $ is undefined in extra_state_fml on a page.
  Never write extra_state_fml: "{order_id: {{id}}}" — \`{{id}}\` is HTML template syntax, not JS.
  Show views embedded on a page also need extra_state_fml to receive their row id —
  they do NOT pick it up automatically from the URL. A Show view without extra_state_fml
  on a page will display "No row selected" regardless of what is in the URL.
  Pass the page's id query param directly as the Show view's id:
    extra_state_fml: "typeof $id !== \\"undefined\\" ? {id: $id} : {}"
  Filtered list views on the same page pass it as their FK field instead:
    extra_state_fml: "typeof $id !== \\"undefined\\" ? {order_id: $id} : {}"
  Defensive pattern — pages opened without the expected query parameter must not crash.
  Always guard URL query param references with a typeof check and return an empty object
  when the parameter is absent, so the embedded view receives no forced filter instead of
  crashing on an undefined value.
  Use this pattern for EVERY view embedded on a page that depends on a URL query param —
  both Show views (using {id: $id}) and filtered lists (using {fk_field: $id}).`,
];

const data_model_exec_rules = [
  `Important: If this task requires creating custom platform roles (beyond the four
built-in roles: 1=admin, 40=staff, 80=user, 100=public), use the Registry editor:
call set_entity with entity_type "role" and the role definition. Do NOT create a
user-defined database table for roles — platform roles are a system concern, not
application data.`,

  `Important: The "users" table is built-in and must never be modified — do not add,
remove, or alter any fields on it.`,

  `Important: Saltcorn has a built-in role system with fixed roles (1 = admin, 40 = staff,
80 = user, 100 = public). Do NOT create a Roles table, a permissions table, or any
table describing what roles are allowed to do. Access control is a platform concern:
every Saltcorn entity (views, pages, tables) already has a min_role property that
controls which role can access it. There is nothing to store in the database —
configure min_role on each entity instead.`,

  `Important: Every Saltcorn table has a primary key field named "id" that is always
unique and not-null by definition. Never set unique=true or not_null=true on the "id"
field — it is redundant and incorrect. For every OTHER field that must be unique (e.g.
unique email, unique slug), set unique=true on that field. For every other field that
must not be empty, set not_null=true. Description, notes, and other free-text fields
should NOT be not_null unless explicitly required. Do NOT leave uniqueness or required
constraints for a later step — express them fully now.`,

  `Important: Ownership configuration (automatically populating a FK-to-users field from
the logged-in user) is a VIEW-level concern and cannot be expressed in the schema. Do
not attempt to annotate fields as "ownership fields" — simply define the foreign key
field normally. Ownership will be configured when the Edit views are generated.`,

  `Important: Email and SMTP configuration (host, port, credentials, sender address) is
managed by the Saltcorn platform administrator in system settings — it is NOT stored
in the application database. Do NOT create any table for SMTP settings, email
configuration, or mail server credentials. If the application needs to send emails,
that is handled by a trigger action.`,

  `Important: Every tool call must contain only the final, complete result — never
intermediate reasoning, planning notes, or placeholder values. Compose the full schema
in your reasoning first, then pass only the finished result to the tool.`,
];

const research_questions_rules =
  "Based on the following application specification, generate clarifying questions\n" +
  "that would help better understand what the user wants to build.\n" +
  "Rules:\n" +
  "- Only ask about things that are genuinely unclear and would change what gets built.\n" +
  "- Do not ask about things already clear from the specification or answered by web research.\n" +
  "- Plain language: no abbreviations or technical terms without explanation.\n" +
  "- One idea per question. Short, direct, and easy to understand.\n" +
  "- Stop when the unclear parts are covered — 2 or 3 questions is fine. 10 is a hard maximum, not a target.";

const feedback_analyse_decision =
  "Do you have important questions about this feedback,\n" +
  "or do you already know what needs to be done?\n\n" +
  "- If you know what to do — no need to call any tool, just respond with nothing.\n" +
  "- If you have questions that are truly blocking —\n" +
  "  call ask_questions with only those. 3 is a hard maximum.\n" +
  "  Each question must be short, clear, and easy to understand.\n" +
  "  Write for a non-technical user: plain language, no jargon, one idea per question.";

const feedback_task_overrides = [
  "Generate ONLY the minimal tasks that directly implement what the feedback requests. " +
    'Do not add defensive "verify", "ensure accessible", or "check still reachable" tasks — ' +
    "those are not changes and do not belong in a task plan.",

  "Do NOT generate tasks for writing, updating, or running automated tests. " +
    "There are no automated tests in this application.",

  "When a task modifies an existing view or page, do NOT set or change its min_role unless " +
    "the feedback explicitly requests an access control change. The existing min_role is already correct.",

  "If the feedback can be implemented in a single task, use a single task. " +
    "Do not split it into more tasks than strictly necessary.",

  "Do NOT create new views, pages, or routes as a side effect of modifying an existing one. " +
    "Only create a new view or page when the feedback explicitly asks for one. " +
    "If the feedback asks to change or remove something from an existing view, only modify that view.",
];

module.exports = {
  saltcorn_description,
  task_planning_rules,
  implementation_rules,
  fieldview_selection_rules,
  task_planning_closing,
  error_fix_closing,
  feedback_task_overrides,
  feature_exec_rules,
  data_model_exec_rules,
  req_gen_rules,
  phase_gen_rules,
  phase_scope_rule,
  no_roles_table_rule,
  exec_tool_call_rule,
  exec_schema_rule_plugin,
  exec_schema_rule_data_model,
  exec_schema_rule_feature,
  plugin_type_instruction,
  data_model_type_instruction,
  feature_type_instruction,
  feedback_analyse_decision,
  research_questions_rules,
};
