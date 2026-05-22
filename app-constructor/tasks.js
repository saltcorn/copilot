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
const { getResearchAnswersText } = require("./research");
const {
  saltcorn_description,
  existing_tables_list,
  existing_entities_list,
  installed_plugins_list,
  available_plugins_list,
  task_planning_rules,
  task_planning_closing,
  research_answers_section,
} = require("./prompts");

const tasksStaticScript = `<script>
const _tasksVn = ${JSON.stringify(viewname)};

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
    view_post(_tasksVn, 'tasks_poll', {}, (resp) => {
      if (!resp || !resp.tasks) return;
      let hasRunning = false;
      for (const task of resp.tasks) {
        if (task.status === 'Done' && !movedToDone.has(task.id)) {
          movedToDone.add(task.id);
          view_post(_tasksVn, 'task_row_done', {id: task.id}, (rowResp) => {
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
  if (!window.dynamic_updates_cfg?.enabled) setTimeout(poll, 1000);
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
  view_post(_tasksVn, 'run_task', {id: taskId, force: !!force}, (resp) => {
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
      view_post(_tasksVn, 'task_status', {ids: [String(taskId)]}, (statusResp) => {
        if (statusResp && statusResp.any_done) {
          if (statusTextEl) statusTextEl.textContent = 'Currently not running';
          if (runNextBtn) runNextBtn.disabled = false;
          if (startBtn) startBtn.disabled = false;
          for (const b of document.querySelectorAll('[data-task-run]')) b.disabled = false;
          view_post(_tasksVn, 'task_row_done', {id: taskId}, (rowResp) => {
            copilotAppendDoneRow(taskId, rowResp);
          });
        } else {
          setTimeout(poll, 3000);
        }
      });
    };
    if (!window.dynamic_updates_cfg?.enabled) setTimeout(poll, 3000);
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
      runBtn.outerHTML =
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
  view_post(_tasksVn, 'run_task', {}, () => {
    const poll = () => {
      view_post(_tasksVn, 'tasks_poll', {}, (resp) => {
        if (!resp || !resp.tasks) return;
        let hasRunning = false;
        const runningIds = new Set(resp.tasks.filter(t => t.status === 'Running').map(t => t.id));
        if (optimisticId && !runningIds.has(optimisticId) && !movedToDone.has(optimisticId)) {
          const staleRow = document.querySelector('tr[data-row-id="' + optimisticId + '"]');
          const staleSpinner = staleRow?.querySelector('.task-spinner');
          if (staleSpinner) staleSpinner.outerHTML =
            '<button class="btn btn-outline-success btn-sm" data-task-run="' + optimisticId + '" onclick="copilotRunTask(this,' + optimisticId + ')" title="Run task"><i class="fas fa-play"></i></button>';
        }
        for (const task of resp.tasks) {
          if (task.status === 'Done' && !movedToDone.has(task.id)) {
            movedToDone.add(task.id);
            view_post(_tasksVn, 'task_row_done', {id: task.id}, (rowResp) => {
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
    if (!window.dynamic_updates_cfg?.enabled) setTimeout(poll, 500);
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
    view_post(_tasksVn, 'stop', {});
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
  view_post(_tasksVn, 'start', {}, () => {
    const movedToDone = copilotDoneIds();
    const poll = () => {
      view_post(_tasksVn, 'tasks_poll', {}, (resp) => {
        if (!resp || !resp.tasks) return;
        let hasPending = false;
        let hasRunning = false;
        for (const task of resp.tasks) {
          if (task.status === 'Done' && !movedToDone.has(task.id)) {
            movedToDone.add(task.id);
            view_post(_tasksVn, 'task_row_done', {id: task.id}, (rowResp) => {
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
          if (!hasRunning && statusTextEl)
            statusTextEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Starting next task…';
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
    if (!window.dynamic_updates_cfg?.enabled) setTimeout(poll, 1000);
  });
}

window.copilotGenTasks = function() {
  const area = document.getElementById('task-gen-area');
  if (area) area.innerHTML = '<p><i class="fas fa-spinner fa-spin me-2"></i>Planning tasks, please wait...</p>';
  view_post(_tasksVn, 'gen_tasks', {}, () => {
    const poll = () => {
      view_post(_tasksVn, 'planning_status', {}, (resp) => {
        if (resp && !resp.planning) {
          if (typeof copilotRefreshTasks === 'function') copilotRefreshTasks();
        } else setTimeout(poll, 3000);
      });
    };
    if (!window.dynamic_updates_cfg?.enabled) setTimeout(poll, 3000);
  });
};

function copilotInitTasksState() {
  const hasSpinners = !!document.querySelector('#task-list-area .task-spinner');
  const hasStopNotice = !!document.getElementById('copilot-stop-notice');
  const isPlanningState = !!document.getElementById('tasks-planning-state');
  const isRunningActive = !!document.getElementById('copilot-stop-btn');
  if (hasSpinners && hasStopNotice) {
    copilotInitStopping();
  } else if (hasSpinners) {
    const runNextBtn = document.getElementById('copilot-run-next-btn');
    const startBtn = document.getElementById('copilot-start-btn');
    if (runNextBtn) runNextBtn.disabled = true;
    if (startBtn) startBtn.disabled = true;
    for (const b of document.querySelectorAll('[data-task-run]')) b.disabled = true;
    const pollTasks = () => {
      const spinners = document.querySelectorAll('.task-spinner[data-task-id]');
      if (!spinners.length) return;
      const ids = Array.from(spinners).map(el => el.getAttribute('data-task-id'));
      view_post(_tasksVn, 'task_status', {ids}, (resp) => {
        if (resp && resp.any_done) {
          if (typeof copilotRefreshTasks === 'function') copilotRefreshTasks();
        } else setTimeout(pollTasks, 3000);
      });
    };
    if (!window.dynamic_updates_cfg?.enabled) setTimeout(pollTasks, 3000);
  } else if (isRunningActive) {
    const statusEl = document.getElementById('copilot-status-text');
    const movedToDone = copilotDoneIds();
    const poll = () => {
      view_post(_tasksVn, 'tasks_poll', {}, (resp) => {
        if (!resp || !resp.tasks) return;
        let hasRunning = false;
        let hasPending = false;
        for (const task of resp.tasks) {
          if (task.status === 'Running') {
            hasRunning = true;
            copilotShowSpinner(task.id);
            copilotSetRunningStatus(task.name);
          } else if (task.status === 'Done' && !movedToDone.has(task.id)) {
            movedToDone.add(task.id);
            view_post(_tasksVn, 'task_row_done', {id: task.id}, (rowResp) => {
              copilotAppendDoneRow(task.id, rowResp);
            });
          } else if (task.status !== 'Done') {
            hasPending = true;
          }
        }
        if (hasRunning || hasPending) {
          if (!hasRunning && statusEl)
            statusEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Starting next task…';
          setTimeout(poll, 2000);
        } else {
          if (typeof copilotRefreshTasks === 'function') copilotRefreshTasks();
        }
      });
    };
    if (statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Starting next task…';
    if (!window.dynamic_updates_cfg?.enabled) setTimeout(poll, 1000);
  } else if (isPlanningState) {
    const poll = () => {
      view_post(_tasksVn, 'planning_status', {}, (resp) => {
        if (resp && !resp.planning) {
          if (typeof copilotRefreshTasks === 'function') copilotRefreshTasks();
        } else setTimeout(poll, 3000);
      });
    };
    if (!window.dynamic_updates_cfg?.enabled) setTimeout(poll, 3000);
  }
}
window.copilotInitTasksState = copilotInitTasksState;

(function () {
  if (document.readyState !== 'loading') copilotInitTasksState();
  else document.addEventListener('DOMContentLoaded', copilotInitTasksState);
})();
</script>`;

const feedbackBadge = (body) =>
  body.source === "feedback"
    ? span(
        {
          class: "badge bg-warning text-dark ms-2 fw-normal",
          title: `From feedback: ${body.feedback_title || ""}`,
        },
        i({ class: "fas fa-comment-alt me-1" }),
        "feedback"
      )
    : "";

const doneTaskRowHtml = (task) =>
  tr(
    { "data-row-id": task.id },
    td((task.body.name || "") + feedbackBadge(task.body)),
    td(task.body.description || ""),
    td((task.body.depends_on || []).join(", ")),
    td(task.body.priority || ""),
    td("Done"),
    td(
      div(
        { class: "d-flex align-items-center gap-1" },
        task.body.run_id
          ? a(
              {
                target: "_blank",
                href: `/view/Saltcorn%20Agent%20copilot?run_id=${task.body.run_id}`,
                class: "btn btn-outline-secondary btn-sm",
                title: "View run",
              },
              i({ class: "fas fa-external-link-alt" })
            )
          : "",
        button(
          {
            class: "btn btn-outline-danger btn-sm",
            onclick: `view_post("${viewname}", "del_task", {id:${task.id}})`,
            title: "Delete",
          },
          i({ class: "fas fa-trash-alt" })
        )
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
            id: "copilot-stop-btn",
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
    const doneNames = new Set(
      rs.filter((t) => t.body.status === "Done").map((t) => t.body.name)
    );
    return div(
      { class: "mt-2" },
      status,
      mkTable(
        [
          {
            label: "Name",
            key: (m) => (m.body.name || "") + feedbackBadge(m.body),
          },
          { label: "Description", key: (m) => m.body.description },
          {
            label: "Depends on",
            key: (m) =>
              (m.body.depends_on || [])
                .map((dep) =>
                  doneNames.has(dep)
                    ? span(
                        {
                          class: "dep-indicator text-success me-2",
                          style: "white-space:nowrap",
                          title: dep,
                        },
                        i({
                          class: "fas fa-check-circle me-1",
                          style: "font-size:0.75em",
                        }),
                        dep
                      )
                    : span(
                        {
                          class: "dep-indicator text-danger me-2",
                          style: "white-space:nowrap",
                          title: dep,
                        },
                        i({
                          class: "fas fa-circle me-1",
                          style: "font-size:0.75em",
                        }),
                        dep
                      )
                )
                .join(""),
          },
          { label: "Priority", key: (m) => m.body.priority },
          { label: "Status", key: (m) => m.body.status || "To do" },
          {
            label: "",
            key: (r) => {
              const isRunning = r.body.status === "Running";
              const isDone = r.body.status === "Done";
              const isTodo = !r.body.status || r.body.status === "To do";
              const runPart = isRunning
                ? span(
                    { class: "task-spinner", "data-task-id": r.id },
                    i({ class: "fas fa-spinner fa-spin text-warning" })
                  )
                : isDone
                ? r.body.run_id
                  ? a(
                      {
                        target: "_blank",
                        href: `/view/Saltcorn%20Agent%20copilot?run_id=${r.body.run_id}`,
                        class: "btn btn-outline-secondary btn-sm",
                        title: "View run",
                      },
                      i({ class: "fas fa-external-link-alt" })
                    )
                  : ""
                : button(
                    {
                      class: "btn btn-outline-success btn-sm",
                      "data-task-run": r.id,
                      onclick: `copilotRunTask(this,${r.id})`,
                      title: "Run task",
                    },
                    i({ class: "fas fa-play" })
                  );
              const editPart =
                isTodo && features.view_route_modal
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
                  : "";
              const deletePart = button(
                {
                  class: "btn btn-outline-danger btn-sm",
                  onclick: `view_post("${viewname}", "del_task", {id:${r.id}})`,
                  title: "Delete",
                },
                i({ class: "fas fa-trash-alt" })
              );
              return div(
                { class: "d-flex align-items-center gap-1" },
                runPart,
                editPart,
                deletePart
              );
            },
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
          { id: "tasks-planning-state" },
          i({ class: "fas fa-spinner fa-spin me-2" }),
          "Planning tasks, please wait..."
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
    const researchText = await getResearchAnswersText();
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

${spec.body.specification}
${research_answers_section(researchText)}
These are the requirements of the application:

${rs.map((r) => `* ${r.body.requirement}`).join("\n")}

${saltcorn_description}

The database has already been built. The following tables are now present in the database:

${existing_tables_list(tables)}

The plan should outline the continued development of the application on top of this database.
Your plan can add additional tables if needed or adjust the table fields, but normally the tables
should be designed optimally for this application.

${entitiesSection ? entitiesSection + "\n\n" : ""}${
        installedPluginsSection ? installedPluginsSection + "\n\n" : ""
      }${pluginsSection ? pluginsSection + "\n\n" : ""}${task_planning_rules}

${task_planning_closing}

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
    try {
      getState().emitDynamicUpdate(db.getTenantSchema(), {
        eval_js:
          "if(typeof copilotRefreshTasks==='function')copilotRefreshTasks();",
      });
    } catch (_) {}
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
    type: "CopilotConstructMgr",
    name: "task",
  });

  if (!r) throw new Error("Task not found");
  await r.delete();
  return {
    json: {
      eval_js:
        "if(typeof copilotRefreshTasks==='function')copilotRefreshTasks();",
    },
  };
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
  const r = await MetaData.findOne({
    id: Number(id),
    type: "CopilotConstructMgr",
    name: "task",
  });
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
          onclick: `view_post(${JSON.stringify(vname)}, 'save_task_desc', {
  id: ${r.id},
  description: document.getElementById('edit-task-desc-text').value
}, () => {
  $('#scmodal').modal('hide');
  if (typeof copilotRefreshTasks === 'function') copilotRefreshTasks();
})`,
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
  const r = await MetaData.findOne({
    id: Number(body.id),
    type: "CopilotConstructMgr",
    name: "task",
  });
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
  return {
    json: {
      eval_js:
        "if(typeof copilotRefreshTasks==='function')copilotRefreshTasks();",
    },
  };
};

/** Route: returns the rendered task list HTML for AJAX refresh. */
const tasks_list_html = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const html = await makeTaskList(req);
  return { json: { html } };
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
  tasks_list_html,
};

module.exports = { makeTaskList, tasksStaticScript, task_routes };
