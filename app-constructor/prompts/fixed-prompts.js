// Arrays of logical rules for the app constructor prompt system.
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
  `Task granularity:
* A requirement to "create and manage"/give CRUD access to an entity requires List and Edit
  view tasks for it — a page task alone does not satisfy it.
* One view per task, always. Edit, Show, and List for the same table are three separate
  tasks, three separate names/descriptions/dependencies. Don't split "create" and "edit"
  into two tasks — one Edit view handles both (no id = create, id present = edit).
* Whenever you plan List + Show for a table, you MUST also plan Edit — a List without Edit
  leaves users unable to create/modify records. Omit Edit only when requirements explicitly
  say the data is read-only.
* "Dashboard" belongs only to the page, never a view task's name/description — e.g.
  "task_list", not "task_dashboard_list".
* A dashboard is a page with view(s) embedded in it — never one task creating both a view and
  a page. A "manage"/"see"/"visibility over" requirement means: plan the List (and Edit, per
  the rule above) as its own task, then a separate page task that depends on it and embeds
  the already-built List. The page task must not define/configure the view itself. Never plan
  the page task first with the embed left for a later task — the view always comes first, and
  the page task that embeds it is the one and only follow-up, named in its depends_on.`,

  `Schema and access control:
* Saltcorn's built-in user system handles registration, login, and sessions — never plan
  tasks for these, or for anything the platform already covers ("user accounts", "secure
  login", "data per user", "sharing between users").
* Ownership (FK-to-users) fields are set automatically from the session — no custom logic
  needed.
* Never plan an Edit, Show, or List view on the built-in \`users\` table — it's fully managed
  by the platform (/auth/signup, the built-in admin panel).
* Every view/page task MUST state min_role explicitly (e.g. "Set min_role to admin (1).") —
  never omit it. admin=1, staff=40, user=80, public=100. Match the actual intended audience —
  don't default everything to admin, or you lock out the users who need it.
* The schema is already fully designed before task planning — do not plan any task that
  creates/modifies a table or field; delete any such task you find yourself writing.
  Ownership behavior, uniqueness/validation, and "access control"/"row-level security"/
  "permissions"/"roles" are all schema- or view-level concerns already handled — never a
  standalone task.`,

  `Existing entities:
* Before planning any page or view task, check the existing pages/views lists provided — do not
  create one that's already there, even under a slightly different name. Reference the
  existing entity by its exact name in dependent tasks instead.
* Never create a renamed variant of an existing view (e.g. a "my_"/"user_"/"filtered_"
  prefix); embed the existing one as-is and describe any filtering in the embedding task.
* Every role that needs a dashboard/home page must have one — either in the existing pages
  list or planned as a task.
* If a requirement refers to an already-created page under a different name, use the page's
  actual existing name rather than planning a second one.
* Any task that updates an existing page or view (e.g. "Update …", "Set min_role on …", "Add
  … to existing …") must include: "Preserve all existing embedded view configurations — do
  not drop extra_state_fml, state, relation, or any other per-segment field not explicitly
  changed by this task." The executor reads the entity with get_entity before writing it back
  and must not silently discard fields set by earlier tasks.`,

  `CRUD and views:
* Don't embed a List of a table into a Show view of that same table unless explicitly
  requested — a Show already displays one record. Never add this as a bolt-on "update ... to
  embed ..." task on an otherwise-complete plan.
* A view that needs a specific row id to function (a many-to-many assignment view, a detail
  view, a related-record manager) is its own dedicated task, created before whatever embeds
  it (listed in that task's depends_on). If it's meant to live inside a Show view, give it
  its own dedicated Show view (named after its purpose, e.g. "class_teachers_assign", not
  "..._shell_show") — keep the main record Show view separate and unmodified, and access the
  dedicated one via a List viewlink, not a dashboard embed.
* Every link/viewlink targeting a Show view MUST include \`?id={{id}}\` — without it the Show
  view has no row to display.
* A view a task embeds or links to must be its own task (per the dependency rules below).
* For each FK-to-users field, state whether it's an ownership field (auto-set from the
  session, omitted from the form) or a selector (user picks it, included in the form).
  Exception: tables representing a user's role/profile (parents, students, teachers — the
  record IS the user's role) always use a SELECTOR, never auto-set — an admin/staff member
  assigns the account, not the record's own creator.
* FK fields representing a parent context (e.g. trip_id on packing_items) are always a normal
  form selector — Saltcorn pre-fills it from the URL when opened in that context, and the
  user can pick it manually otherwise.
* Never omit a required FK field from the Edit form unless it's a FK-to-users ownership
  field. Any other required FK — even one "set by the system" — needs a form selector, or
  saving will fail with a NOT NULL error.
* Every view-creating task must name the exact view in its description — lowercase,
  snake_case, unique across the plan, and descriptive (e.g. "packing_items_edit", not just
  "edit").
* Don't plan an Edit view for a table the requirements describe as auto-populated/not
  user-editable (audit logs, import job tracking) — List/Show only, never Edit.
* A date field that should default to today must say to use "default_now": true in the
  flatpickr config — never "default": "today".`,

  `Dashboards and pages:
* A role that sees only a scoped subset of a table gets its own dashboard embedding that
  role's scoped List — never the admin/all-rows List. Embed it plainly on its own page — no
  extra state needed. Scoping lives on the List view itself, not the page: never write a page
  task description like "embed the existing [List] using include_fml on..." — that reuses
  the wrong (unscoped) List. Plan the scoped List as its own new task first (its own name,
  e.g. "[table]_user_list"), then have the page task depend on and embed that new List.
* Only when a separate profile/role table sits between the user and the entity (e.g. a
  teachers table, distinct from what's shown) — not a direct FK — use a Show view of that
  profile table as an intermediary: the page embeds the Show view with extra_state_fml (e.g.
  "{user_id: user.id}"), and the Show view embeds the list via a relation path from the
  profile table. Always two tasks, never bundled: (1) update the profile Show view to embed
  the list via the relation path, depending on both views; (2) create the dashboard page
  embedding the Show view with extra_state_fml, depending on task (1). Each task's
  description states only its own half — the page task never updates a Show view, the
  Show-view task never creates a page.
* A dashboard showing aggregate stats must use real Statistic views (embed-view tag) — never
  client-side fetch stubs or placeholders. Plan one Statistic view task per stat (descriptive
  name, e.g. "revenue_by_client_stat"), each planned before the dashboard page task and
  listed in its depends_on.
* Every list view must be reachable from at least one page/dashboard (embedded or linked) —
  an unreachable List is always a planning error.
* Every entity with CRUD views needs a page/dashboard section making its List reachable —
  staff/admin-managed entities belong on an admin/staff dashboard.
* Every page requiring an ?id= query param needs an inbound link/viewlink from the relevant
  List (with the row id in the URL), depending on both the page and the list — an
  unreachable detail page is always a planning error.`,

  `Home pages:
* Plan a single task named exactly "set_home_pages_by_role", depending on all relevant page
  tasks, that configures home_page_by_role for every role in one step. Role IDs: public=100,
  user=80, staff=40, admin=1.
* A public landing/marketing page is min_role 100, must visibly link to /auth/login and
  /auth/signup, and is home for role 100.
* Set the admin dashboard as home for role 1 if one exists — otherwise leave admin unmapped
  entirely; never fall back to the landing/any public page for admin.
* Set a users/staff dashboard as home for role 80/40 if one exists.
* The task description must list every role→page mapping explicitly by exact page name, e.g.
  "Set home_page_by_role: public (100) → landing, user (80) → client_dashboard, staff (40) →
  staff_dashboard, admin (1) → app_admin_dashboard." Never name a page "admin_dashboard" —
  the platform reserves it.`,

  `Triggers and workflows:
* A simple single-field update (e.g. mark complete/incomplete) is a trigger using modify_row,
  not a workflow — use a workflow only when multiple steps, branching, or looping are needed.
  Independent single-step actions (e.g. "mark complete" and "mark incomplete") are separate
  triggers, never one combined workflow.
* Don't mention "navigate back"/"return to context" in a trigger's description — that's a
  view-level GoBack button, not a trigger concern.
* A trigger meant to be a view's action button is normally two tasks: create the trigger,
  then update the view to add the action (depending on the trigger task). Combine into one
  task only when the view is being created fresh in this same plan.
* No run_bash_script or shell commands — use a Saltcorn plugin or built-in action instead.
* Prefer built-in workflow steps (inserts, updates, loops, aggregates, conditionals) over a
  plugin — e.g. don't use the 'sql' plugin for row inserts or totals.
* Never plan a trigger/workflow to write to a virtual (calculated) field — it updates itself
  automatically.`,

  `Dependencies:
* Completeness: every entity a task references by name that doesn't already exist (a viewlink
  target, an embedded view, a linked page) must be its own task, named in that task's
  depends_on — mentioning it in the description is not enough.
* Every depends_on name must exactly match either another task's name in this same plan or
  one of the existing-task names provided above (e.g. an already-created data model task) —
  never a concept, table name, or made-up label. Before calling plan_tasks, verify this for
  every task, and check for circular dependencies (A depends on B depends on A). To break a
  cycle, drop the weaker dependency (e.g. an embed that isn't strictly required for creation)
  so one side can be created first; if that embed still matters, add a separate update task
  (e.g. "update_A_embed_B", depending on both) — but only when omitting it would visibly
  break a user workflow, since every extra task has a real cost.`,

  `Other rules:
* An Edit view is single-record only — never a bulk import tool. A List view has no built-in
  export — never plan one as a column/button on it. Bulk import/export belongs on a dedicated
  admin page using an installed plugin's viewtemplate, and import and export are always two
  separate tasks with two separate view names.
* Use the built-in send_email trigger action — SMTP config is a platform-admin concern, never
  a table or task. Every {{}} interpolation in a workflow step must reference a variable
  already in context at that point — \`{{x || fallback}}\` does NOT work, since the
  interpolation throws before the fallback can run; compute/store the value in an earlier
  step instead.`,

  `Final check: verify all of the following before calling plan_tasks, then call it. Only
feature tasks are present, and none creates or modifies a table or field. Every existing
page/view supplied above is reused — nothing is recreated or duplicated under a new name.
Every view name is exact, unique, snake_case, and every view/page states the correct min_role
for its intended audience. Every CRUD requirement has its List and Edit views, and every
List/Show/Edit relationship required by that viewtemplate's own rules (above) is actually
satisfied. Every List and every ?id= page is reachable from a page/dashboard, and every
dashboard page only embeds already-created views — never defines one itself. Every depends_on
entry is valid and the dependency graph is acyclic. Go through the task list one task at a
time: does every entity named in a task's own description — and every implied follow-up (e.g.
"intended to be embedded on...", "will be linked from...") — have the matching depends_on, or
a task that actually fulfils it? Fix any that don't. No task invents a config (a property,
view, or value), or applies a real one in the wrong place. No unnecessary task was
introduced.`,
];

const implementation_rules = [
  {
    topics: ["custom_code"],
    text: `Important: JsCode server-mode views run on the server and must return an HTML string.
The following globals are available: Table, View, User, File, db, user, req, state,
markupTags, Actions, emitEvent, moment.
The state object contains URL query parameters — use state.start_date, state.end_date etc.
to read user inputs submitted via a GET form.
Never use process.env, window, document, or fetch in server mode. Never return a
{ code: "..." } object — always return an HTML string.
require() is NOT available — do not import lodash or any other module. Use moment or plain
JavaScript Date for all date formatting and arithmetic.`,
  },
  {
    topics: ["workflow"],
    text: `Important: Workflow TableQuery steps can only query user-created application tables.
Internal Saltcorn system tables whose names start with _sc_ (such as _sc_files,
_sc_triggers, _sc_views, _sc_pages, etc.) are NOT registered as application tables and will
throw "Table X not found" at runtime if used in a TableQuery step.`,
  },
  {
    topics: ["workflow"],
    text: `Important: After a page_to_pdf workflow step with to_file=true, the workflow context
automatically contains pdf_file_id (the database id of the saved file) and pdf_path_to_serve.
No extra run_js_code or TableQuery step is needed to look up the file — just use pdf_file_id
directly in the following modify_row step.`,
  },
  {
    topics: ["workflow"],
    text: `Important: Any export or output step (PDF generation, CSV export, email with attached data,
etc.) reads the database at the moment it runs. It will only reflect rows that already exist
at that point. Always place every export/output step AFTER all insert, update, and aggregate
steps that produce the data it needs to include. The correct order is: (1) insert/update all
rows, (2) compute and store aggregates, (3) export/output, (4) send notifications (if needed).
Moving an export step earlier — for example right after inserting a parent row but before its
child rows are inserted — will produce empty or incomplete output even though the data looks
correct when viewed in the browser later.`,
  },
  {
    topics: ["workflow", "custom_code"],
    text: `Important: The workflow step_type for running custom JavaScript is \`run_js_code\`
(snake_case). Do NOT use \`RunJsCode\` or any PascalCase variant — those will throw "Action
or trigger not found" at runtime. Built-in step types (TableQuery, ForLoop, SetContext, etc.)
are PascalCase, but run_js_code is the exception and must always be written in snake_case.`,
  },
  {
    topics: ["custom_code"],
    text: `Important: \`run_js_code\` bodies execute inside a CommonJS (vm2) sandbox — ES module
syntax is not supported and will throw "SyntaxError: 'import' and 'export' may only appear
at the top level". Never use \`import\`, \`export\`, \`export const\`, or \`export default\` in
any \`run_js_code\` body. Use plain variable assignments (\`const x = ...\`) and the
\`return\` statement to produce output. The step name is set in the workflow step definition,
not inside the code — do NOT write \`export const name = '...'\`.`,
  },
  {
    topics: ["custom_code"],
    text: `Important: \`run_js_code\` is a plain code body — NOT a named function or module.
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
  },
  {
    topics: [],
    text: `Important: Saltcorn where-clause objects use nested operator objects — NEVER use
space-separated key suffixes. Space-separated keys like \`"entry_date >="\` or
\`"project_id in"\` are stripped by sqlSanitize (spaces are removed), producing invalid column
names like \`entry_date>=\` or \`project_idin\` that crash Postgres.
The correct operators are: \`{field: {gt: value}}\` for >, \`{field: {gt: value, equal: true}}\`
for >=, \`{field: {lt: value}}\` for <, \`{field: {lt: value, equal: true}}\` for <=,
\`{field: {in: [...array...]}}\` for IN (generates \`field = ANY($1)\`),
\`{field: null}\` for IS NULL.
This applies in both JsCode and workflow TableQuery steps.`,
  },
  {
    topics: ["trigger_action"],
    text: `Important: To add an action button to a Show view, add a segment directly into the
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
  },
  {
    topics: ["trigger_action"],
    text: `Important: When a trigger is invoked from a Show view action button, the trigger MUST have
its \`table\` set to the view's table. Saltcorn will then automatically pass the full row as
the initial workflow context — every field value is available by its field name (e.g. \`id\`,
\`name\`, \`contact_email\`). Do NOT attempt to pass row data through a \`state\` property on
the \`actions\` array entry — that property is not supported and is silently ignored.
If the trigger has no table set, the workflow starts with no context and all field references
will throw "is not defined".`,
  },
  {
    topics: [],
    text: `Important: Some fields are non-stored (virtual) calculated fields — they have no database
column and are computed on-the-fly by Saltcorn. Never include such fields in modify_row, SQL
UPDATE statements, or recalculate_stored_fields calls. Only fields that exist as actual
database columns (regular fields and stored calculated fields) can be written. If a calculated
field needs updating, it will refresh automatically when the fields it depends on change.`,
  },
  {
    topics: ["trigger_action"],
    text: `Important: A Saltcorn modify_row trigger has exactly these configuration fields:
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
  },
  {
    topics: ["trigger_action"],
    text: `Important: modify_row \`row_expr\` values and all other formula/expression fields are parsed
as a single JavaScript expression by acorn. They MUST be written on one line — no literal
newlines anywhere in the expression, including inside string literals. A literal newline
inside a quoted string causes "Unterminated string constant" and crashes the trigger.
Write the entire expression on a single line: \`{field1: expr1, field2: expr2}\`.
This single-line rule applies ONLY to \`row_expr\` and similar single-expression fields —
NOT to \`run_js_code\` steps in workflows. Workflow \`run_js_code\` code is a full JavaScript
function body and must use real newlines (encoded as \`\\n\` in JSON). Never write literal
backslash-n (\`\\\\n\`) inside \`run_js_code\` code to simulate newlines — vm2 will reject it
with "Expecting Unicode escape sequence".`,
  },
  {
    topics: ["workflow"],
    text: `Important: In workflow TerminateWorkflow steps, the "return value" / error message field is
evaluated as a JavaScript expression — it is NOT plain text. Always wrap the message in
quotes: \`"No billable hours found."\`. A bare unquoted sentence causes a SyntaxError at
runtime.`,
  },
  {
    topics: ["workflow"],
    text: `Important: When a workflow step inserts a row (e.g. \`insert_any_row\`, \`upsert_one\`), the
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
  },
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
  `Every task description must state one concrete, unconditional action. Never hedge with
"only if needed", "if required", or "otherwise leave unchanged" — decide now whether the
change is needed. If it isn't, don't create the task at all.`,

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
same point in different words. Never pad a short task description just to appear thorough.
Don't restate information already established above (e.g. a table's fields, an existing
entity's name) — reference it, don't repeat it.`,
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
* Use as few phases as genuinely needed — a small app may need only 1. Split only on a real
  dependency boundary or delivery milestone; don't pad the count for its own sake, e.g. by
  putting an entity's creation in one phase and an update to it in another.
* Different roles seeing different scoped subsets of the same entity's data is not a phase
  boundary — build a scoped list plus a dashboard for each role in the same phase as the
  entity and its admin management view.
* Every requirement must trace directly to the specification — don't infer or add anything
  not explicitly mentioned, and omit anything optional/"nice to have"/"can be added later".
* Don't include integration with an external system unless the spec names it and describes
  exactly what must be exchanged.
* Don't include requirements the platform already handles: user registration, login,
  password management, role-based access control. Dashboards and landing pages are still
  valid requirements — a landing page will naturally link to /auth/login and /auth/signup.
* Priority reflects centrality to the phase: 5 = phase isn't done without it, 3-4 = important
  but not blocking, 1-2 = minor. Don't assign 5 to everything.
* Each phase's requirements must be self-contained — may depend on earlier phases, never on
  a later one. Place foundational data and auth requirements in the earliest phase.
* The core-data-model phase (almost always Phase 1) MUST include an admin dashboard
  requirement: named <app_name>_admin_dashboard, giving role 1 access to create/manage all
  core entities from that phase, and set as the admin home page — otherwise there's no way
  to seed data and every role dashboard stays empty.
* Don't include requirements or phases for testing/QA/UI flows — the platform can't execute
  tests; every requirement must be something buildable and deployable.`,
];

const phase_scope_rule =
  "Plan only the tasks needed to implement this phase's stated requirements. Do not plan\n" +
  "tasks for requirements belonging to other phases. This applies especially to database\n" +
  "tables — do not create a table unless it is directly needed by a stated requirement,\n" +
  "even if you can tell it will be needed in a later phase.";

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

const exec_final_create_check_rule =
  "Final check, before your first tool call: if the task below says \"Create\" a view, page, or\n" +
  "trigger, confirm the exact entity name it names is absent from the existing-entities lists\n" +
  "above, then call generate_view/generate_page/generate_trigger to create it — never\n" +
  "get_view_config, apply_view_config, or set_entity (it skips the wizard and produces bad\n" +
  "config), even for a similarly-named existing entity.";

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
For each need you identify, check the available plugin list provided for a matching plugin
that is not already installed, and plan a task for it.`,

  `Critical: only plan a plugin installation task when the built-in actions, field types,
and view templates genuinely cannot cover the requirement. Inserting rows, updating fields,
running workflow steps, and computing aggregates are all covered by built-in workflow actions
— only install a plugin when no built-in equivalent exists. For example, do NOT install the
'sql' plugin to insert rows or compute totals — use built-in workflow steps instead.`,

  `CRITICAL — do NOT install a plugin if an already-installed one covers the need:
Before planning ANY plugin install task, you MUST read every entry in the
"already installed" plugin list provided, including its view templates, field types, and
app-constructor notes. If ANY installed plugin already provides the required capability
— even partially, even under a different name — you MUST use that plugin instead and
MUST NOT plan an install task for a different one.
This check is MANDATORY and must happen before you consider any store plugin.
Violating this rule wastes a task slot and risks installing a redundant plugin.
Only plan an install task when you have explicitly verified that no installed plugin
can satisfy the requirement.`,

  `Combine every plugin to install into a single task named "Install plugins" listing all
of them — never one task per plugin, and never the same plugin in more than one task. If
no plugins are needed, call plan_tasks with an empty tasks array.`,

  `Final check: before calling plan_tasks, confirm no plugin name appears in more than one
task. If you find one, merge into a single "Install plugins" task and remove the rest.`,
];

const data_model_type_instruction = [
  `Plan ONLY database schema changes — tables and fields. No views, pages, triggers,
workflows, plugins, roles, or system-configuration-value settings (e.g. home_page_by_role,
2FA), even if a stated requirement mentions one — a later pass covers those. If a
requirement has no schema component, skip it here rather than inventing a task for it.
A data_model task defines schema only — it never inserts or seeds row data; there is no
tool for that here.`,

  `Critical: a new table's creation task must include every field ANY requirement needs
from it — including ownership/visibility (e.g. an assignee FK), even if that's stated as
a separate requirement from the one naming the table. Never create a later task to add,
confirm, or re-describe a field the creation task already has for filtering/visibility —
that is not a new requirement. A later task may only add a field for something the
creation task's fields genuinely cannot do.`,

  `Critical: only create tables/fields THIS phase's requirements actually need — don't
anticipate future phases or add anything speculatively. A requirement not stated for this
phase belongs to another phase; don't implement it here.`,

  `Specify unique/not_null constraints on every field in the task description now — don't
leave them for a later step. Never mention constraints on the 'id' field — it is the
primary key and is always unique and not-null by definition.`,

  `Ownership (auto-populating a FK-to-users field from the logged-in user) is a view-level
concern — don't mention it; just describe the FK field normally.`,

  `Never plan a table for SMTP, email config, or mail server credentials — that's managed
by the platform administrator.`,

  `Pre-existing tables (listed under "Tables with no phase association") existed before
this project. You may reference them as FK targets freely. Only add a field to one when a
stated requirement directly requires it — never speculatively, and never merely for
display/UX convenience (e.g. "so it can be shown by name", "for visibility", "in case
it's needed later"). If ownership/assignment is already an FK on another table (e.g.
tasks.assignee → users), that already satisfies visibility and ownership — add nothing to
the referenced table for it, and don't plan a task that only restates "add what's needed"
without naming a concrete field. Changing or removing an existing field needs even more
caution — state why it's unavoidable. Set modifies_existing_table: true on any task
touching a pre-existing table.`,

  `Final check: before calling plan_tasks, confirm no table is the target of more than one
task. If you find one, merge every field into that table's single task and remove the
rest — a table must never appear as the target of two tasks.`,
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
  {
    topics: ["auth_pages"],
    text: `Important: The "users" table is built-in. Passwords are platform-managed — never add
a password field to a view. Signup uses the built-in page at /auth/signup, login at
/auth/login. Do NOT create triggers for registration or email verification — the
platform handles this natively. Do NOT create any Edit, Show, or List view whose
underlying table is the built-in users table — user records are managed entirely by
the platform.`,
  },
  {
    topics: ["auth_pages"],
    text: `Important: On landing pages, place Log in / Create account buttons in no more than
two locations (e.g. navbar and one hero call-to-action). Do not repeat them in a third
"Get started" section or anywhere else. For links that take an already-authenticated
user to their dashboard, use href="/" — not /auth/login.`,
  },
  {
    topics: ["auth_pages"],
    text: `Important: Never add Log in (/auth/login) or Create account (/auth/signup) links to
role-specific dashboards or any page whose min_role is not public (100). A teacher
dashboard, student dashboard, parent dashboard, or any page with min_role 40, 80, or 1
is only reachable by users who are already authenticated — adding auth links there is
wrong and confusing. Auth links belong only on public-facing pages (landing pages,
marketing pages, min_role 100).`,
  },
  {
    topics: ["navigation_links"],
    text: `Important: Saltcorn page URLs always use the prefix /page/. To link to a page named
"teacher_dashboard", the href must be "/page/teacher_dashboard" — NOT "/teacher_dashboard".
This applies to every link, button, or navigation item that points to a Saltcorn page,
regardless of where the link appears (landing page, navbar, other pages, etc.).
Views use /view/view_name — also with the /view/ prefix, not a bare name.`,
  },
  {
    topics: [],
    text: `Important: Do not name any page or view "Admin dashboard" — that name is reserved by
the Saltcorn platform. For pages intended for role 1 (admin), use a name like "App
admin dashboard" or prefix it with the application name (e.g. "Law Firm admin
dashboard").`,
  },
  {
    topics: ["view_embedding"],
    text: `Important: Dashboard stat cards must show real data using embedded Saltcorn Statistic
views (using embed-view tags, e.g. <embed-view viewname="total_hours_stat"></embed-view>).
Never use client-side JavaScript fetch stubs, commented-out fetch code, or static
placeholder values (e.g. "—", "Loading...") for statistics. If a Statistic view for a
metric does not exist yet, it must have been created in an earlier task — do not invent
placeholder JS instead.`,
  },
  {
    topics: [],
    text: `Important: When creating a page or view, always set min_role based on the intended
audience: 1 for admin-only, 40 for staff and above, 80 for logged-in users and above,
100 for public. Never default to public (100) unless the page or view is explicitly
intended for unauthenticated users (e.g. a landing page). A dashboard or view for
clients/users is role 80, a staff page or view is role 40, an admin page or view is
role 1.`,
  },
  {
    topics: ["system_config"],
    text: `Important: Two-factor authentication (2FA/TOTP) is fully built into the platform. To
configure it, call set_entity directly with entity_type "system-configuration-value"
and entity_name "twofa_policy_by_role". The entity_definition must be the plain JSON
object itself — for example: {"1": "Mandatory", "100": "Disabled"}. Do NOT wrap it in
{"type": "json", "value": ...} or any other envelope. Read the current value first with
get_entity and merge rather than overwrite. Do NOT create a workflow or trigger to do
this.`,
  },
  {
    topics: ["system_config"],
    text: `Important: To set a page as the home page for a role, call set_entity directly with
entity_type "system-configuration-value" and entity_name "home_page_by_role". The
value is a JSON object mapping role IDs to page names — Role IDs: public=100, user=80,
staff=40, admin=1. The entity_definition must be the plain JSON object itself — for
example: {"100": "landing", "80": "client_dashboard"}. Do NOT wrap it in {"type":
"json", "value": ...} or any other envelope. Read the current value first with
get_entity so you can merge rather than overwrite. Do NOT create a workflow or trigger
to do this — use set_entity directly.`,
  },
  {
    topics: ["view_embedding"],
    text: `Important: If the task description mentions adding a viewlink, linking rows to another
view, or a button that opens another view from a list — that viewlink column MUST be
present in the finished view. Do not skip it. Viewlinks require calling
get_relation_paths first to obtain the relation string before generating the layout.`,
  },
  {
    topics: ["view_embedding"],
    text: `Important: If the view/page you are embedding or linking to is on the SAME table as
the view/page you are editing (e.g. a Show view of "orders" linking to a List view also
on "orders"), the relation is usually just ".sourcetable" with no further segments — e.g.
relation: ".orders" — and you can skip get_relation_paths for that plain case. But if the
task explicitly calls for a specific/indirect same-table relation (e.g. rows related via
another table, like "orders" linking to other "orders" through a shared "customer"),
still call get_relation_paths to get the correct path — do not guess it.`,
  },
  {
    topics: ["view_embedding", "navigation_links"],
    text: `Important: Before referencing any view or page you didn't just create yourself
in this task (embeds, viewlinks, action buttons, ajax_modal calls, page links), check
the existing views/pages list already provided above. Only reference names that appear
there — never invent a name or assume a view exists. If it's not listed, omit it or use
a simple "Coming soon" placeholder — never write conversational text, explanations, or
instructions to the user inside the HTML. Always create the page with whatever views
exist. Only call list_entities if you need a type of entity not covered by that list.`,
  },
  {
    topics: ["view_embedding"],
    text: `Important: Before placing any reference to a view on a page — whether as an embed, a
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
  },
  {
    topics: ["view_embedding"],
    text: `Important: To embed a list on a dashboard page filtered to the logged-in user's own
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
  },
  {
    topics: [],
    text: `Important: Every HTML page (page_type HTML) must include a toast notification area so
that alerts and success messages are visible. Place this div just before the closing
</body> tag:
<div id="toasts-area" class="toast-container position-fixed top-0 start-50 p-0"
style="z-index:999;" aria-live="polite" aria-atomic="true"></div>`,
  },
  {
    topics: [],
    text: `CRITICAL: When creating a page, default to page_type "Layout page". This creates a
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
  },
  {
    topics: ["view_embedding"],
    text: `Important: Passing state into an embedded view — two independent concerns:
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
  Examples (individual patterns only — extra_state_fml in practice may combine these and
  include additional keys not shown in any example here):
    URL query param:   extra_state_fml: "{order_id: $id}"   (passes ?id=45 as order_id)
    Logged-in user:    extra_state_fml: "{user_id: user.id}"
    Combined:          extra_state_fml: "{user_id: user.id, order_id: $id}"
    HTML href:         href="/page/order_detail?id={{id}}"   (in a raw HTML block inside a List)
  Full segment example: {"type":"view","view":"my_view","state":"shared","extra_state_fml":"{order_id: $id}"}
  When extra_state_fml already exists on a segment (e.g. from an earlier task), it may
  contain more keys than any single example above — preserve the entire value as-is.
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
  },
  {
    topics: ["view_embedding"],
    text: `CRITICAL — Modifying an existing page (Layout page, not HTML):
Do NOT call generate_page to update an existing Layout page. generate_page only works for
HTML pages and will fail silently for Layout pages, discarding all existing configuration.
Use this sequence instead:
(1) Call get_entity with entity_type "page" and entity_name to read the current definition.
(2) Merge your changes into the layout returned — only change what the task explicitly
    requests (e.g. container styling, min_role, header text). Never reconstruct the layout
    from scratch.
(3) For every embedded view segment in the layout, copy every field verbatim from the
    get_entity output — do NOT reconstruct or rewrite any field value. In particular,
    copy extra_state_fml as an exact string: whatever get_entity returned — whether it
    is a single expression like "{ user_id: user.id }" or a compound expression with
    multiple keys — must appear in set_entity unchanged, every key-value pair intact.
    Never drop part of the value because it was not mentioned in the task or in an
    example.
(4) Before calling set_entity, pause and ask yourself: "For every field that get_entity
    returned on every embedded view segment — is that field still present, with its value
    unchanged, in what I am about to write?" If any field is missing or its value differs
    from what get_entity returned (without the task explicitly requesting that change),
    restore it from the get_entity output before proceeding.
(5) Call set_entity with entity_type "page", entity_name, and the fully merged definition.`,
  },
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
  "- Stop when the unclear parts are covered — 2 or 3 questions is fine. 10 is a hard maximum, not a target.\n" +
  "- Do NOT ask about platform support (web, mobile, iOS, Android), offline access, or data\n" +
  "  synchronization across devices. The application runs as a web application only.";

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
  exec_final_create_check_rule,
  exec_schema_rule_plugin,
  exec_schema_rule_data_model,
  exec_schema_rule_feature,
  plugin_type_instruction,
  data_model_type_instruction,
  feature_type_instruction,
  feedback_analyse_decision,
  research_questions_rules,
};
