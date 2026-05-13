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
  tr,
  td,
} = require("@saltcorn/markup/tags");
const { getState, features } = require("@saltcorn/data/db/state");
const renderLayout = require("@saltcorn/markup/layout");
const { viewname } = require("./common");
const { runTask, runNextTask } = require("./run_task");
const { task_tool } = require("./tools");
const {
  saltcorn_description,
  existing_tables_list,
  existing_entities_list,
  installed_plugins_list,
  available_plugins_list,
} = require("./prompts");

const doneTaskRowHtml = (task) =>
  tr(
    { "data-row-id": task.id },
    td(task.body.name || ""),
    td(task.body.description || ""),
    td((task.body.depends_on || []).join(", ")),
    td(task.body.priority || ""),
    td("Done"),
    td(
      task.body.run_id
        ? a(
            {
              target: "_blank",
              href: `/view/Saltcorn%20Agent%20copilot?run_id=${task.body.run_id}`,
            },
            i({ class: "fas fa-external-link-alt" })
          )
        : ""
    ),
    td(""),
    td(
      button(
        {
          class: "btn btn-outline-danger btn-sm",
          onclick: `view_post("${viewname}", "del_task", {id:${task.id}})`,
        },
        i({ class: "fas fa-trash-alt" })
      )
    )
  );

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
  const stopping = !running && rs.some((t) => t.body.status === "Running");
  const runningTask = rs.find((t) => t.body.status === "Running");
  const statusText = runningTask
    ? span(
        "Running: ",
        span({ class: "fw-bold" }, runningTask.body.name || "task")
      )
    : running
    ? "Currently running"
    : "Currently not running";
  const status = div(
    span({ id: "copilot-status-text" }, statusText),
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
            id: "copilot-start-btn",
            class: "btn btn-success ms-2",
            ...(stopping
              ? { disabled: true }
              : { onclick: `copilotStartRunning(this)` }),
          },
          stopping
            ? i({ class: "fas fa-spinner fa-spin me-1" })
            : i({ class: "fas fa-play me-1" }),
          stopping ? "Running..." : "Start running now"
        ),
    stopping &&
      span(
        {
          id: "copilot-stop-notice",
          class:
            "alert alert-warning alert-dismissible d-inline-block ms-2 py-1 px-2 mb-0",
          style: "font-size:0.875rem",
        },
        button({
          type: "button",
          class: "btn-close btn-sm",
          "data-bs-dismiss": "alert",
        }),
        "The current task will complete, then the queue stops. No new tasks will be started."
      ),
    button(
      {
        id: "copilot-run-next-btn",
        class: "btn btn-outline-success ms-2",
        style: running || stopping ? "display:none" : "",
        onclick: `copilotRunNext(this)`,
      },
      i({ class: "fas fa-play me-1" }),
      "Run next task"
    )
  );
  if (rs.length) {
    const runningOnLoad =
      !stopping && rs.some((t) => t.body.status === "Running");
    const doneNames = new Set(
      rs.filter((t) => t.body.status === "Done").map((t) => t.body.name)
    );
    return div(
      { class: "mt-2" },
      status,
      mkTable(
        [
          { label: "Name", key: (m) => m.body.name },
          { label: "Description", key: (m) => m.body.description },
          {
            label: "Depends on",
            key: (m) =>
              (m.body.depends_on || [])
                .map((dep) =>
                  doneNames.has(dep)
                    ? span(
                        { class: "dep-indicator text-success me-2", style: "white-space:nowrap", title: dep },
                        i({ class: "fas fa-check-circle me-1", style: "font-size:0.75em" }),
                        dep
                      )
                    : span(
                        { class: "dep-indicator text-danger me-2", style: "white-space:nowrap", title: dep },
                        i({ class: "fas fa-circle me-1", style: "font-size:0.75em" }),
                        dep
                      )
                )
                .join(""),
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
                      "data-task-run": r.id,
                      onclick: `copilotRunTask(this,${r.id})`,
                    },
                    i({ class: "fas fa-play" })
                  ),
          },
          {
            label: "",
            key: (r) =>
              (r.body.status === "To do" || !r.body.status) &&
              features.view_route_modal
                ? button(
                    {
                      class: "btn btn-outline-primary btn-sm",
                      title: "Edit description",
                      onclick: `ajax_modal('/view/${encodeURIComponent(
                        viewname
                      )}/edit_task_desc?id=${r.id}', {method:'POST'})`,
                    },
                    i({ class: "fas fa-edit" })
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
            (t) =>
              !t.body.status ||
              t.body.status === "To do" ||
              t.body.status === "Running"
          ),
          Done: rs.filter((t) => t.body.status === "Done"),
        },
        { grouped: true }
      ),
      script(`
function copilotSetRunningStatus(name) {
  const el = document.getElementById('copilot-status-text');
  if (!el) return;
  el.textContent = '';
  el.appendChild(document.createTextNode('Running: '));
  const strong = document.createElement('span');
  strong.className = 'fw-bold';
  strong.textContent = name || 'task';
  el.appendChild(strong);
}

function copilotInitStopping() {
  const startBtn = document.getElementById('copilot-start-btn');
  const noticeEl = document.getElementById('copilot-stop-notice');
  const runNextBtn = document.getElementById('copilot-run-next-btn');
  for (const b of document.querySelectorAll('[data-task-run]')) b.disabled = true;
  const movedToDone = copilotDoneIds();
  const poll = () => {
    view_post(${JSON.stringify(viewname)}, 'tasks_poll', {}, (resp) => {
      if (!resp || !resp.tasks) return;
      let hasRunning = false;
      for (const task of resp.tasks) {
        if (task.status === 'Done' && !movedToDone.has(task.id)) {
          movedToDone.add(task.id);
          view_post(${JSON.stringify(
            viewname
          )}, 'task_row_done', {id: task.id}, (rowResp) => {
            copilotAppendDoneRow(task.id, rowResp);
          });
        } else if (task.status === 'Running') {
          hasRunning = true;
          copilotShowSpinner(task.id);
        }
      }
      if (hasRunning) {
        setTimeout(poll, 3000);
      } else {
        if (noticeEl) noticeEl.remove();
        const statusTextEl = document.getElementById('copilot-status-text');
        if (statusTextEl) statusTextEl.textContent = 'Currently not running';
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.innerHTML = '<i class="fas fa-play me-1"></i>Start running now';
          startBtn.onclick = () => copilotStartRunning(startBtn);
        }
        if (runNextBtn) runNextBtn.style.display = '';
        for (const b of document.querySelectorAll('[data-task-run]')) b.disabled = false;
      }
    });
  };
  setTimeout(poll, 1000);
}

function copilotUpdateDepColors() {
  const doneHeader = Array.from(document.querySelectorAll('h4.list-group-header'))
    .find(h => h.textContent.trim() === 'Done');
  const doneNames = new Set();
  if (doneHeader) {
    let sib = doneHeader.closest('tr').nextElementSibling;
    while (sib) {
      const firstTd = sib.querySelector('td');
      if (firstTd) doneNames.add(firstTd.textContent.trim());
      sib = sib.nextElementSibling;
    }
  }
  for (const el of document.querySelectorAll('.dep-indicator')) {
    const dep = el.getAttribute('title');
    const done = doneNames.has(dep);
    el.className = 'dep-indicator me-2 ' + (done ? 'text-success' : 'text-danger');
    el.style.whiteSpace = 'nowrap';
    const icon = el.querySelector('i');
    if (icon) icon.className = (done ? 'fas fa-check-circle' : 'fas fa-circle') + ' me-1';
  }
}

function copilotAppendDoneRow(taskId, rowResp) {
  const row = document.querySelector('tr[data-row-id="' + taskId + '"]');
  if (row) row.remove();
  const doneHeader = Array.from(document.querySelectorAll('h4.list-group-header'))
    .find(h => h.textContent.trim() === 'Done');
  if (doneHeader && rowResp && rowResp.html) {
    const tbody = doneHeader.closest('tr').parentNode;
    const tmp = document.createElement('tbody');
    tmp.innerHTML = rowResp.html;
    tbody.appendChild(tmp.firstChild);
  }
  copilotUpdateDepColors();
}

function copilotRunTask(btn, taskId, force) {
  view_post(${JSON.stringify(
    viewname
  )}, 'run_task', {id: taskId, force: !!force}, (resp) => {
    if (resp && resp.unmet_deps && resp.unmet_deps.length > 0) {
      const msg = 'These dependencies are not yet done:\\n\\n  ' + resp.unmet_deps.join('\\n  ') + '\\n\\nRun this task anyway?';
      if (!confirm(msg)) return;
      copilotRunTask(btn, taskId, true);
      return;
    }
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    const runNextBtn = document.getElementById('copilot-run-next-btn');
    const startBtn = document.getElementById('copilot-start-btn');
    if (runNextBtn) runNextBtn.disabled = true;
    if (startBtn) startBtn.disabled = true;
    for (const b of document.querySelectorAll('[data-task-run]')) {
      if (b !== btn) b.disabled = true;
    }
    const row = document.querySelector('tr[data-row-id="' + taskId + '"]');
    const taskName = row ? (row.cells[0]?.textContent?.trim() || '') : '';
    const statusTextEl = document.getElementById('copilot-status-text');
    copilotSetRunningStatus(taskName);
    const poll = () => {
      view_post(${JSON.stringify(
        viewname
      )}, 'task_status', {ids: [String(taskId)]}, (statusResp) => {
        if (statusResp && statusResp.any_done) {
          if (statusTextEl) statusTextEl.textContent = 'Currently not running';
          if (runNextBtn) runNextBtn.disabled = false;
          if (startBtn) startBtn.disabled = false;
          for (const b of document.querySelectorAll('[data-task-run]')) b.disabled = false;
          view_post(${JSON.stringify(
            viewname
          )}, 'task_row_done', {id: taskId}, (rowResp) => {
            copilotAppendDoneRow(taskId, rowResp);
          });
        } else {
          setTimeout(poll, 3000);
        }
      });
    };
    setTimeout(poll, 3000);
  });
}

function copilotDoneIds() {
  const ids = new Set();
  const doneHeader = Array.from(document.querySelectorAll('h4.list-group-header'))
    .find(h => h.textContent.trim() === 'Done');
  if (doneHeader) {
    let sib = doneHeader.closest('tr').nextElementSibling;
    while (sib) {
      const id = sib.getAttribute('data-row-id');
      if (id) ids.add(Number(id));
      sib = sib.nextElementSibling;
    }
  }
  return ids;
}

function copilotShowSpinner(taskId) {
  const row = document.querySelector('tr[data-row-id="' + taskId + '"]');
  if (row && !row.querySelector('.task-spinner')) {
    const runBtn = row.querySelector('[data-task-run]');
    if (runBtn) {
      runBtn.closest('td').innerHTML =
        '<span class="task-spinner" data-task-id="' + taskId + '">' +
        '<i class="fas fa-spinner fa-spin text-warning"></i></span>';
    }
  }
}

function copilotRunNext(btn) {
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Running...';
  const firstRunBtn = document.querySelector('[data-task-run]');
  const optimisticId = firstRunBtn ? Number(firstRunBtn.getAttribute('data-task-run')) : null;
  if (optimisticId) copilotShowSpinner(optimisticId);
  const movedToDone = copilotDoneIds();
  view_post(${JSON.stringify(viewname)}, 'run_task', {}, () => {
    const poll = () => {
      view_post(${JSON.stringify(viewname)}, 'tasks_poll', {}, (resp) => {
        if (!resp || !resp.tasks) return;
        let hasRunning = false;
        const runningIds = new Set(resp.tasks.filter(t => t.status === 'Running').map(t => t.id));
        if (optimisticId && !runningIds.has(optimisticId) && !movedToDone.has(optimisticId)) {
          const staleRow = document.querySelector('tr[data-row-id="' + optimisticId + '"]');
          const staleSpinner = staleRow?.querySelector('.task-spinner');
          if (staleSpinner) staleSpinner.closest('td').innerHTML =
            '<button class="btn btn-outline-success btn-sm" data-task-run="' + optimisticId + '" onclick="copilotRunTask(this,' + optimisticId + ')"><i class="fas fa-play"></i></button>';
        }
        for (const task of resp.tasks) {
          if (task.status === 'Done' && !movedToDone.has(task.id)) {
            movedToDone.add(task.id);
            view_post(${JSON.stringify(
              viewname
            )}, 'task_row_done', {id: task.id}, (rowResp) => {
              copilotAppendDoneRow(task.id, rowResp);
            });
          } else if (task.status === 'Running') {
            hasRunning = true;
            copilotShowSpinner(task.id);
          }
        }
        if (hasRunning) setTimeout(poll, 3000);
        else {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      });
    };
    setTimeout(poll, 500);
  });
}

function copilotStartRunning(btn) {
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Running...';
  const runNextBtn = document.getElementById('copilot-run-next-btn');
  const statusTextEl = document.getElementById('copilot-status-text');
  if (runNextBtn) runNextBtn.style.display = 'none';
  if (statusTextEl) statusTextEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Running';
  let stopped = false;
  let stopNotice = null;
  const stopBtn = document.createElement('button');
  stopBtn.className = 'btn btn-danger ms-2';
  stopBtn.innerHTML = '<i class="fas fa-stop me-1"></i>Stop';
  stopBtn.onclick = () => {
    stopped = true;
    stopBtn.disabled = true;
    view_post(${JSON.stringify(viewname)}, 'stop', {});
    if (!stopNotice) {
      stopNotice = document.createElement('span');
      stopNotice.className = 'alert alert-warning alert-dismissible d-inline-block ms-2 py-1 px-2 mb-0';
      stopNotice.style.fontSize = '0.875rem';
      stopNotice.innerHTML =
        '<button type="button" class="btn-close btn-sm" data-bs-dismiss="alert"></button>' +
        'The current task will complete, then the queue stops. No new tasks will be started.';
      stopBtn.insertAdjacentElement('afterend', stopNotice);
    }
  };
  btn.insertAdjacentElement('afterend', stopBtn);
  view_post(${JSON.stringify(viewname)}, 'start', {}, () => {
    const movedToDone = copilotDoneIds();
    const poll = () => {
      view_post(${JSON.stringify(viewname)}, 'tasks_poll', {}, (resp) => {
        if (!resp || !resp.tasks) return;
        let hasPending = false;
        let hasRunning = false;
        for (const task of resp.tasks) {
          if (task.status === 'Done' && !movedToDone.has(task.id)) {
            movedToDone.add(task.id);
            view_post(${JSON.stringify(
              viewname
            )}, 'task_row_done', {id: task.id}, (rowResp) => {
              copilotAppendDoneRow(task.id, rowResp);
            });
          } else if (task.status === 'Running') {
            hasRunning = true;
            copilotShowSpinner(task.id);
            copilotSetRunningStatus(task.name);
          } else if (task.status !== 'Done') {
            hasPending = true;
          }
        }
        if (hasRunning || (!stopped && hasPending)) {
          setTimeout(poll, 3000);
        } else {
          stopBtn.remove();
          if (stopNotice) { stopNotice.remove(); stopNotice = null; }
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-play me-1"></i>Start running now';
          if (statusTextEl) statusTextEl.textContent = 'Currently not running';
          if (runNextBtn) runNextBtn.style.display = '';
        }
      });
    };
    setTimeout(poll, 1000);
  });
}
`),
      stopping
        ? script(domReady(`copilotInitStopping();`))
        : runningOnLoad
        ? script(
            domReady(`
const runNextBtn = document.getElementById('copilot-run-next-btn');
const startBtn = document.getElementById('copilot-start-btn');
if (runNextBtn) runNextBtn.disabled = true;
if (startBtn) startBtn.disabled = true;
for (const b of document.querySelectorAll('[data-task-run]')) b.disabled = true;
const pollTasks = () => {
  const spinners = document.querySelectorAll('.task-spinner[data-task-id]');
  if (!spinners.length) return;
  const ids = Array.from(spinners).map(el => el.getAttribute('data-task-id'));
  view_post(${JSON.stringify(viewname)}, 'task_status', {ids}, (resp) => {
    if (resp && resp.any_done) location.reload();
    else setTimeout(pollTasks, 3000);
  });
};
setTimeout(pollTasks, 3000);
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
    const planning = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "planning",
    });
    if (planning) {
      return div(
        { class: "mt-2" },
        p(
          i({ class: "fas fa-spinner fa-spin me-2" }),
          "Planning tasks, please wait..."
        ),
        script(
          domReady(`
const poll = () => {
  view_post(${JSON.stringify(viewname)}, 'planning_status', {}, (resp) => {
    if (resp && !resp.planning) location.reload();
    else setTimeout(poll, 3000);
  });
};
setTimeout(poll, 3000);
`)
        )
      );
    }
    return div(
      { class: "mt-2", id: "task-gen-area" },
      p("No tasks found"),
      button(
        {
          class: "btn btn-primary",
          onclick: `copilotGenTasks()`,
        },
        "Plan tasks"
      ),
      script(
        domReady(`
window.copilotGenTasks = function() {
  const area = document.getElementById('task-gen-area');
  if (area) area.innerHTML = '<p><i class="fas fa-spinner fa-spin me-2"></i>Planning tasks, please wait...</p>';
  view_post(${JSON.stringify(viewname)}, 'gen_tasks', {}, () => {
    const poll = () => {
      view_post(${JSON.stringify(viewname)}, 'planning_status', {}, (resp) => {
        if (resp && !resp.planning) location.reload();
        else setTimeout(poll, 3000);
      });
    };
    setTimeout(poll, 3000);
  });
};
`)
      )
    );
  }
};

const get_view_config_tool = {
  type: "function",
  function: {
    name: "get_view_config",
    description:
      "Fetch the full configuration of an existing view so you can decide whether to reuse it or create a new one. Call this before planning a task if you are unsure whether an existing view already meets the requirements.",
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description: "The exact name of the existing view to inspect.",
        },
      },
    },
  },
};

const doGenTasks = async (spec, rs, schema, userId) => {
  const planningMd = await MetaData.create({
    type: "CopilotConstructMgr",
    name: "planning",
    body: {},
  });
  try {
    const tables = await Table.find({});
    const tableById = Object.fromEntries(tables.map((t) => [t.id, t.name]));
    const views = await View.find({});
    const triggers = await Trigger.find({});
    const pages = await Page.find({});
    const entitiesSection = existing_entities_list({
      views,
      triggers,
      pages,
      tableById,
    });
    const installedPlugins = await Plugin.find({});
    const installedNames = new Set(installedPlugins.map((p) => p.name));
    let storePlugins = [];
    try {
      storePlugins = await Plugin.store_plugins_available();
    } catch (_) {}
    const installedPluginsSection = installed_plugins_list(installedNames);
    const pluginsSection = available_plugins_list(storePlugins, installedNames);
    const systemPrompt =
      "You are a project manager. The user wants to build an application, and you must analyse their application description";

    const tools = [get_view_config_tool, task_tool];
    const chat = [];

    let answer = await getState().functions.llm_generate.run(
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

${entitiesSection ? entitiesSection + "\n\n" : ""}${installedPluginsSection ? installedPluginsSection + "\n\n" : ""}${
        pluginsSection ? pluginsSection + "\n\n" : ""
      }The plan should focus on building views, triggers (including workflows) and pages.

Important trigger planning rules:
* When a task involves a simple field update (e.g. marking an item complete or incomplete), plan it as a trigger using modify_row — NOT a workflow. Use a workflow only when multiple steps, branching, or looping are genuinely required.
* If multiple independent single-step actions are needed (e.g. "mark complete" and "mark incomplete"), describe them as separate triggers in the task description — do not describe them as one combined workflow.
* Do NOT mention "navigate back" or "return to context" in trigger task descriptions. Navigation is configured at the view level (GoBack button), not inside a trigger.
* If a trigger should be accessible as a button in a view, the task description must name the target view and say to add an action segment with action_name set to the trigger's name. If the view already exists, combine trigger creation and view update in the same task. If the view is created in a later task, that task's description must mention adding the trigger button, and it must depend on the trigger task.
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
* Every List view task description must include a delete action column unless the table is explicitly read-only. State it explicitly: "Add a delete action column."
* In general, if a view embeds or links to another view, the linked view's task must be listed as a dependency.
* When a table has foreign key fields referencing the users table, the task description must explicitly state for each one whether it is an ownership field (automatically set from the logged-in user, omit from the form) or a selector field (the user picks a value, include a selector in the form). Example: "user_id records the owner and is set automatically; shared_with_user_id must have a user selector."
* For FK fields that represent a parent context (e.g. trip_id on packing_items), always include the field as a normal selector in the Edit view form. Do NOT say to omit it. Saltcorn automatically pre-fills the selector from the URL query parameter when the view is opened from a parent context, and the user can select it manually when the view is used standalone.
* For every task that creates a view, include the exact view name in the task description. View names must be lowercase, snake_case, unique across all tasks in the plan, and descriptive enough to identify the table and purpose — for example 'packing_items_edit' rather than just 'edit'.
* Do NOT plan an Edit view for any table whose description says it is auto-populated or not editable by users (e.g. audit logs, import/export job tracking tables). These tables may have List and Show views for read-only visibility, but never an Edit view.
Important user account rules:
* The platform (Saltcorn) provides a built-in user account system with login, registration, and session management. Do NOT plan any tasks for user registration, login pages, password management, authentication flows, or email verification — these are already handled by the platform. Users register at /auth/signup and log in at /auth/login.
* User identity is always available as the logged-in user. Ownership fields (FK to users) are set automatically from the session; no custom logic is needed.
* If a requirement mentions "user accounts", "secure login", "saving data per user", "user-specific data", or "sharing between users", treat it as already satisfied by the platform's built-in user system. Do not generate any task in response to such a requirement.

Important role rules:
* Every view and page task description MUST state the min_role explicitly, e.g. "Set min_role to admin (1)." or "Set min_role to user (80).". Never omit it.
* Role values: admin=1, staff=40, user=80, public=100. Use the value that matches who will use the view or page — admin for management, staff for staff-only, user for logged-in users (clients, members, etc.), public only when the view or page must be accessible without login.

Important dashboard rules:
* A dashboard page that shows aggregate statistics (totals, counts, revenue, etc.) must NEVER use client-side JavaScript fetch stubs or placeholder values. Every stat card must be backed by a real Saltcorn Statistic view embedded with an embed-view tag.
* For each statistic shown on a dashboard, plan a separate Statistic view task (e.g. "total_billable_hours_stat", "revenue_by_client_stat"). The dashboard page task must list all these Statistic view tasks in its depends_on.
* Statistic view tasks must be planned before the dashboard page task and have descriptive names that make their metric clear.

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

Before finalising the plan, you may call get_view_config for any existing view you are unsure about — to inspect its configuration and decide whether a task should reuse it (updating it) or create a new one. Once you have gathered all necessary information, call plan_tasks to submit the complete task list.
`,
      {
        tools,
        chat,
        appendToChat: true,
        systemPrompt,
      }
    );

    const MAX_ITERATIONS = 10;
    let iterations = 0;

    while (iterations++ < MAX_ITERATIONS) {
      if (typeof answer !== "object" || !answer.getToolCalls) break;
      const toolCalls = answer.getToolCalls();
      if (!toolCalls.length) break;

      const planCall = toolCalls.find((tc) => tc.tool_name === "plan_tasks");
      if (planCall) {
        const tasks = planCall.input.tasks;
        const plannedNames = new Set(tasks.map((t) => t.name).filter(Boolean));

        for (const task of tasks) {
          const validDeps = (task.depends_on || []).filter((nm) => {
            if (!plannedNames.has(nm)) {
              getState().log(
                2,
                `AppConstructor: dropping phantom dependency "${nm}" from task "${task.name}" — no such task in plan`
              );
              return false;
            }
            return true;
          });
          await MetaData.create({
            type: "CopilotConstructMgr",
            name: "task",
            body: { ...task, depends_on: validDeps },
            user_id: userId,
          });
        }
        break;
      }

      const getViewCalls = toolCalls.filter(
        (tc) => tc.tool_name === "get_view_config"
      );
      if (!getViewCalls.length) break;

      for (const tc of getViewCalls) {
        const viewName = tc.input?.name;
        const view = viewName ? await View.findOne({ name: viewName }) : null;
        const result = view
          ? JSON.stringify(
              {
                name: view.name,
                viewtemplate: view.viewtemplate,
                configuration: view.configuration,
              },
              null,
              2
            )
          : `No view named "${viewName}" found.`;

        if (answer.ai_sdk) {
          chat.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: tc.tool_call_id,
                toolName: "get_view_config",
                result,
              },
            ],
          });
        } else {
          chat.push({
            role: "tool",
            tool_call_id: tc.tool_call_id,
            name: "get_view_config",
            content: result,
          });
        }
      }

      answer = await getState().functions.llm_generate.run(null, {
        tools,
        chat,
        appendToChat: true,
        systemPrompt,
      });
    }
  } finally {
    await planningMd.delete();
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
  doGenTasks(spec, rs, schema, req.user?.id).catch((e) =>
    console.error("gen_tasks error", e)
  );
  return { json: { success: true } };
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
  if (body.id) {
    if (!body.force) {
      const task = await MetaData.findOne({ id: Number(body.id) });
      const deps = task?.body?.depends_on || [];
      if (deps.length > 0) {
        const allTasks = await MetaData.find({
          type: "CopilotConstructMgr",
          name: "task",
        });
        const doneNames = new Set(
          allTasks
            .filter((t) => t.body.status === "Done")
            .map((t) => t.body.name)
        );
        const unmet = deps.filter((d) => !doneNames.has(d));
        if (unmet.length > 0)
          return {
            json: { unmet_deps: unmet, task_name: task.body.name || "" },
          };
      }
    }
    runTask(body.id, { user: reqUser, __: req.__ }).catch((e) =>
      console.error("run_task error", e)
    );
    return { json: { success: true } };
  }
  runNextTask(true).catch((e) => console.error("run_task error", e));
  return { json: { success: true } };
};

const planning_status = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const planning = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "planning",
  });
  return { json: { planning: !!planning } };
};

const tasks_poll = async (table_id, viewname, config, body, { req, res }) => {
  const tasks = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "task",
  });
  return {
    json: {
      tasks: tasks.map((t) => ({
        id: t.id,
        name: t.body.name,
        status: t.body.status || "To do",
        run_id: t.body.run_id,
      })),
    },
  };
};

const task_row_done = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const task = await MetaData.findOne({ id: body.id });
  if (!task) return { json: { html: "" } };
  return { json: { html: doneTaskRowHtml(task) } };
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
  return { json: { success: true } };
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
  return { json: { success: true } };
};

const edit_task_desc = async (table_id, vname, config, body, { req, res }) => {
  const id = body.id || req.query?.id;
  const r = await MetaData.findOne({ id: Number(id) });
  if (!r) return { json: { error: "Task not found" } };
  const html =
    div(
      { class: "mb-3" },
      textarea(
        {
          id: "edit-task-desc-text",
          class: "form-control",
          rows: "10",
        },
        text_attr(r.body.description || "")
      )
    ) +
    div(
      { class: "d-flex gap-2 mt-3" },
      button(
        {
          type: "button",
          class: "btn btn-primary",
          onclick: `view_post(${JSON.stringify(vname)}, 'save_task_desc', {id:${
            r.id
          }, description: document.getElementById('edit-task-desc-text').value}, () => { $('#scmodal').modal('hide'); location.reload(); })`,
        },
        "Save"
      ),
      button(
        {
          type: "button",
          class: "btn btn-secondary",
          "data-bs-dismiss": "modal",
        },
        "Cancel"
      )
    );
  return { html, title: `Edit: ${r.body.name || "task"}` };
};

const save_task_desc = async (table_id, vname, config, body, { req, res }) => {
  const r = await MetaData.findOne({ id: Number(body.id) });
  if (!r) throw new Error("Task not found");
  await r.update({ body: { ...r.body, description: body.description } });
  return { json: { success: true } };
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
  edit_task_desc,
  save_task_desc,
  run_task,
  planning_status,
  task_status,
  tasks_poll,
  task_row_done,
  start,
  stop,
};

module.exports = { makeTaskList, task_routes };
