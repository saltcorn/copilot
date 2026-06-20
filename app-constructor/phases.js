const MetaData = require("@saltcorn/data/models/metadata");
const Table = require("@saltcorn/data/models/table");
const View = require("@saltcorn/data/models/view");
const Page = require("@saltcorn/data/models/page");
const Trigger = require("@saltcorn/data/models/trigger");
const Plugin = require("@saltcorn/data/models/plugin");
const {
  div,
  h6,
  p,
  span,
  button,
  i,
  small,
  ul,
  li,
  a,
  pre,
  textarea,
  label,
  select,
  option,
} = require("@saltcorn/markup/tags");
const { mkTable } = require("@saltcorn/markup");
const { getState, features } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const { viewname, tool_choice, projectType } = require("./common");
const { task_tool } = require("./tools");
const { runTask } = require("./run_task");
const { PromptGenerator } = require("./prompt-generator");

// ── Static client-side script ─────────────────────────────────────────────────

const phasesStaticScript = `<script>
const _phasesVn = ${JSON.stringify(viewname)};

function phasesStartPoll() {
  const poll = () => {
    view_post(_phasesVn, 'phases_status', {}, (resp) => {
      if (resp && !resp.generating) {
        view_post(_phasesVn, 'phases_html', {}, (r) => {
          if (r && r.html) document.getElementById('phases-panel').innerHTML = r.html;
        });
      } else setTimeout(poll, 3000);
    });
  };
  setTimeout(poll, 3000);
}

function _setPhaseParam(idx) {
  const url = new URL(location.href);
  if (idx !== null) url.searchParams.set('phase', idx);
  else url.searchParams.delete('phase');
  history.replaceState(null, '', url.toString());
}

window.copilotDelAllPhases = function() {
  if (!confirm('Delete all phases and their tasks?')) return;
  _setPhaseParam(null);
  view_post(_phasesVn, 'del_all_phases', {}, () => {
    view_post(_phasesVn, 'phases_html', {}, (r) => {
      if (r && r.html) document.getElementById('phases-panel').innerHTML = r.html;
    });
  });
};

window.copilotGenPhases = function() {
  const panel = document.getElementById('phases-panel');
  const hasPhases = panel && panel.querySelector('.card');
  if (hasPhases && !confirm('Regenerate phases? This will replace all existing phases and delete all phase tasks.')) return;
  _setPhaseParam(null);
  panel.innerHTML = '<p><i class="fas fa-spinner fa-spin me-2"></i>Generating phases, please wait...</p>';
  view_post(_phasesVn, 'gen_phases', {}, () => {});
  if (!window.dynamic_updates_cfg?.enabled) phasesStartPoll();
};

window.copilotRefreshPhases = function() {
  _setPhaseParam(null);
  view_post(_phasesVn, 'phases_html', {}, (r) => {
    if (r && r.html) document.getElementById('phases-panel').innerHTML = r.html;
  });
};

function _refreshPhaseArea(idx, taskType) {
  const areaId = taskType === 'plugin' ? 'phase-plugins-area'
               : taskType === 'data_model' ? 'phase-data-model-area'
               : 'phase-features-area';
  view_post(_phasesVn, 'phase_tasks_html', { idx, task_type: taskType }, (r) => {
    const el = document.getElementById(areaId);
    if (r && r.html && el) el.innerHTML = r.html;
  });
}

function _refreshAllAreas(idx) {
  _refreshPhaseArea(idx, 'plugin');
  _refreshPhaseArea(idx, 'data_model');
  _refreshPhaseArea(idx, 'feature');
}

window.copilotRefreshPhaseProgress = function(idx) {
  const el = document.getElementById('phase-progress-area-' + idx);
  if (!el) return;
  view_post(_phasesVn, 'phase_progress_html', { idx }, function(r) {
    if (r && r.html) el.innerHTML = r.html;
  });
};
window.copilotProgressGoPage = function(idx, pg) {
  var el = document.getElementById('phase-progress-area-' + idx);
  if (!el) return;
  view_post(_phasesVn, 'phase_progress_html', { idx: idx, page: pg }, function(r) {
    if (r && r.html) el.innerHTML = r.html;
  });
};

window.openPhaseDetail = function(idx) {
  _setPhaseParam(idx);
  view_post(_phasesVn, 'phase_detail_html', { idx }, (r) => {
    if (r && r.html) {
      const panel = document.getElementById('phases-panel');
      panel.innerHTML = r.html;
      panel.dataset.phaseIdx = idx;

      for (const tt of ['plugin', 'data_model', 'feature']) {
        view_post(_phasesVn, 'phase_tasks_status', { idx, task_type: tt }, (resp) => {
          if (resp && resp.generating && !window.dynamic_updates_cfg?.enabled) phaseTasksPoll(idx, tt);
        });
        if (!window.dynamic_updates_cfg?.enabled) {
          view_post(_phasesVn, 'phase_run_status', { idx, task_type: tt }, (resp) => {
            if (resp && (resp.isRunning || resp.anyRunning)) phasePollRunning(idx, tt);
          });
        }
      }
    }
  });
};

window.startPhaseTasks = function(btn, idx, taskType) {
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Running…';
  view_post(_phasesVn, 'run_phase_tasks', { idx, task_type: taskType }, (resp) => {
    if (!resp) { _refreshPhaseArea(idx, taskType); return; }
    if (!window.dynamic_updates_cfg?.enabled) phasePollRunning(idx, taskType);
  });
};

window.stopPhaseTasks = function(idx, taskType) {
  view_post(_phasesVn, 'stop_phase_tasks', { idx, task_type: taskType }, (resp) => {
    if (resp && resp.taskStillRunning) {
      const statusEl = document.getElementById('phase-run-status-' + idx + '-' + taskType);
      if (statusEl) statusEl.textContent = 'Stopping after current task…';
      if (!window.dynamic_updates_cfg?.enabled) phasePollRunning(idx, taskType);
    } else {
      _refreshPhaseArea(idx, taskType);
    }
  });
};

function phasePollRunning(idx, taskType) {
  let lastTaskName;
  const poll = () => {
    view_post(_phasesVn, 'phase_run_status', { idx, task_type: taskType }, (resp) => {
      if (!resp) { _refreshPhaseArea(idx, taskType); return; }
      if (resp.isRunning || resp.anyRunning) {
        if (resp.runningTaskName !== lastTaskName) {
          lastTaskName = resp.runningTaskName;
          _refreshPhaseArea(idx, taskType);
        }
        setTimeout(poll, 3000);
      } else {
        _refreshPhaseArea(idx, taskType);
        if (!window.dynamic_updates_cfg?.enabled && typeof copilotRefreshSchema === 'function') copilotRefreshSchema();
      }
    });
  };
  setTimeout(poll, 2000);
}

window.runPhaseTask = function(btn, id, phaseIdx, taskType, force) {
  view_post(_phasesVn, 'run_task', { id, force: !!force }, (resp) => {
    if (resp && resp.unmet_deps && resp.unmet_deps.length > 0) {
      const msg = 'These dependencies are not yet done:\\n\\n  ' + resp.unmet_deps.join('\\n  ') + '\\n\\nRun this task anyway?';
      if (!confirm(msg)) return;
      window.runPhaseTask(btn, id, phaseIdx, taskType, true);
      return;
    }
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    const poll = () => {
      view_post(_phasesVn, 'task_status', { ids: [String(id)] }, (statusResp) => {
        if (statusResp && statusResp.any_done) {
          _refreshPhaseArea(phaseIdx, taskType);
          if (typeof copilotRefreshSchema === 'function') copilotRefreshSchema();
        } else setTimeout(poll, 3000);
      });
    };
    if (!window.dynamic_updates_cfg?.enabled) setTimeout(poll, 3000);
  });
};

window.delPhaseTask = function(id, phaseIdx, taskType) {
  if (!confirm('Delete this task?')) return;
  view_post(_phasesVn, 'del_task', { id }, () => {
    _refreshPhaseArea(phaseIdx, taskType);
  });
};

window.resetPhaseTask = function(id, phaseIdx, taskType) {
  if (!confirm('Reset this task to To do?')) return;
  view_post(_phasesVn, 'reset_task', { id }, () => {
    _refreshPhaseArea(phaseIdx, taskType);
  });
};

window.delAllPhaseTasks = function(idx, taskType) {
  if (!confirm('Delete all tasks in this tab?')) return;
  view_post(_phasesVn, 'del_phase_type_tasks', { idx, task_type: taskType }, () => {
    _refreshPhaseArea(idx, taskType);
  });
};

function phaseTasksPoll(idx, taskType) {
  const poll = () => {
    view_post(_phasesVn, 'phase_tasks_status', { idx, task_type: taskType }, (resp) => {
      if (resp && !resp.generating) {
        _refreshPhaseArea(idx, taskType);
      } else setTimeout(poll, 3000);
    });
  };
  setTimeout(poll, 3000);
}

window.generatePhaseTasks = function(idx, taskType) {
  const areaId = taskType === 'plugin' ? 'phase-plugins-area'
               : taskType === 'data_model' ? 'phase-data-model-area'
               : 'phase-features-area';
  const el = document.getElementById(areaId);
  const hasTasks = el && el.querySelector('[data-task-id]');
  if (hasTasks && !confirm('Regenerate tasks? This will delete all existing tasks in this tab.')) return;
  if (el) el.innerHTML = '<p><i class="fas fa-spinner fa-spin me-2"></i>Generating tasks, please wait...</p>';
  view_post(_phasesVn, 'generate_phase_tasks', { idx, task_type: taskType }, () => {});
  if (!window.dynamic_updates_cfg?.enabled) phaseTasksPoll(idx, taskType);
};

window.copilotPhaseTasksDone = function(idx) {
  _refreshAllAreas(idx);
};

window.copilotRefreshTasks = function() {
  const panel = document.getElementById('phases-panel');
  if (!panel || panel.dataset.phaseIdx === undefined) return;
  const idx = parseInt(panel.dataset.phaseIdx);
  if (!isNaN(idx)) _refreshAllAreas(idx);
};

function copilotInitPhasesState() {
  if (document.getElementById('phases-generating-state')) {
    if (!window.dynamic_updates_cfg?.enabled) phasesStartPoll();
  }
  const phaseParam = new URLSearchParams(location.search).get('phase');
  if (phaseParam !== null) openPhaseDetail(parseInt(phaseParam));
}
(function() {
  if (document.readyState !== 'loading') copilotInitPhasesState();
  else document.addEventListener('DOMContentLoaded', copilotInitPhasesState);
})();
</script>`;

// ── Shared helpers ────────────────────────────────────────────────────────────

const phases_tool = {
  type: "function",
  function: {
    name: "set_phases",
    description:
      "Set the development phases for the application. Each phase groups a set of requirements that belong together and should be built in the same iteration.",
    parameters: {
      type: "object",
      required: ["phases"],
      additionalProperties: false,
      properties: {
        phases: {
          type: "array",
          minItems: 1,
          description: "Ordered list of development phases",
          items: {
            type: "object",
            required: ["name", "description", "requirements"],
            additionalProperties: false,
            properties: {
              name: {
                type: "string",
                description:
                  "Short phase name, e.g. 'Phase 1: Core data entry'",
              },
              description: {
                type: "string",
                description:
                  "1–3 sentences describing what this phase delivers and why it forms a coherent milestone",
              },
              requirements: {
                type: "array",
                description:
                  "The requirements that belong to this phase, in the same format as make_requirements",
                items: {
                  type: "object",
                  required: ["requirement", "priority"],
                  additionalProperties: false,
                  properties: {
                    requirement: {
                      type: "string",
                      description: "A statement of the requirement",
                    },
                    priority: {
                      type: "number",
                      description:
                        "Priority 1-5. 5: Must-have for this phase, 1: Nice-to-have",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const phasesSpinner =
  `<p id="phases-generating-state">` +
  i({ class: "fas fa-spinner fa-spin me-2" }) +
  "Generating phases, please wait...</p>";

const tasksSpinner =
  "<p>" +
  i({ class: "fas fa-spinner fa-spin me-2" }) +
  "Generating tasks, please wait...</p>";

// ── Phase list view ───────────────────────────────────────────────────────────

const phaseCard = (phase, idx, req, allDone, hasFeedback, projectId) => {
  const starFieldview = getState().types.Integer.fieldviews.show_star_rating;
  const reqs = phase.requirements || [];
  const canEdit = features.view_route_modal && !allDone;

  const reqList = reqs.length
    ? ul(
        { class: "list-unstyled mb-0 mt-2" },
        ...reqs.map((r, rIdx) =>
          li(
            { class: "d-flex align-items-start gap-2 mb-2" },
            span(
              { class: "flex-shrink-0" },
              starFieldview.run(r.priority, req, { min: 1, max: 5 })
            ),
            span({ class: "text-muted small flex-grow-1" }, r.requirement),
            canEdit
              ? div(
                  { class: "d-flex gap-1 flex-shrink-0" },
                  button(
                    {
                      type: "button",
                      class: "btn btn-outline-secondary btn-sm",
                      title: "Edit requirement",
                      onclick: `ajax_modal('/view/${encodeURIComponent(
                        viewname
                      )}/get_requirement_form?phaseIdx=${idx}&reqIdx=${rIdx}&project_id=${projectId}', {method:'POST'})`,
                    },
                    i({ class: "fas fa-edit" })
                  ),
                  button(
                    {
                      type: "button",
                      class: "btn btn-outline-danger btn-sm",
                      title: "Delete requirement",
                      onclick: `if(confirm('Delete this requirement?')) view_post(_phasesVn,'delete_requirement',{phaseIdx:${idx},reqIdx:${rIdx}},()=>copilotRefreshPhases())`,
                    },
                    i({ class: "fas fa-times" })
                  )
                )
              : ""
          )
        )
      )
    : "";

  const numberBadge = allDone
    ? span(
        {
          class:
            "badge bg-success rounded-circle d-flex align-items-center justify-content-center fs-6 flex-shrink-0",
          style: "min-width:2rem;height:2rem;",
          title: "All tasks done",
        },
        i({ class: "fas fa-check" })
      )
    : span(
        {
          class:
            "badge bg-primary rounded-circle d-flex align-items-center justify-content-center fs-6 flex-shrink-0",
          style: "min-width:2rem;height:2rem;",
        },
        String(idx + 1)
      );

  return div(
    {
      class: `card mb-3 shadow-sm border-start border-4 ${
        allDone ? "border-success" : "border-primary"
      }`,
    },
    div(
      { class: "card-body" },
      div(
        { class: "d-flex align-items-start gap-3 mb-2" },
        numberBadge,
        div(
          { class: "flex-grow-1" },
          h6({ class: "card-title fw-semibold mb-1" }, phase.name),
          p({ class: "card-text text-muted mb-0 small" }, phase.description)
        ),
        div(
          {
            class:
              "d-flex align-items-center gap-2 flex-shrink-0 align-self-start",
          },
          hasFeedback
            ? i({
                class: "fas fa-comment-alt text-warning",
                title: "This phase has feedback",
                style: "font-size:0.95rem;",
              })
            : "",
          button(
            {
              class: "btn btn-outline-primary btn-sm",
              onclick: `openPhaseDetail(${idx})`,
              title: "Open phase",
            },
            i({ class: "fas fa-arrow-right" })
          )
        )
      ),
      div(
        { class: "border-top pt-2 mt-1" },
        small(
          {
            class: "text-muted text-uppercase fw-semibold d-block mb-2",
            style: "font-size:0.7rem;letter-spacing:.05em;",
          },
          `${reqs.length} requirement${reqs.length !== 1 ? "s" : ""}`
        ),
        reqList,
        canEdit
          ? div(
              { class: "mt-3" },
              button(
                {
                  type: "button",
                  class: "btn btn-outline-primary btn-sm",
                  title: "Add requirement",
                  onclick: `ajax_modal('/view/${encodeURIComponent(
                    viewname
                  )}/get_requirement_form?phaseIdx=${idx}&project_id=${projectId}', {method:'POST'})`,
                },
                i({ class: "fas fa-plus me-1" }),
                "Add requirement"
              )
            )
          : ""
      )
    )
  );
};

const phasesHtml = async (req, pt, projectId) => {
  const generating = await MetaData.findOne({
    type: pt,
    name: "generating_phases",
  });
  if (generating) return phasesSpinner;

  const phasesMd = await MetaData.findOne({
    type: pt,
    name: "phases",
  });

  const generateBtn = (label) =>
    button(
      { class: "btn btn-primary btn-sm", onclick: "copilotGenPhases()" },
      i({ class: "fas fa-magic me-1" }),
      label
    );

  if (!phasesMd || !phasesMd.body?.phases?.length) {
    return (
      p(
        { class: "text-muted" },
        "No phases yet. Generate them from your specification and research answers."
      ) + generateBtn("Generate phases")
    );
  }

  const phases = phasesMd.body.phases;
  const totalReqs = phases.reduce(
    (s, ph) => s + (ph.requirements?.length || 0),
    0
  );

  const allTasks = await MetaData.find({
    type: pt,
    name: "task",
  });
  const pluginMarkers = await MetaData.find({
    type: pt,
    name: "phase_plugin_generated",
  });
  const pluginMarkerIdxs = new Set(pluginMarkers.map((m) => m.body?.phase_idx));

  const phaseAllDone = phases.map((_, idx) => {
    const phaseTasks = allTasks.filter((t) => t.body?.phase_idx === idx);
    const byType = (type) =>
      phaseTasks.filter((t) => (t.body.task_type || "feature") === type);
    const dmTasks = byType("data_model");
    const ftTasks = byType("feature");
    const plTasks = byType("plugin");
    const allDone = (tasks) =>
      tasks.length > 0 && tasks.every((t) => t.body?.status === "Done");
    // plugin: ok if marker says 0 were needed, or if tasks exist and all done
    const pluginOk = pluginMarkerIdxs.has(idx) || allDone(plTasks);
    return allDone(dmTasks) && allDone(ftTasks) && pluginOk;
  });

  const phasesWithFeedback = new Set();
  try {
    const fbMds = await MetaData.find({
      type: pt,
      name: "feedback_pending",
    });
    for (const r of fbMds)
      if (r.body?.phase_idx != null) phasesWithFeedback.add(r.body.phase_idx);
  } catch (_) {}

  return (
    div(
      { class: "d-flex justify-content-between align-items-center mb-3" },
      small(
        { class: "text-muted" },
        `${phases.length} phase${
          phases.length !== 1 ? "s" : ""
        }, ${totalReqs} requirement${totalReqs !== 1 ? "s" : ""}`
      ),
      generateBtn("Regenerate")
    ) +
    phases
      .map((ph, idx) =>
        phaseCard(ph, idx, req, phaseAllDone[idx], phasesWithFeedback.has(idx), projectId)
      )
      .join("") +
    div(
      { class: "mt-3" },
      button(
        {
          class: "btn btn-outline-danger btn-sm",
          onclick: "copilotDelAllPhases()",
        },
        i({ class: "fas fa-trash me-1" }),
        "Delete all phases & tasks"
      )
    )
  );
};

// ── Phase detail: tasks tab ───────────────────────────────────────────────────

const taskStatusBadge = (status) => {
  const cls =
    status === "Done"
      ? "bg-success"
      : status === "Running"
      ? "bg-warning text-dark"
      : "bg-secondary";
  return span({ class: `badge ${cls}` }, status || "To do");
};

const phaseTasksHtml = async (phaseIdx, taskType, pt, projectId) => {
  const generating = await MetaData.findOne({
    type: pt,
    name: "generating_phase_tasks",
  });
  const isGenerating = !!(
    generating &&
    generating.body?.phase_idx === phaseIdx &&
    (!generating.body?.task_type || generating.body?.task_type === taskType)
  );
  if (isGenerating) return tasksSpinner;

  const allTasks = await MetaData.find({
    type: pt,
    name: "task",
  });
  const phaseTasks = allTasks.filter((t) => t.body?.phase_idx === phaseIdx);
  const tasks = phaseTasks.filter(
    (t) => (t.body.task_type || "feature") === taskType
  );
  const doneNames = new Set(
    phaseTasks.filter((t) => t.body.status === "Done").map((t) => t.body.name)
  );

  const phaseRunning = await MetaData.findOne({
    type: pt,
    name: `phase_running_${phaseIdx}_${taskType}`,
  });
  const isRunning = !!phaseRunning;
  const runningTask = tasks.find((t) => t.body.status === "Running");
  const isStopping = !isRunning && !!runningTask;
  const hasTodo = tasks.some(
    (t) => !t.body.status || t.body.status === "To do"
  );

  const allDone = tasks.length > 0 && !hasTodo && !isRunning && !runningTask;

  const staleMarkers = await MetaData.find({
    type: pt,
    name: "phase_reqs_changed",
  });
  const isStale = staleMarkers.some((m) => m.body?.phase_idx === phaseIdx);
  const staleNotice = isStale
    ? div(
        {
          class:
            "alert alert-warning d-flex align-items-center gap-2 py-2 mb-3",
          role: "alert",
        },
        i({ class: "fas fa-exclamation-triangle flex-shrink-0" }),
        span(
          { class: "small flex-grow-1" },
          "The requirements for this phase have changed. " +
            "Consider regenerating the tasks to keep them in sync."
        ),
        button({
          type: "button",
          class: "btn-close btn-sm flex-shrink-0",
          title: "Dismiss",
          onclick:
            `if(confirm('Dismiss this warning? The tasks may still be outdated.'))` +
            ` view_post(_phasesVn,'dismiss_stale_notice',{phaseIdx:${phaseIdx}},` +
            `()=>_refreshPhaseArea(${phaseIdx},${JSON.stringify(taskType)}))`,
        })
      )
    : "";

  const genLabel = tasks.length ? "Regenerate" : "Generate tasks";
  const genOnclick = tasks.length
    ? `if(confirm('Regenerate tasks? This will replace the existing tasks.')) generatePhaseTasks(${phaseIdx},'${taskType}')`
    : `generatePhaseTasks(${phaseIdx},'${taskType}')`;
  const genBtn = button(
    {
      class: `btn btn-primary btn-sm${tasks.length ? " ms-auto" : ""}`,
      onclick: genOnclick,
    },
    i({ class: "fas fa-magic me-1" }),
    genLabel
  );

  const delAllBtn = tasks.length
    ? button(
        {
          class: "btn btn-outline-danger btn-sm",
          onclick: `delAllPhaseTasks(${phaseIdx},'${taskType}')`,
          title: "Delete all tasks",
        },
        i({ class: "fas fa-trash me-1" }),
        "Delete all"
      )
    : "";

  const runBtn = isRunning
    ? button(
        { class: "btn btn-success btn-sm", disabled: true },
        i({ class: "fas fa-spinner fa-spin me-1" }),
        "Running…"
      )
    : isStopping
    ? button(
        { class: "btn btn-warning btn-sm", disabled: true },
        i({ class: "fas fa-spinner fa-spin me-1" }),
        "Stopping…"
      )
    : hasTodo
    ? button(
        {
          class: "btn btn-success btn-sm",
          onclick: `startPhaseTasks(this,${phaseIdx},'${taskType}')`,
        },
        i({ class: "fas fa-play me-1" }),
        "Start running"
      )
    : tasks.length
    ? button(
        { class: "btn btn-success btn-sm", disabled: true },
        i({ class: "fas fa-play me-1" }),
        "Start running"
      )
    : "";

  const stopBtn = isRunning
    ? button(
        {
          class: "btn btn-danger btn-sm",
          onclick: `stopPhaseTasks(${phaseIdx},'${taskType}')`,
        },
        i({ class: "fas fa-stop me-1" }),
        "Stop"
      )
    : "";

  const addTaskBtn = features.view_route_modal
    ? button(
        {
          class: "btn btn-outline-secondary btn-sm",
          title: "Add task",
          onclick: `ajax_modal('/view/${encodeURIComponent(
            viewname
          )}/get_new_task_form?phaseIdx=${phaseIdx}&taskType=${taskType}&project_id=${projectId}', {method:'POST'})`,
        },
        i({ class: "fas fa-plus me-1" }),
        "Add task"
      )
    : "";

  const statusBar = div(
    { class: "d-flex align-items-center gap-2 mb-3 flex-wrap" },
    span(
      {
        id: `phase-run-status-${phaseIdx}-${taskType}`,
        class: "small text-muted me-1",
      },
      isStopping
        ? "Stopping after current task…"
        : runningTask
        ? span(
            "Running: ",
            span({ class: "fw-bold text-body" }, runningTask.body.name)
          )
        : tasks.length
        ? "Not running"
        : ""
    ),
    runBtn,
    stopBtn,
    genBtn,
    addTaskBtn
  );

  const renderTask = (t) => {
    const status = t.body.status || "To do";
    const isRunning = status === "Running";
    const isDone = status === "Done";
    const isTodo = !isDone && !isRunning;

    const deps = t.body.depends_on || [];
    const depsHtml = deps.length
      ? div(
          { class: "d-flex flex-wrap gap-1 mt-2" },
          ...deps.map((dep) =>
            span(
              {
                class: "d-inline-flex align-items-center gap-1 text-muted",
                style: `font-size:0.7rem;background:${
                  doneNames.has(dep)
                    ? "rgba(25,135,84,.18)"
                    : "rgba(220,53,69,.18)"
                };border-radius:4px;padding:1px 5px;`,
              },
              i({
                class: `fas ${
                  doneNames.has(dep)
                    ? "fa-check-circle text-success"
                    : "fa-circle text-danger"
                } `,
                style: "font-size:0.6rem;opacity:0.9",
              }),
              dep
            )
          )
        )
      : "";

    const taskRunBtn = isRunning
      ? span(
          { class: "task-spinner", "data-task-id": t.id },
          i({ class: "fas fa-spinner fa-spin text-warning" })
        )
      : isDone
      ? t.body.run_id
        ? a(
            {
              target: "_blank",
              href: `/view/Saltcorn%20Agent%20copilot?run_id=${t.body.run_id}`,
              class: "btn btn-outline-secondary btn-sm",
              title: "View run",
            },
            i({ class: "fas fa-external-link-alt" })
          )
        : ""
      : button(
          {
            class: "btn btn-outline-success btn-sm",
            "data-task-run": t.id,
            onclick: `runPhaseTask(this,${t.id},${phaseIdx},'${taskType}')`,
            title: "Run task",
          },
          i({ class: "fas fa-play" })
        );

    const editBtn =
      isTodo && features.view_route_modal
        ? button(
            {
              class: "btn btn-outline-primary btn-sm",
              title: "Edit task",
              onclick: `ajax_modal('/view/${encodeURIComponent(
                viewname
              )}/get_task_form?id=${t.id}&project_id=${projectId}', {method:'POST'})`,
            },
            i({ class: "fas fa-edit" })
          )
        : "";

    const resetBtn =
      isRunning || isDone
        ? button(
            {
              class: "btn btn-outline-secondary btn-sm",
              onclick: `resetPhaseTask(${t.id},${phaseIdx},'${taskType}')`,
              title: "Reset to To do",
            },
            i({ class: "fas fa-undo" })
          )
        : "";

    const deleteBtn = button(
      {
        class: "btn btn-outline-danger btn-sm",
        onclick: `delPhaseTask(${t.id},${phaseIdx},'${taskType}')`,
        title: "Delete",
      },
      i({ class: "fas fa-trash-alt" })
    );

    return div(
      { class: "card mb-2 shadow-sm" },
      div(
        { class: "card-body py-2" },
        div(
          { class: "d-flex align-items-start gap-2" },
          div(
            { class: "flex-grow-1" },
            div(
              { class: "d-flex align-items-center flex-wrap gap-1 mb-1" },
              span({ class: "fw-semibold small me-1" }, t.body.name),
              taskStatusBadge(status),
              span(
                { class: "badge bg-secondary", title: "Priority" },
                String(t.body.priority ?? "?")
              )
            ),
            p({ class: "text-muted small mb-0" }, t.body.description),
            depsHtml
          ),
          div(
            { class: "d-flex gap-1 flex-shrink-0 ms-2" },
            taskRunBtn,
            editBtn,
            resetBtn,
            deleteBtn
          )
        )
      )
    );
  };

  const plannedTasks = tasks.filter((t) => t.body.source !== "feedback");
  const feedbackTasks = tasks.filter((t) => t.body.source === "feedback");

  if (!tasks.length) {
    let emptyMsg = "No tasks yet.";
    if (taskType === "plugin") {
      const markers = await MetaData.find({
        type: pt,
        name: "phase_plugin_generated",
      });
      if (markers.some((m) => m.body?.phase_idx === phaseIdx))
        emptyMsg = "No plugin installations needed for this phase.";
    } else if (taskType === "data_model") {
      const markers = await MetaData.find({
        type: pt,
        name: "phase_data_model_generated",
      });
      if (markers.some((m) => m.body?.phase_idx === phaseIdx))
        emptyMsg = "No schema changes needed for this phase.";
    }
    return (
      staleNotice + statusBar + p({ class: "text-muted small mt-2" }, emptyMsg)
    );
  }

  const feedbackSection = feedbackTasks.length
    ? div(
        { class: "mt-4" },
        div(
          { class: "d-flex align-items-center gap-2 mb-2" },
          small(
            {
              class: "text-uppercase fw-semibold text-muted",
              style: "font-size:0.7rem;letter-spacing:.05em;",
            },
            i({ class: "fas fa-comment-alt me-1" }),
            "From feedback"
          ),
          div({ class: "flex-grow-1 border-top" })
        ),
        feedbackTasks.map(renderTask).join("")
      )
    : "";

  return (
    staleNotice +
    statusBar +
    plannedTasks.map(renderTask).join("") +
    feedbackSection +
    div({ class: "mt-3" }, delAllBtn)
  );
};

// ── Phase detail view ─────────────────────────────────────────────────────────

const PROGRESS_PAGE_SIZE = 20;

const phaseProgressHtml = async (idx, page = 1, pt) => {
  const allTasks = await MetaData.find({
    type: pt,
    name: "task",
  });
  const taskNameById = Object.fromEntries(
    allTasks.map((t) => [t.id, t.body.name])
  );

  const allProgress = await MetaData.find(
    { type: pt, name: "progress" },
    { orderBy: "written_at", orderDesc: true }
  );
  const entries = allProgress.filter((p) => p.body?.phase_idx === idx);

  if (!entries.length)
    return p({ class: "text-muted mt-2" }, "No completed tasks yet.");

  const totalPages = Math.ceil(entries.length / PROGRESS_PAGE_SIZE);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageEntries = entries.slice(
    (currentPage - 1) * PROGRESS_PAGE_SIZE,
    currentPage * PROGRESS_PAGE_SIZE
  );

  const pagination =
    totalPages > 1
      ? `<nav class="mt-2"><ul class="pagination pagination-sm mb-0">` +
        `<li class="page-item${
          currentPage === 1 ? " disabled" : ""
        }"><a class="page-link" href="#" onclick="event.preventDefault();copilotProgressGoPage(${idx},${
          currentPage - 1
        })">&#8249;</a></li>` +
        Array.from({ length: totalPages }, (_, i) => i + 1)
          .map(
            (pg) =>
              `<li class="page-item${
                pg === currentPage ? " active" : ""
              }"><a class="page-link" href="#" onclick="event.preventDefault();copilotProgressGoPage(${idx},${pg})">${pg}</a></li>`
          )
          .join("") +
        `<li class="page-item${
          currentPage === totalPages ? " disabled" : ""
        }"><a class="page-link" href="#" onclick="event.preventDefault();copilotProgressGoPage(${idx},${
          currentPage + 1
        })">&#8250;</a></li>` +
        `</ul></nav>`
      : "";

  return (
    mkTable(
      [
        {
          label: "When",
          key: (m) => {
            const d = m.written_at ? new Date(m.written_at) : null;
            if (!d) return "";
            return small(
              { class: "text-muted", style: "white-space:nowrap" },
              d.toLocaleDateString([], { month: "short", day: "numeric" }),
              " ",
              d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            );
          },
        },
        {
          label: "Task",
          key: (m) =>
            small(
              { class: "text-muted", style: "white-space:nowrap" },
              taskNameById[m.body?.task_id] || ""
            ),
        },
        {
          label: "Summary",
          key: (m) =>
            div(
              {
                style:
                  "white-space:pre-wrap;font-size:0.82rem;max-width:520px;",
              },
              m.body.text || ""
            ),
        },
      ],
      pageEntries
    ) +
    pagination +
    button(
      {
        class: "btn btn-outline-danger btn-sm mt-2",
        onclick: `view_post(${JSON.stringify(
          viewname
        )}, 'del_phase_progress', {idx:${idx}}, () => copilotRefreshPhaseProgress(${idx}))`,
      },
      "Delete all"
    )
  );
};

const phaseDetailHtml = async (phase, idx, pt, projectId) => {
  const tabId = `phase-detail-tabs-${idx}`;
  const [plContent, dmContent, ftContent, pgContent] = await Promise.all([
    phaseTasksHtml(idx, "plugin", pt, projectId),
    phaseTasksHtml(idx, "data_model", pt, projectId),
    phaseTasksHtml(idx, "feature", pt, projectId),
    phaseProgressHtml(idx, 1, pt),
  ]);

  const backBtn = button(
    {
      class: "btn btn-sm btn-outline-secondary mb-3",
      onclick: "copilotRefreshPhases()",
    },
    i({ class: "fas fa-arrow-left me-1" }),
    "Back to phases"
  );

  const feedbackBtn = features.view_route_modal
    ? button(
        {
          class: "btn btn-outline-secondary btn-sm flex-shrink-0 ms-4",
          onclick: `ajax_modal('/view/${encodeURIComponent(
            viewname
          )}/get_feedback_form?scope=phase_${idx}&project_id=${projectId}', {method:'POST'})`,
          title: "Add feedback for this phase",
        },
        i({ class: "fas fa-comment-alt me-1" }),
        "Feedback"
      )
    : "";

  const header = div(
    { class: "d-flex align-items-start gap-3 mb-2" },
    span(
      {
        class:
          "badge bg-primary rounded-circle d-flex align-items-center justify-content-center fs-6 flex-shrink-0",
        style: "min-width:2rem;height:2rem;",
      },
      String(idx + 1)
    ),
    div(
      { class: "flex-grow-1" },
      h6({ class: "fw-semibold mb-1" }, phase.name),
      p({ class: "text-muted small mb-0" }, phase.description)
    ),
    feedbackBtn
  );

  const tabs = `
<ul class="nav nav-tabs" id="${tabId}" role="tablist">
  <li class="nav-item" role="presentation">
    <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#${tabId}-pl" type="button">Plugins</button>
  </li>
  <li class="nav-item" role="presentation">
    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#${tabId}-dm" type="button">Data model</button>
  </li>
  <li class="nav-item" role="presentation">
    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#${tabId}-ft" type="button">Features</button>
  </li>
  <li class="nav-item" role="presentation">
    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#${tabId}-pg" type="button">Progress</button>
  </li>
</ul>
<div class="tab-content pt-3">
  <div class="tab-pane fade show active" id="${tabId}-pl">
    <div id="phase-plugins-area">${plContent}</div>
  </div>
  <div class="tab-pane fade" id="${tabId}-dm">
    <div id="phase-data-model-area">${dmContent}</div>
  </div>
  <div class="tab-pane fade" id="${tabId}-ft">
    <div id="phase-features-area">${ftContent}</div>
  </div>
  <div class="tab-pane fade" id="${tabId}-pg">
    <div id="phase-progress-area-${idx}">${pgContent}</div>
  </div>
</div>`;

  return backBtn + header + tabs;
};

// ── Panel wrapper (rendered on page load) ─────────────────────────────────────

const phasesPanel = async (req, pt, projectId) => {
  const innerHtml = await phasesHtml(req, pt, projectId);
  return div({ class: "mt-2" }, div({ id: "phases-panel" }, innerHtml));
};

// ── Phase generation ──────────────────────────────────────────────────────────

const deletePhaseScopedFeedback = async (pt) => {
  for (const name of ["feedback_pending", "feedback"]) {
    const records = await MetaData.find({ type: pt, name });
    for (const r of records.filter((r) => r.body?.phase_idx != null)) {
      const research = await MetaData.findOne({
        type: pt,
        name: `feedback_research_${r.id}`,
      });
      if (research) await research.delete();
      await r.delete();
    }
  }
};

const doGenPhases = async (userId, pt) => {
  const generatingMd = await MetaData.create({
    type: pt,
    name: "generating_phases",
    body: {},
    user_id: userId,
  });
  try {
    const generator = await PromptGenerator.createInstance({ pt });
    if (!generator.spec) throw new Error("Specification not found");
    const answer = await getState().functions.llm_generate.run(
      generator.phasesPlanPrompt(),
      {
        tools: [phases_tool],
        ...tool_choice("set_phases"),
        systemPrompt:
          "You are a senior software architect and project manager. " +
          "Break the application into logical delivery phases, each containing the requirements that belong to that phase. " +
          "Only include what is explicitly stated in the specification — do not infer or add plausible extras.",
      }
    );

    const tc = answer.getToolCalls()[0];

    // Delete all phase tasks and phase-scoped feedback before replacing phases
    // (phase indices will shift, making both stale)
    const allTasks = await MetaData.find({
      type: pt,
      name: "task",
    });
    for (const t of allTasks.filter((t) => t.body?.phase_idx !== undefined))
      await t.delete();
    await deletePhaseScopedFeedback(pt);

    const existing = await MetaData.findOne({
      type: pt,
      name: "phases",
    });
    if (existing) {
      await existing.update({ body: { phases: tc.input.phases } });
    } else {
      await MetaData.create({
        type: pt,
        name: "phases",
        body: { phases: tc.input.phases },
        user_id: userId,
      });
    }
  } finally {
    await generatingMd.delete();
    try {
      getState().emitDynamicUpdate(db.getTenantSchema(), {
        eval_js:
          "if(typeof copilotRefreshPhases==='function')copilotRefreshPhases();",
      });
    } catch (_) {}
  }
};

// ── Task generation for a phase ───────────────────────────────────────────────

// taskType: "data_model" | "feature" | null (null = generate both)
const doGenPhaseTasks = async (phase, userId, taskType, pt) => {
  const generatingMd = await MetaData.create({
    type: pt,
    name: "generating_phase_tasks",
    body: { phase_idx: phase.idx, task_type: taskType },
    user_id: userId,
  });
  try {
    const generator = await PromptGenerator.createInstance({ phase, pt });
    const answer = await getState().functions.llm_generate.run(
      generator.taskPlanPrompt(taskType),
      {
        tools: [task_tool],
        ...tool_choice("plan_tasks"),
        systemPrompt:
          "You are a project manager planning implementation tasks for a Saltcorn application. " +
          "Each task must map to a concrete deliverable (a view, page, trigger, or schema change). " +
          "Keep tasks small and focused.",
      }
    );

    const tc = answer.getToolCalls()[0];

    // Remove existing tasks of the relevant type(s) before storing new ones
    const existing = await MetaData.find({
      type: pt,
      name: "task",
    });
    const phaseTasks = existing.filter((t) => t.body?.phase_idx === phase.idx);
    for (const t of phaseTasks) {
      const tType = t.body.task_type || "feature";
      if (tType === taskType) await t.delete();
    }

    // Clear any existing "no tasks needed" markers for this phase
    if (taskType === "plugin") {
      const oldMarkers = await MetaData.find({
        type: pt,
        name: "phase_plugin_generated",
      });
      for (const m of oldMarkers.filter((m) => m.body?.phase_idx === phase.idx))
        await m.delete();
    } else if (taskType === "data_model") {
      const oldMarkers = await MetaData.find({
        type: pt,
        name: "phase_data_model_generated",
      });
      for (const m of oldMarkers.filter((m) => m.body?.phase_idx === phase.idx))
        await m.delete();
    }

    const projectId = Number(pt.split(":")[1]);
    for (const task of tc.input.tasks)
      await MetaData.create({
        type: pt,
        name: "task",
        body: { ...task, phase_idx: phase.idx, phase_name: phase.name, project_id: projectId },
        user_id: userId,
      });

    await clearPhaseStaleMarker(phase.idx, pt);

    // If generation produced 0 tasks, record that it was considered
    if (
      taskType === "plugin" &&
      tc.input.tasks.filter((t) => t.task_type === "plugin").length === 0
    ) {
      await MetaData.create({
        type: pt,
        name: "phase_plugin_generated",
        body: { phase_idx: phase.idx },
        user_id: userId,
      });
    }
    if (
      taskType === "data_model" &&
      tc.input.tasks.filter((t) => t.task_type === "data_model").length === 0
    ) {
      await MetaData.create({
        type: pt,
        name: "phase_data_model_generated",
        body: { phase_idx: phase.idx },
        user_id: userId,
      });
    }
  } finally {
    await generatingMd.delete();
    try {
      getState().emitDynamicUpdate(db.getTenantSchema(), {
        eval_js: `if(typeof copilotPhaseTasksDone==='function')copilotPhaseTasksDone(${phase.idx});`,
      });
    } catch (_) {}
  }
};

// ── Phase task chain runner ───────────────────────────────────────────────────

const doRunPhaseTasks = async (phaseIdx, taskType, req, pt) => {
  const flagName = `phase_running_${phaseIdx}_${taskType}`;
  const running = await MetaData.findOne({
    type: pt,
    name: flagName,
  });
  if (!running) return;

  const allTasks = await MetaData.find({
    type: pt,
    name: "task",
  });
  const phaseTasks = allTasks.filter((t) => t.body?.phase_idx === phaseIdx);
  const typedTasks = phaseTasks.filter(
    (t) => (t.body.task_type || "feature") === taskType
  );

  if (typedTasks.some((t) => t.body.status === "Running")) return;

  const doneNames = new Set(
    phaseTasks.filter((t) => t.body.status === "Done").map((t) => t.body.name)
  );
  // Only block on same-type dependencies; cross-type deps are the user's ordering concern
  const sameTypeNames = new Set(
    typedTasks.map((t) => t.body.name).filter(Boolean)
  );
  const todos = typedTasks.filter(
    (t) => !t.body.status || t.body.status === "To do"
  );
  const startable = todos.filter((t) =>
    (t.body.depends_on || []).every(
      (nm) => doneNames.has(nm) || !sameTypeNames.has(nm)
    )
  );

  if (startable[0]) {
    await runTask(startable[0].id, req);
    await doRunPhaseTasks(phaseIdx, taskType, req, pt);
  } else {
    const runningMd = await MetaData.findOne({
      type: pt,
      name: flagName,
    });
    if (runningMd) await runningMd.delete();
    try {
      getState().emitDynamicUpdate(db.getTenantSchema(), {
        eval_js: `if(typeof copilotPhaseTasksDone==='function')copilotPhaseTasksDone(${phaseIdx});`,
      });
    } catch (_) {}
  }
};

// ── Routes ────────────────────────────────────────────────────────────────────

const getPt = (body, req) =>
  projectType(body.project_id ?? req.query?.project_id);

const gen_phases = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  doGenPhases(req.user?.id, pt).catch((e) =>
    console.error("gen_phases error", e)
  );
  return { json: { success: true } };
};

const phases_status = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const generating = await MetaData.findOne({
    type: pt,
    name: "generating_phases",
  });
  return { json: { generating: !!generating } };
};

const phases_html = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const projectId = body.project_id ?? req.query?.project_id;
  const html = await phasesHtml(req, pt, projectId);
  return { json: { html } };
};

const phase_detail_html = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const projectId = body.project_id ?? req.query?.project_id;
  const idx = parseInt(body.idx);
  const phasesMd = await MetaData.findOne({
    type: pt,
    name: "phases",
  });
  const phase = phasesMd?.body?.phases?.[idx];
  if (!phase) return { json: { error: "Phase not found" } };
  return { json: { html: await phaseDetailHtml(phase, idx, pt, projectId) } };
};

const generate_phase_tasks = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  const taskType = body.task_type || null;
  const phasesMd = await MetaData.findOne({
    type: pt,
    name: "phases",
  });
  const phase = phasesMd?.body?.phases?.[idx];
  if (!phase) return { json: { error: "Phase not found" } };
  phase.idx = idx;
  doGenPhaseTasks(phase, req.user?.id, taskType, pt).catch((e) =>
    console.error("generate_phase_tasks error", e)
  );
  return { json: { success: true } };
};

const phase_tasks_status = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  const taskType = body.task_type || null;
  const generating = await MetaData.findOne({
    type: pt,
    name: "generating_phase_tasks",
  });
  const isGenerating = !!(
    generating &&
    generating.body?.phase_idx === idx &&
    (!taskType ||
      !generating.body?.task_type ||
      generating.body?.task_type === taskType)
  );
  return { json: { generating: isGenerating } };
};

const phase_tasks_html = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const projectId = body.project_id ?? req.query?.project_id;
  const idx = parseInt(body.idx);
  const taskType = body.task_type || "feature";
  const html = await phaseTasksHtml(idx, taskType, pt, projectId);
  return { json: { html } };
};

const run_phase_tasks = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  const taskType = body.task_type || "feature";
  const flagName = `phase_running_${idx}_${taskType}`;
  const existing = await MetaData.findOne({
    type: pt,
    name: flagName,
  });
  if (!existing)
    await MetaData.create({
      type: pt,
      name: flagName,
      body: { started: Date.now() },
      user_id: req.user?.id,
    });
  doRunPhaseTasks(idx, taskType, {
    user: req.user,
    __: req.__ || ((s) => s),
    getLocale: req.getLocale || (() => "en"),
  }, pt).catch((e) => console.error("run_phase_tasks error", e));
  return { json: { success: true } };
};

const stop_phase_tasks = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  const taskType = body.task_type || "feature";
  const running = await MetaData.findOne({
    type: pt,
    name: `phase_running_${idx}_${taskType}`,
  });
  if (running) await running.delete();
  const allTasks = await MetaData.find({
    type: pt,
    name: "task",
  });
  const taskStillRunning = allTasks.some(
    (t) =>
      t.body?.phase_idx === idx &&
      (t.body?.task_type || "feature") === taskType &&
      t.body?.status === "Running"
  );
  return { json: { success: true, taskStillRunning } };
};

const del_phase_type_tasks = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  const taskType = body.task_type || "feature";
  const allTasks = await MetaData.find({
    type: pt,
    name: "task",
  });
  for (const t of allTasks) {
    if (
      t.body?.phase_idx === idx &&
      (t.body?.task_type || "feature") === taskType
    )
      await t.delete();
  }
  if (taskType === "plugin") {
    const markers = await MetaData.find({
      type: pt,
      name: "phase_plugin_generated",
    });
    for (const m of markers.filter((m) => m.body?.phase_idx === idx))
      await m.delete();
    const pluginPhase = await MetaData.find({
      type: pt,
      name: "plugin_phase",
    });
    for (const m of pluginPhase.filter((m) => m.body?.phase_idx === idx))
      await m.delete();
  }
  if (taskType === "data_model") {
    const tablePhase = await MetaData.find({
      type: pt,
      name: "table_phase",
    });
    for (const m of tablePhase.filter((m) => m.body?.phase_idx === idx))
      await m.delete();
    const dmMarkers = await MetaData.find({
      type: pt,
      name: "phase_data_model_generated",
    });
    for (const m of dmMarkers.filter((m) => m.body?.phase_idx === idx))
      await m.delete();
  }
  if (taskType === "feature") {
    const viewPhase = await MetaData.find({
      type: pt,
      name: "view_phase",
    });
    for (const m of viewPhase.filter((m) => m.body?.phase_idx === idx))
      await m.delete();
  }
  return { json: { success: true } };
};

const phase_run_status = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  const taskType = body.task_type || "feature";
  const runningMd = await MetaData.findOne({
    type: pt,
    name: `phase_running_${idx}_${taskType}`,
  });
  const isRunning = !!runningMd;
  const allTasks = await MetaData.find({
    type: pt,
    name: "task",
  });
  const runningTask = allTasks.find(
    (t) =>
      t.body?.phase_idx === idx &&
      (t.body?.task_type || "feature") === taskType &&
      t.body?.status === "Running"
  );
  const anyRunning = !!runningTask;
  return {
    json: {
      isRunning,
      anyRunning,
      runningTaskName: runningTask?.body?.name || null,
    },
  };
};

const del_all_phases = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const allTasks = await MetaData.find({
    type: pt,
    name: "task",
  });
  for (const t of allTasks.filter((t) => t.body?.phase_idx !== undefined))
    await t.delete();
  await deletePhaseScopedFeedback(pt);
  const markers = await MetaData.find({
    type: pt,
    name: "phase_plugin_generated",
  });
  for (const m of markers) await m.delete();
  const tablePhase = await MetaData.find({
    type: pt,
    name: "table_phase",
  });
  for (const m of tablePhase) await m.delete();
  const viewPhase = await MetaData.find({
    type: pt,
    name: "view_phase",
  });
  for (const m of viewPhase) await m.delete();
  const pluginPhaseAll = await MetaData.find({
    type: pt,
    name: "plugin_phase",
  });
  for (const m of pluginPhaseAll) await m.delete();
  const phasesMd = await MetaData.findOne({
    type: pt,
    name: "phases",
  });
  if (phasesMd) await phasesMd.delete();
  return { json: { success: true } };
};

const phase_progress_html = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  const page = body.page ? parseInt(body.page) : 1;
  const html = await phaseProgressHtml(idx, page, pt);
  return { json: { html } };
};

const del_phase_progress = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  const all = await MetaData.find({
    type: pt,
    name: "progress",
  });
  for (const r of all.filter((p) => p.body?.phase_idx === idx))
    await r.delete();
  return { json: { success: true } };
};

const get_requirement_form = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const phaseIdx = parseInt(body.phaseIdx ?? req.query?.phaseIdx);
  const reqIdx =
    body.reqIdx !== undefined
      ? parseInt(body.reqIdx)
      : req.query?.reqIdx !== undefined
      ? parseInt(req.query.reqIdx)
      : -1;

  const phasesMd = await MetaData.findOne({
    type: pt,
    name: "phases",
  });
  const phase = phasesMd?.body?.phases?.[phaseIdx];
  if (!phase) return { json: { error: "Phase not found" } };

  const existing = reqIdx >= 0 ? (phase.requirements || [])[reqIdx] : null;

  const prioritySelect = select(
    { id: "req-form-priority", class: "form-select" },
    ...[1, 2, 3, 4, 5].map((n) =>
      option(
        {
          value: n,
          ...(n === (existing?.priority ?? 3) ? { selected: true } : {}),
        },
        String(n)
      )
    )
  );

  const html =
    div(
      { class: "mb-3" },
      label(
        { class: "form-label fw-semibold", for: "req-form-text" },
        "Requirement"
      ),
      textarea(
        { id: "req-form-text", class: "form-control", rows: 4 },
        existing?.requirement || ""
      )
    ) +
    div(
      { class: "mb-4" },
      label(
        { class: "form-label fw-semibold", for: "req-form-priority" },
        "Priority (1–5)"
      ),
      prioritySelect
    ) +
    div(
      { class: "d-flex gap-2" },
      button(
        {
          type: "button",
          class: "btn btn-primary",
          onclick: `view_post(${JSON.stringify(vn)}, 'save_requirement', {
  phaseIdx: ${phaseIdx},
  reqIdx: ${reqIdx},
  requirement: document.getElementById('req-form-text').value,
  priority: parseInt(document.getElementById('req-form-priority').value)
}, () => {
  $('#scmodal').modal('hide');
  if (typeof copilotRefreshPhases === 'function') copilotRefreshPhases();
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

  const title = existing
    ? "Edit requirement"
    : `Add requirement — Phase ${phaseIdx + 1}`;
  return { html, title };
};

const markPhaseTasksStale = async (phaseIdx, userId, pt) => {
  const all = await MetaData.find({
    type: pt,
    name: "phase_reqs_changed",
  });
  if (!all.some((m) => m.body?.phase_idx === phaseIdx)) {
    await MetaData.create({
      type: pt,
      name: "phase_reqs_changed",
      body: { phase_idx: phaseIdx },
      user_id: userId,
    });
  }
};

const clearPhaseStaleMarker = async (phaseIdx, pt) => {
  const all = await MetaData.find({
    type: pt,
    name: "phase_reqs_changed",
  });
  for (const m of all.filter((m) => m.body?.phase_idx === phaseIdx))
    await m.delete();
};

const save_requirement = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const phaseIdx = parseInt(body.phaseIdx);
  const reqIdx = parseInt(body.reqIdx);
  const { requirement, priority } = body;

  const phasesMd = await MetaData.findOne({
    type: pt,
    name: "phases",
  });
  if (!phasesMd) return { json: { error: "Phases not found" } };

  const phases = phasesMd.body.phases || [];
  if (!phases[phaseIdx]) return { json: { error: "Phase not found" } };

  const reqs = phases[phaseIdx].requirements || [];
  if (reqIdx >= 0 && reqIdx < reqs.length) {
    reqs[reqIdx] = { requirement, priority: parseInt(priority) };
  } else {
    reqs.push({ requirement, priority: parseInt(priority) });
  }
  phases[phaseIdx].requirements = reqs;
  await phasesMd.update({ body: { ...phasesMd.body, phases } });

  const hasTasks = (
    await MetaData.find({ type: pt, name: "task" })
  ).some((t) => t.body?.phase_idx === phaseIdx);
  if (hasTasks) await markPhaseTasksStale(phaseIdx, req.user?.id, pt);

  return { json: { success: true } };
};

const delete_requirement = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const phaseIdx = parseInt(body.phaseIdx);
  const reqIdx = parseInt(body.reqIdx);

  const phasesMd = await MetaData.findOne({
    type: pt,
    name: "phases",
  });
  if (!phasesMd) return { json: { error: "Phases not found" } };

  const phases = phasesMd.body.phases || [];
  if (!phases[phaseIdx]) return { json: { error: "Phase not found" } };

  const reqs = phases[phaseIdx].requirements || [];
  reqs.splice(reqIdx, 1);
  phases[phaseIdx].requirements = reqs;
  await phasesMd.update({ body: { ...phasesMd.body, phases } });

  const hasTasks = (
    await MetaData.find({ type: pt, name: "task" })
  ).some((t) => t.body?.phase_idx === phaseIdx);
  if (hasTasks) await markPhaseTasksStale(phaseIdx, req.user?.id, pt);

  return { json: { success: true } };
};

const dismiss_stale_notice = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  await clearPhaseStaleMarker(parseInt(body.phaseIdx), pt);
  return { json: { success: true } };
};

const phase_routes = {
  gen_phases,
  phases_status,
  phases_html,
  phase_detail_html,
  generate_phase_tasks,
  phase_tasks_status,
  phase_tasks_html,
  run_phase_tasks,
  stop_phase_tasks,
  phase_run_status,
  del_phase_type_tasks,
  del_all_phases,
  phase_progress_html,
  del_phase_progress,
  get_requirement_form,
  save_requirement,
  delete_requirement,
  dismiss_stale_notice,
};

module.exports = { phasesPanel, phasesStaticScript, phase_routes };
