const { getState } = require("@saltcorn/data/db/state");

const saltcorn_description = `This application will be implemented in Saltcorn, a database application development
environment. 

Saltcorn applications contain the following entity types:

* Tables: These are relational database tables and consists of fields of specified types and rows
with a value for each field. Fields optionally can be required and/or unique. Every field has a name,
which is a an identifier that is balid in both JavaScript and SQL, and a label, which is any short
user-friendly string. Every table has a primary key
(composite primary keys are not supported) which by default is an auto-incrementing integer with
name \`id\` and label ID. The \`id\` primary key field is always unique and not-null by definition —
never set unique=true or not_null=true on it. Fields can also be of Key type (foreign key) referencing a primary key 
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
`;

const existing_tables_list = (tables) => {
  const tableLines = [];
  tables.forEach((table) => {
    const fieldLines = table.fields.map(
      (f) =>
        `  * ${f.name} with type: ${f.pretty_type}.${
          f.description ? ` ${f.description}` : ""
        }`
    );
    tableLines.push(
      `${table.name}${
        table.description ? `: ${table.description}.` : "."
      } Contains the following fields:\n${fieldLines.join("\n")}`
    );
  });
  return `The database already contains the following tables: 

${tableLines.join("\n\n")}`;
};

const existing_entities_list = ({ views, triggers, pages, tableById = {} }) => {
  const sections = [];
  if (views.length)
    sections.push(
      `The following views are already implemented — do NOT plan tasks to create them. ` +
        `If you find yourself constructing a new view name that avoids a collision with an existing one ` +
        `(e.g. by prepending "my_", "user_", or "filtered_"), that is a signal you should use the existing view instead:\n` +
        views
          .map((v) => {
            const tablePart =
              v.table?.name ||
              (v.table_id && tableById[v.table_id]) ||
              v.exttable_name;
            return `- ${v.name} (${v.viewtemplate}${
              tablePart ? ` on ${tablePart}` : ""
            })`;
          })
          .join("\n")
    );
  if (triggers.length)
    sections.push(
      `The following triggers are already implemented — do NOT plan tasks to create them:\n` +
        triggers
          .map(
            (t) =>
              `- ${t.name} (${t.action}${
                t.when_trigger ? `, ${t.when_trigger}` : ""
              })`
          )
          .join("\n")
    );
  if (pages.length)
    sections.push(
      `The following pages are already implemented — do NOT plan tasks to create them. ` +
        `If a requirement is served by one of these pages (even under a different name), use the existing page name. ` +
        `If you find yourself constructing a new name that avoids a collision with an existing name ` +
        `(e.g. by prepending "my_", appending "_v2", or changing a word), that is a signal you should use the existing page instead:\n` +
        pages
          .map(
            (p) => `- ${p.name}${p.description ? ` — ${p.description}` : ""}`
          )
          .join("\n")
    );
  return sections.join("\n\n");
};

const installed_plugins_list = (installedNames) => {
  const state = getState();
  const lines = [];
  for (const name of installedNames) {
    const resolvedName = state.plugin_module_names[name] || name;
    const mod = state.plugins[resolvedName];
    if (!mod) continue;
    const contents = mod.contents;
    const description = mod.description;
    if (!contents && !description) continue;
    let line = `### ${name}`;
    if (description) line += `\n${description}`;
    if (contents) line += `\n${contents}`;
    lines.push(line);
  }
  if (!lines.length) return "";
  return (
    `The following plugins are already installed and their viewtemplates, field types, and actions are available for use:\n\n` +
    lines.join("\n\n")
  );
};

const available_plugins_list = (storePlugins, installedNames) => {
  const uninstalled = storePlugins.filter((p) => !installedNames.has(p.name));
  if (!uninstalled.length) return "";
  const lines = uninstalled.map((p) => {
    let line = `### ${p.name}`;
    if (p.description) line += `\n${p.description}`;
    if (p.contents) line += `\n${p.contents}`;
    return line;
  });
  return (
    `The following plugins are available in the Saltcorn store but not yet installed. ` +
    `If a task requires functionality provided by one of these plugins (e.g. a specific view template, field type, or action), ` +
    `include an explicit "Install plugin <name>" task before it with the exact plugin name as listed here. ` +
    `The executor will use that name directly without needing to look it up.\n\n` +
    lines.join("\n\n")
  );
};

const research_answers_section = (text) =>
  text
    ? `\nThe user was asked clarifying questions about the application. Here are the questions and their answers:\n\n${text}\n`
    : "";

const task_planning_rules = `The plan should focus on building views, triggers (including workflows) and pages.

Important trigger planning rules:
* When a task involves a simple field update (e.g. marking an item complete or incomplete), plan it as a trigger using modify_row — NOT a workflow. Use a workflow only when multiple steps, branching, or looping are genuinely required.
* If multiple independent single-step actions are needed (e.g. "mark complete" and "mark incomplete"), describe them as separate triggers in the task description — do not describe them as one combined workflow.
* Do NOT mention "navigate back" or "return to context" in trigger task descriptions. Navigation is configured at the view level (GoBack button), not inside a trigger.
* If a trigger should be accessible as a button in a view, prefer two separate tasks: (1) a task that creates the trigger, (2) a task that updates the existing view to add an action segment with action_name set to the trigger's name — this second task must depend on the first. Only combine them into one task when the view is being created for the first time in the same plan (i.e. the view does not yet exist), in which case the single view-creation task must also add the action button and depend on the trigger task.
* Do NOT plan any task that uses run_bash_script or executes shell commands. If a requirement seems to need a shell command (e.g. file conversion, PDF generation, sending email), look for a Saltcorn plugin or built-in action that covers it instead.
* Do NOT plan any task that writes to a virtual (read-only) calculated field. Virtual fields are computed automatically and cannot be stored — any trigger or workflow that tries to update them will be refused. If you find yourself planning a trigger to keep a calculated field "current", delete that task — the field already updates itself.

Important existing-entity rules:
* Before planning any view or page task, check the list of already-implemented views and pages above. If an existing view or page already covers the required functionality — even under a slightly different name — do NOT create a new one. Reference the existing entity by its exact name in dependent tasks.
* Never create a new view that is a renamed variant of an existing one (e.g. prefixing with "my_", "user_", "filtered_"). If the existing view needs filtering for a specific context, embed it as-is and describe the filtering in the embedding page or view task.
* For every role's required dashboard or key page, verify it is either in the existing pages list or has a task planned for it. A requirement that mentions a dashboard or home screen for a role and has no corresponding existing page MUST have a task.
* If a page was previously created under one name and a requirement refers to the same concept under a different name, use the existing page's actual name — do not plan a second page for the same purpose.

Important view planning rules:
* Each task must create exactly one view. Never put two or more views in the same task. Edit, Show, and List for the same table are always three separate tasks with three separate names, descriptions, and dependencies.
* Do NOT plan separate tasks for "create" and "edit" on the same table. In Saltcorn, a single Edit view handles both (no id = create, id present = edit). One task, one Edit view, description says "create and edit".
* Edit, Show, and List views for a table always go together as three separate tasks. Whenever you plan a List view AND a Show view for the same table, you MUST also plan an Edit view for that table — a List without an Edit leaves users unable to create or modify records. Only omit the Edit view when the requirements explicitly say the data is read-only.
* The three tasks must be ordered: Edit and Show first (independent of each other, in any order), List last. The List task MUST list both the Edit task and the Show task in its depends_on — without exception. If you plan a List that depends on neither, that is a bug in the plan.
* Before finalising the plan, for every List view task, verify that its depends_on includes the corresponding Edit task and the corresponding Show task (if they exist). If either is missing, add it.
* When a List view links to a Show view or Edit view, the task description must say: "Add a viewlink column to [view_name] for the current row" — not just "link each row". This wording makes it unambiguous that a viewlink column must be added to the list for each target view.
* Every link or viewlink that targets a Show view MUST include the row's \`id\` as a URL query parameter (e.g. \`?id={{id}}\`). A Show view with no \`id\` in the URL displays "No row selected". This applies to viewlinks in List views, page links, and any other navigation pointing at a Show view.
* Every List view task description must include a delete action column unless the table is explicitly read-only. State it explicitly: "Add a delete action column."
* In general, if a view embeds or links to another view, the linked view's task must be listed as a dependency.
* When a table has foreign key fields referencing the users table, the task description must explicitly state for each one whether it is an ownership field (automatically set from the logged-in user, omit from the form) or a selector field (the user picks a value, include a selector in the form). Example: "user_id records the owner and is set automatically; shared_with_user_id must have a user selector."
* For FK fields that represent a parent context (e.g. trip_id on packing_items), always include the field as a normal selector in the Edit view form. Do NOT say to omit it. Saltcorn automatically pre-fills the selector from the URL query parameter when the view is opened from a parent context, and the user can select it manually when the view is used standalone.
* NEVER omit a NOT NULL (required) FK field from the Edit view form unless it references the users table directly AND it is being used as an ownership field. Any other required FK field — including FKs to non-user tables even if they are "set by the system" — MUST be included as a selector in the form. A required field omitted from the form with no mechanism to set it will produce a NOT NULL database error on save. "Will be set automatically" is not a valid plan unless the field directly references the users table.
* For every task that creates a view, include the exact view name in the task description. View names must be lowercase, snake_case, unique across all tasks in the plan, and descriptive enough to identify the table and purpose — for example 'packing_items_edit' rather than just 'edit'.
* Do NOT plan an Edit view for any table whose description says it is auto-populated or not editable by users (e.g. audit logs, import/export job tracking tables). These tables may have List and Show views for read-only visibility, but never an Edit view.
Important user account rules:
* The platform (Saltcorn) provides a built-in user account system with login, registration, and session management. Do NOT plan any tasks for user registration, login pages, password management, authentication flows, or email verification — these are already handled by the platform. Users register at /auth/signup and log in at /auth/login.
* User identity is always available as the logged-in user. Ownership fields (FK to users) are set automatically from the session; no custom logic is needed.
* If a requirement mentions "user accounts", "secure login", "saving data per user", "user-specific data", or "sharing between users", treat it as already satisfied by the platform's built-in user system. Do not generate any task in response to such a requirement.
* Do NOT create any Edit, Show, or List view whose underlying table is the built-in \`users\` table. The users table is managed entirely by the platform — records are created via /auth/signup and managed via the platform's built-in admin panel. Never plan a task that creates a view on the users table.

Important date field rules:
* When a view task includes a date field that should pre-fill to today, the task description must say to use "default_now": true in the flatpickr configuration — never "default": "today".

Important role rules:
* Every view and page task description MUST state the min_role explicitly, e.g. "Set min_role to admin (1)." or "Set min_role to user (80).". Never omit it.
* Role values: admin=1, staff=40, user=80, public=100. Use the value that matches who will use the view or page — admin (1) only for views that admins exclusively need (system config, user management); staff (40) for views used by internal employees who are not admins (e.g. lawyers, agents, staff members); user (80) for views used by logged-in non-staff users (e.g. clients, customers, members); public (100) only when the page must be accessible without login. Do not default everything to admin — setting min_role too restrictively locks out the intended users.

Important dashboard rules:
* A dashboard page that shows aggregate statistics (totals, counts, revenue, etc.) must NEVER use client-side JavaScript fetch stubs or placeholder values. Every stat card must be backed by a real Saltcorn Statistic view embedded with an embed-view tag.
* For each statistic shown on a dashboard, plan a separate Statistic view task (e.g. "total_billable_hours_stat", "revenue_by_client_stat"). The dashboard page task must list all these Statistic view tasks in its depends_on.
* Statistic view tasks must be planned before the dashboard page task and have descriptive names that make their metric clear.
* No list view may be left orphaned. Every list view planned in the phase must be reachable from at least one dashboard or page — embedded directly or linked via a navigation section. Check each list view and confirm it appears in at least one page or dashboard task's description.

Important home page rules:
* Every role should land on the right page after visiting /. Plan a single task "Set home pages by role" that depends on all relevant page tasks and configures home_page_by_role for every role in one step.
* Role IDs: public=100, user=80, staff=40, admin=1.
* Landing/marketing page (public-facing intro): min_role must be 100 (public). It MUST include visible links to /auth/login (Log in) and /auth/signup (Create an account). Set as home for role 100 (public).
* If there is an admin dashboard page, set it as home for role 1 (admin).
* If there is a dashboard or main page for regular users or staff, set it as home for role 80 (user) and/or role 40 (staff) as appropriate.
* The "Set home pages by role" task description must list every role→page mapping explicitly using the exact page names planned in this task list, e.g.: "Set home_page_by_role: public (100) → landing, user (80) → client_dashboard, staff (40) → staff_dashboard, admin (1) → app_admin_dashboard." Never use "admin_dashboard" as a page name — it is reserved by the platform.

Important bulk import/export rules:
* A plain Edit view creates or edits a single record — it is NOT a bulk import tool. Never plan an Edit view as a solution for bulk data import.
* List views have no built-in export feature — do not plan an export button or column as part of a list view.
* Bulk import and export functionality (e.g. CSV) must always be placed on a dedicated management or admin page as embedded views, using whatever import/export viewtemplate is available from an installed plugin.
* Bulk import and bulk export for the same table are always two separate tasks with two separate view names. Never combine them into a single task.

Important plugin rules:
* If multiple plugins need to be installed, combine them ALL into a single task named "Install plugins" that lists every required plugin name. Do NOT create a separate task per plugin.

Important dependency rules:
* Every name in a task's depends_on MUST exactly match the name field of another task in the same plan_tasks call. Never reference a name that is not present in the tasks array — not a concept, not a table name, not a made-up label. If you find yourself writing a depends_on entry whose name does not appear as a task name in the list, either add the missing task or remove the dependency.
* Before calling plan_tasks, mentally verify: for every task, every name in its depends_on array appears as the name of another task in the array.
* Before calling plan_tasks, check for circular dependencies. A circular dependency means task A depends on B, and B depends on A (directly or transitively). A circular dependency causes a deadlock — neither task can ever start. To fix it: identify which dependency in the cycle is the weakest (i.e. view A only needs to embed view B, but B does not strictly require A to exist). Remove that dependency from A's depends_on so A can be created first. Then decide whether B's content is still useful without being embedded in A at creation time. If the embed is important, add a separate update task (e.g. "update_A_embed_B") whose description says to update view A to embed view B, and whose depends_on lists both A and B. Only add this extra update task when the embed is genuinely important for the finished product — do not create update tasks for minor or optional embeds, as each extra task is expensive. A good rule of thumb: add an update task only if omitting the embed from the final view would visibly break a user workflow.

Important email rules:
* Use the built-in \`send_email\` trigger action to send emails. SMTP configuration (host, credentials, sender address) is managed by the platform administrator in System Configuration — it is not an application concern. Do NOT create any table for SMTP or email settings, and do NOT plan any task to configure SMTP.

Important schema/table rules:
* The database schema is already fully designed and implemented before task planning begins. ALL tables and fields needed by the application already exist. Do NOT plan any tasks that create tables, add fields, modify fields, or change the schema in any way. If you find yourself writing a task whose output is a table or a field, delete it — that work is already done.
* Ownership behaviour (auto-setting a FK-to-users field from the logged-in user) is configured in the Edit view, not in the database. Do not create tasks for it at the schema level.
* Do NOT plan tasks to add uniqueness constraints or validation to existing fields — those are already in the schema.
* Do NOT plan a standalone task for "access control", "row-level security", "permissions", or "roles". These are schema-level concerns already handled during schema design, or view-level concerns handled when building each view. The ownership field and sharing logic are already in the schema — there is nothing extra to configure as a separate task.`;

const implementation_rules = `Important: JsCode server-mode views run on the server and must return an HTML string. The following globals are available: Table, View, User, File, db, user, req, state, markupTags, Actions, emitEvent, moment. The state object contains URL query parameters — use state.start_date, state.end_date etc. to read user inputs submitted via a GET form. Never use process.env, window, document, or fetch in server mode. Never return a { code: "..." } object — always return an HTML string. require() is NOT available — do not import lodash or any other module. Use moment or plain JavaScript Date for all date formatting and arithmetic.

Important: Saltcorn where-clause objects use nested operator objects — NEVER use space-separated key suffixes. Space-separated keys like \`"entry_date >="\` or \`"project_id in"\` are stripped by sqlSanitize (spaces are removed), producing invalid column names like \`entry_date>=\` or \`project_idin\` that crash Postgres. The correct operators are: \`{field: {gt: value}}\` for >, \`{field: {gt: value, equal: true}}\` for >=, \`{field: {lt: value}}\` for <, \`{field: {lt: value, equal: true}}\` for <=, \`{field: {in: [...array...]}}\` for IN (generates \`field = ANY($1)\`), \`{field: null}\` for IS NULL. This applies in both JsCode and workflow TableQuery steps.

Important: Some fields are non-stored (virtual) calculated fields — they have no database column and are computed on-the-fly by Saltcorn. Never include such fields in modify_row, SQL UPDATE statements, or recalculate_stored_fields calls. Only fields that exist as actual database columns (regular fields and stored calculated fields) can be written. If a calculated field needs updating, it will refresh automatically when the fields it depends on change.

Important: Do NOT use the GoBack action for cancel buttons in Edit views. The GoBack action always calls history.back(), which breaks when the view is opened inside a popup modal. Instead, add a link segment with url set to the following JavaScript — it closes the Saltcorn modal (#scmodal) if one is open, and falls back to history.back() for standalone use: javascript:var m=document.getElementById('scmodal');var mi=m&&bootstrap.Modal.getInstance(m);if(mi)mi.hide();else history.back() — style it as btn btn-outline-secondary to match the standard cancel appearance.

Important: In List view create_view_showif expressions (and any other showif / formula fields evaluated against the URL state), the variable \`state\` does NOT exist. The state object is passed as \`row\`, and each key of the state is also available as a bare variable. Use \`row.project_id\` or just \`project_id\` — never \`state.project_id\`.

Important: A Saltcorn modify_row trigger has exactly these configuration fields: \`name\` (string), \`action\` = "modify_row", \`when_trigger\` ("Insert" or "Update" — NEVER "Validate"), optionally \`table_name\`, and \`configuration.row_expr\` — a single-line JS expression returning an object of field\u2192value pairs. Example: \`{hours: Math.round(parseFloat(hours) * 100) / 100}\`. Do NOT invent other formats (no \`match\`, \`actions\`, \`set\`, \`columns\` keys — those belong to other platforms). NEVER use \`when_trigger: "Validate"\` with modify_row — Validate fires before the row exists in the database so there is no id to update, causing a crash on insert. Use \`when_trigger: "Insert"\` to normalise on new rows, and a separate \`when_trigger: "Update"\` trigger if normalisation is also needed on edits. Keys in the row_expr object MUST be bare field names — NEVER table-qualified names like \`{"table_name.field_name": value}\`. Table-qualified names are silently mangled by SQL sanitization (the dot is stripped), producing a non-existent column name and a runtime error. Use only \`{field_name: value}\`.

Important: modify_row \`row_expr\` values and all other formula/expression fields are parsed as a single JavaScript expression by acorn. They MUST be written on one line — no literal newlines anywhere in the expression, including inside string literals. A literal newline inside a quoted string causes "Unterminated string constant" and crashes the trigger. Write the entire expression on a single line: \`{field1: expr1, field2: expr2}\`.`;

const fieldview_selection_rules = `For numeric fields (Integer, Float, Money, Decimal) the default fieldview is "edit" — a plain text input. \
Only use a specialised numeric fieldview (e.g. "number_slider", "range", "spin") when it is clearly appropriate for the data: \
a slider makes sense for a bounded rating or percentage, not for an open-ended value like a price, rate, or quantity. \
The existence of an alternative fieldview in the platform is not a reason to use it — "edit" is the right default and should be the first choice unless there is a specific UX reason to do otherwise. \
For date fields always prefer fieldview "flatpickr" when available — it provides the best user experience \
and works for both regular dates and day-only dates. \
Only use fieldview "edit_day" as a fallback when the field has day_only=true and flatpickr is not installed. \
Never set a flatpickr configuration key "default" to a string like "today" — it is not a valid date value and will throw at runtime. \
To pre-fill the picker with the current date/time, set "default_now": true in the flatpickr field configuration instead. \
When the underlying Date field has day_only=true, also set "day_only": true in the flatpickr fieldview configuration — this disables the time picker and formats the value correctly. \
For String fields that have an options attribute (a comma-separated list of fixed choices), \
use fieldview "select" — this renders a dropdown with those options. \
Do not use "select_by_code" for fields with fixed options. \
File-type fields use dedicated fieldviews — never the generic "edit" or "show" fieldview. \
In edit/form views use "upload" (file input) or "select" (pick existing file). \
In read-only views (Show, List) use "Download link", "Link", "Show Image", or "Thumbnail". \
Using "edit" or "show" on a File field causes a runtime error.`;

const task_planning_closing = `Your plan should not include any clarification or questions to the product owner. The
information you have been given so far is all that is available. Every step in the plan
should be immediately implementable in Saltcorn. You are writing the steps in the plan
for a person who is competent in using saltcorn but has no other business knowledge.

Do not include any steps that contain planning, design or review instructions. You are only writing a
plan for the engineer building the application. Every step in the plan should have the construction or the modification
of one or several application entity types.

Description length: keep descriptions concise. Simple tasks (a single view, trigger, or page) need only 1–3 sentences. Complex tasks (multi-step workflows, views with several embedded components) may use more, but stop once all actionable specifics are covered — do not re-explain steps already implied by the context, add parenthetical asides, or repeat the same point in different words. Never pad a short task description just to appear thorough.`;

module.exports = {
  saltcorn_description,
  implementation_rules,
  fieldview_selection_rules,
  existing_tables_list,
  existing_entities_list,
  installed_plugins_list,
  available_plugins_list,
  research_answers_section,
  task_planning_rules,
  task_planning_closing,
};
