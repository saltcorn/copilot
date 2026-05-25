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
} = require("@saltcorn/markup/tags");
const { getState, features } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const { viewname, tool_choice } = require("./common");
const { getResearchAnswersText } = require("./research");
const {
  research_answers_section,
  existing_tables_list,
  existing_entities_list,
  task_planning_rules,
  task_planning_closing,
} = require("./prompts");
const { task_tool } = require("./tools");
const { runTask } = require("./run_task");

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

window.openPhaseDetail = function(idx) {
  _setPhaseParam(idx);
  view_post(_phasesVn, 'phase_detail_html', { idx }, (r) => {
    if (r && r.html) {
      const panel = document.getElementById('phases-panel');
      panel.innerHTML = r.html;
      panel.dataset.phaseIdx = idx;

      for (const tt of ['plugin', 'data_model', 'feature']) {
        view_post(_phasesVn, 'phase_tasks_status', { idx, task_type: tt }, (resp) => {
          if (resp && resp.generating) phaseTasksPoll(idx, tt);
        });
        view_post(_phasesVn, 'phase_run_status', { idx, task_type: tt }, (resp) => {
          if (resp && (resp.isRunning || resp.anyRunning)) phasePollRunning(idx, tt);
        });
      }
    }
  });
};

window.startPhaseTasks = function(btn, idx, taskType) {
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Running…';
  view_post(_phasesVn, 'run_phase_tasks', { idx, task_type: taskType }, () => {});
  // Always poll — dynamic updates only fire on task completion, not on task start,
  // so the poll is the only way to show intermediate running state and the Stop button.
  phasePollRunning(idx, taskType);
};

window.stopPhaseTasks = function(idx, taskType) {
  view_post(_phasesVn, 'stop_phase_tasks', { idx, task_type: taskType }, (resp) => {
    if (resp && resp.taskStillRunning) {
      // Give immediate feedback before the poll re-renders the area
      const statusEl = document.getElementById('phase-run-status-' + idx + '-' + taskType);
      if (statusEl) statusEl.textContent = 'Stopping after current task…';
      phasePollRunning(idx, taskType);
    } else {
      _refreshPhaseArea(idx, taskType);
    }
  });
};

function phasePollRunning(idx, taskType) {
  const poll = () => {
    view_post(_phasesVn, 'phase_run_status', { idx, task_type: taskType }, (resp) => {
      if (!resp) return;
      if (resp.isRunning || resp.anyRunning) {
        _refreshPhaseArea(idx, taskType);
        setTimeout(poll, 3000);
      } else {
        _refreshPhaseArea(idx, taskType);
        if (typeof copilotRefreshSchema === 'function') copilotRefreshSchema();
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
  if (!window.dynamic_updates_cfg?.enabled) setTimeout(poll, 3000);
}

window.generatePhaseTasks = function(idx, taskType) {
  const areaId = taskType === 'plugin' ? 'phase-plugins-area'
               : taskType === 'data_model' ? 'phase-data-model-area'
               : 'phase-features-area';
  const el = document.getElementById(areaId);
  if (el) el.innerHTML = '<p><i class="fas fa-spinner fa-spin me-2"></i>Generating tasks, please wait...</p>';
  view_post(_phasesVn, 'generate_phase_tasks', { idx, task_type: taskType }, () => {});
  phaseTasksPoll(idx, taskType);
};

window.copilotPhaseTasksDone = function(idx) {
  _refreshAllAreas(idx);
};

const _phasesOrigRefreshTasks = window.copilotRefreshTasks;
window.copilotRefreshTasks = function() {
  if (typeof _phasesOrigRefreshTasks === 'function') _phasesOrigRefreshTasks();
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

const phaseCard = (phase, idx, req) => {
  const starFieldview = getState().types.Integer.fieldviews.show_star_rating;
  const reqs = phase.requirements || [];
  const reqList = reqs.length
    ? ul(
        { class: "list-unstyled mb-0 mt-2" },
        ...reqs.map((r) =>
          li(
            { class: "d-flex align-items-start gap-2 mb-2" },
            span(
              { class: "flex-shrink-0" },
              starFieldview.run(r.priority, req, { min: 1, max: 5 })
            ),
            span({ class: "text-muted small" }, r.requirement)
          )
        )
      )
    : "";

  return div(
    { class: "card mb-3 shadow-sm border-start border-4 border-primary" },
    div(
      { class: "card-body" },
      div(
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
          h6({ class: "card-title fw-semibold mb-1" }, phase.name),
          p({ class: "card-text text-muted mb-0 small" }, phase.description)
        ),
        button(
          {
            class:
              "btn btn-outline-primary btn-sm flex-shrink-0 align-self-start",
            onclick: `openPhaseDetail(${idx})`,
            title: "Open phase",
          },
          i({ class: "fas fa-arrow-right" })
        )
      ),
      reqs.length
        ? div(
            { class: "border-top pt-2 mt-1" },
            small(
              {
                class: "text-muted text-uppercase fw-semibold d-block mb-2",
                style: "font-size:0.7rem;letter-spacing:.05em;",
              },
              `${reqs.length} requirement${reqs.length !== 1 ? "s" : ""}`
            ),
            reqList
          )
        : ""
    )
  );
};

const phasesHtml = async (req) => {
  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_phases",
  });
  if (generating) return phasesSpinner;

  const phasesMd = await MetaData.findOne({
    type: "CopilotConstructMgr",
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
    phases.map((ph, idx) => phaseCard(ph, idx, req)).join("") +
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

const phaseTasksHtml = async (phaseIdx, taskType) => {
  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_phase_tasks",
  });
  const isGenerating = !!(
    generating &&
    generating.body?.phase_idx === phaseIdx &&
    (!generating.body?.task_type || generating.body?.task_type === taskType)
  );
  if (isGenerating) return tasksSpinner;

  const allTasks = await MetaData.find({
    type: "CopilotConstructMgr",
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
    type: "CopilotConstructMgr",
    name: `phase_running_${phaseIdx}_${taskType}`,
  });
  const isRunning = !!phaseRunning;
  const runningTask = tasks.find((t) => t.body.status === "Running");
  const isStopping = !isRunning && !!runningTask;
  const hasTodo = tasks.some(
    (t) => !t.body.status || t.body.status === "To do"
  );

  const allDone = tasks.length > 0 && !hasTodo && !isRunning && !runningTask;

  const genLabel = tasks.length ? "Regenerate" : "Generate tasks";
  const genBtn = button(
    {
      class: `btn btn-primary btn-sm${tasks.length ? " ms-auto" : ""}`,
      onclick: `generatePhaseTasks(${phaseIdx},'${taskType}')`,
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
    genBtn
  );

  if (!tasks.length) {
    let emptyMsg = "No tasks yet.";
    if (taskType === "plugin") {
      const markers = await MetaData.find({
        type: "CopilotConstructMgr",
        name: "phase_plugin_generated",
      });
      if (markers.some((m) => m.body?.phase_idx === phaseIdx))
        emptyMsg = "No plugin installations needed for this phase.";
    }
    return statusBar + p({ class: "text-muted small mt-2" }, emptyMsg);
  }

  return (
    statusBar +
    tasks
      .map((t) => {
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

        const runBtn = isRunning
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
                  title: "Edit description",
                  onclick: `ajax_modal('/view/${encodeURIComponent(
                    viewname
                  )}/edit_task_desc?id=${t.id}', {method:'POST'})`,
                },
                i({ class: "fas fa-edit" })
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
                runBtn,
                editBtn,
                deleteBtn
              )
            )
          )
        );
      })
      .join("") +
    div({ class: "mt-3" }, delAllBtn)
  );
};

// ── Phase detail view ─────────────────────────────────────────────────────────

const phaseDetailHtml = async (phase, idx) => {
  const tabId = `phase-detail-tabs-${idx}`;
  const [plContent, dmContent, ftContent] = await Promise.all([
    phaseTasksHtml(idx, "plugin"),
    phaseTasksHtml(idx, "data_model"),
    phaseTasksHtml(idx, "feature"),
  ]);

  const backBtn = button(
    {
      class: "btn btn-sm btn-outline-secondary mb-3",
      onclick: "copilotRefreshPhases()",
    },
    i({ class: "fas fa-arrow-left me-1" }),
    "Back to phases"
  );

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
      h6({ class: "fw-semibold mb-1" }, phase.name),
      p({ class: "text-muted small mb-0" }, phase.description)
    )
  );

  const feedbackEmpty = div(
    { class: "text-muted mt-3" },
    i({ class: "fas fa-clock me-2" }),
    "Feedback — coming soon"
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
    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#${tabId}-fb" type="button">Feedback</button>
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
  <div class="tab-pane fade" id="${tabId}-fb">${feedbackEmpty}</div>
</div>`;

  return backBtn + header + tabs;
};

// ── Panel wrapper (rendered on page load) ─────────────────────────────────────

const phasesPanel = async (req) => {
  const innerHtml = await phasesHtml(req);
  return div({ class: "mt-2" }, div({ id: "phases-panel" }, innerHtml));
};

// ── Grouped tables helper ─────────────────────────────────────────────────────

const buildGroupedTablesSection = async (userTables, currentPhaseIdx) => {
  if (!userTables.length) return "";

  const records = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "table_phase",
  });
  const tablePhaseMap = {};
  for (const r of records) tablePhaseMap[r.body.table_name] = r.body;

  const phaseGroups = {};
  const ungrouped = [];
  for (const table of userTables) {
    const assoc = tablePhaseMap[table.name];
    if (assoc !== undefined) {
      const idx = assoc.phase_idx;
      if (!phaseGroups[idx])
        phaseGroups[idx] = { phase_name: assoc.phase_name, tables: [] };
      phaseGroups[idx].tables.push(table);
    } else {
      ungrouped.push(table);
    }
  }

  const formatTables = (tables) =>
    tables
      .map((t) => {
        const fields = (t.fields || [])
          .map((f) => `  * ${f.name} with type: ${f.pretty_type}.`)
          .join("\n");
        return `${t.name}${
          t.description ? `: ${t.description}.` : "."
        }\n${fields}`;
      })
      .join("\n\n");

  const sections = [];
  const sortedIdxs = Object.keys(phaseGroups)
    .map(Number)
    .sort((a, b) => a - b);
  for (const idx of sortedIdxs) {
    const g = phaseGroups[idx];
    const label = g.phase_name
      ? `Phase ${idx + 1}: ${g.phase_name}`
      : `Phase ${idx + 1}`;
    const isCurrent = idx === currentPhaseIdx;
    sections.push(
      `--- Tables from ${label}${
        isCurrent ? " (current phase)" : ""
      } ---\n\n${formatTables(g.tables)}`
    );
  }
  if (ungrouped.length)
    sections.push(
      `--- Tables with no phase association ---\n\n${formatTables(ungrouped)}`
    );

  return (
    "The database already contains the following tables, grouped by the phase that created them:\n\n" +
    sections.join("\n\n") +
    "\n\nAll tables listed above already exist — do NOT create or recreate any of them. Only plan tasks for tables or fields genuinely missing from the requirements of this phase."
  );
};

// ── Phase generation ──────────────────────────────────────────────────────────

const doGenPhases = async (spec, userId) => {
  const generatingMd = await MetaData.create({
    type: "CopilotConstructMgr",
    name: "generating_phases",
    body: {},
    user_id: userId,
  });
  try {
    const researchText = await getResearchAnswersText();
    const answer = await getState().functions.llm_generate.run(
      `Generate the development phases for this application. Each phase groups a set of requirements that belong together and form a coherent milestone.

${spec.body.specification}
${research_answers_section(researchText)}
Rules for generating phases and their requirements:
* Break the application into 3–6 phases. Fewer is better — only split where there is a genuine dependency boundary or a meaningful delivery milestone.
* Every requirement must be directly traceable to something stated in the specification. Do not infer, invent, or add features that are not explicitly mentioned.
* Only include requirements for core functionality. Omit anything described as optional, "nice to have", or "can be added later".
* Do NOT include requirements for integration with external third-party systems unless the specification explicitly names the system and describes exactly what must be exchanged.
* Do not include requirements already handled by the platform. Saltcorn provides built-in user registration (/auth/signup), login (/auth/login), password management, and role-based access control — do not generate requirements to build custom versions of these. Application pages such as a landing page or a dashboard are valid requirements and must be included; a landing page will naturally link to /auth/login and /auth/signup.
* Priority reflects how central the requirement is to the core purpose of its phase. Assign 5 to requirements without which the phase cannot be considered done, 3–4 to important but not blocking, 1–2 to minor enhancements. Do not assign 5 to everything.
* Each phase's requirements must be self-contained: a later phase may depend on earlier phases having been built, but should not require anything from future phases.
* Place foundational data and authentication requirements in the earliest phase.

Now call the set_phases tool with your phases and their grouped requirements.`,
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

    // Delete all phase tasks before replacing phases (phase indices will shift)
    const allTasks = await MetaData.find({
      type: "CopilotConstructMgr",
      name: "task",
    });
    for (const t of allTasks.filter((t) => t.body?.phase_idx !== undefined))
      await t.delete();

    const existing = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "phases",
    });
    if (existing) {
      await existing.update({ body: { phases: tc.input.phases } });
    } else {
      await MetaData.create({
        type: "CopilotConstructMgr",
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
const doGenPhaseTasks = async (
  phaseIdx,
  phase,
  spec,
  userId,
  taskType = null
) => {
  const generatingMd = await MetaData.create({
    type: "CopilotConstructMgr",
    name: "generating_phase_tasks",
    body: { phase_idx: phaseIdx, task_type: taskType },
    user_id: userId,
  });
  try {
    const reqLines = (phase.requirements || [])
      .map((r, i) => `${i + 1}. ${r.requirement} (priority ${r.priority})`)
      .join("\n");

    const existing = await MetaData.find({
      type: "CopilotConstructMgr",
      name: "task",
    });
    const phaseTasks = existing.filter((t) => t.body?.phase_idx === phaseIdx);

    // For feature-only regen, pass existing data_model task names for depends_on context
    const existingDmNames = phaseTasks
      .filter((t) => (t.body.task_type || "feature") === "data_model")
      .map((t) => t.body.name)
      .filter(Boolean);

    const isPlugin = taskType === "plugin" || taskType === null;
    const isFeature = taskType === "feature" || taskType === null;
    const isDataModel = taskType === "data_model" || taskType === null;

    // Always load existing tables so data_model tasks don't recreate them
    const allTables = await Table.find({});
    const userTables = allTables.filter((t) => !t.name.startsWith("_sc_"));
    const existingTablesSection = await buildGroupedTablesSection(
      userTables,
      phaseIdx
    );

    // Load existing views/pages/triggers for feature planning
    let entitiesSection = "";
    if (isFeature) {
      const tableById = Object.fromEntries(
        allTables.map((t) => [t.id, t.name])
      );
      const views = await View.find({});
      const triggers = await Trigger.find({});
      const pages = await Page.find({});
      entitiesSection = existing_entities_list({
        views,
        triggers,
        pages,
        tableById,
      });
    }

    let typeInstruction = "";
    if (taskType === "plugin") {
      typeInstruction =
        '\nGenerate ONLY tasks with task_type "plugin" — tasks that install plugins from the Saltcorn plugin store.' +
        "\nBefore deciding which plugins to plan, carefully read the full application specification and phase requirements and reason through what the application will need. Do not wait for keywords — infer from context:" +
        "\n- Will the application store or display dates or times in any form? (e.g. entry dates, deadlines, schedules, appointments, logs) → a date/time picker plugin will be needed" +
        "\n- Will the application handle money, rates, prices, fees, invoices, or any numeric value representing a currency or billing amount? → a money or decimal field plugin will be needed" +
        "\n- Will any entity be related to multiple instances of another entity in both directions? (e.g. lawyers assigned to projects, products in orders) → a many-to-many plugin will be needed" +
        "\n- Will users enter or display formatted or multi-line text beyond a plain string? → a rich text editor plugin will be needed" +
        "\n- Will any page show charts, graphs, totals, or aggregated statistics? → a chart plugin will be needed" +
        "\n- Will the application deal with physical locations, addresses, or maps? → a map plugin will be needed" +
        "\n- Will users upload or attach files or images? → a file upload plugin will be needed" +
        "\nFor each need you identify, check the available plugin list above for a matching plugin that is not already installed, and plan a task for it." +
        "\nEach task installs exactly one plugin. If no plugins are needed, call plan_tasks with an empty tasks array.";
    } else if (taskType === "data_model") {
      typeInstruction =
        '\nGenerate ONLY tasks with task_type "data_model" — tasks that create or modify database tables or fields. Do not generate any feature tasks.' +
        "\nEach task should implement exactly one deliverable — one table or a closely related set of fields." +
        "\nKeep tasks small and focused. Tasks may depend on other tasks within this phase using the depends_on field." +
        "\n\nCritical: only create tables and fields that are directly required by the requirements of THIS phase listed above. Do not anticipate future phases or add tables speculatively because they will eventually be needed. If a requirement is not listed above, it belongs to another phase — do not implement it here." +
        "\n\nImportant: Each task description must fully specify uniqueness (unique=true) and required (not_null=true) constraints on every field — do not leave these for a later step. Never mention constraints on the 'id' field — it is the primary key and is always unique and not-null by definition." +
        "\nImportant: Ownership (auto-populating a FK-to-users field from the logged-in user) is a view-level concern — task descriptions must not mention it. Just describe the FK field normally." +
        "\nImportant: Do NOT plan any task that creates a table for SMTP, email configuration, or mail server credentials — email config is managed by the platform administrator.";
    } else if (taskType === "feature") {
      typeInstruction =
        '\nGenerate ONLY tasks with task_type "feature" — tasks that create views, pages, triggers, or workflows. Do not generate any data_model tasks.' +
        (existingDmNames.length
          ? `\n\nThe following data model tasks already exist for this phase and may be referenced in depends_on:\n${existingDmNames.join(
              ", "
            )}`
          : "");
    } else {
      typeInstruction =
        "\n\nSet task_type on every task:\n" +
        '- "plugin" for tasks that install a plugin from the Saltcorn plugin store. Only include plugin tasks if the requirements genuinely need functionality not built into Saltcorn.\n' +
        '- "data_model" for tasks that create or modify database tables or fields.\n' +
        '- "feature" for tasks that create views, pages, triggers, or workflows.\n' +
        "Order tasks: plugin tasks first, then data_model, then feature.\n" +
        "\nCritical: for data_model tasks, only create tables and fields directly required by the requirements of THIS phase. Do not anticipate future phases or add tables speculatively.";
    }

    let storePluginsSection = "";
    if (isPlugin) {
      try {
        const available = await Plugin.store_plugins_available();
        const installed = await Plugin.find({});
        const installedNames = new Set(installed.map((p) => p.name));
        if (available?.length) {
          storePluginsSection =
            "\nThe following plugins are available in the Saltcorn plugin store:\n" +
            available
              .map(
                (p) => `- ${p.name}${p.description ? `: ${p.description}` : ""}`
              )
              .join("\n") +
            "\n";
        }
        if (installedNames.size) {
          storePluginsSection +=
            "\nThe following plugins are already installed — do NOT plan tasks to install them again:\n" +
            [...installedNames].map((n) => `- ${n}`).join("\n") +
            "\n";
        }
      } catch (_) {}
    }

    const answer = await getState().functions.llm_generate.run(
      `You are planning the implementation tasks for a single phase of a Saltcorn application.

Application specification:
${spec.body.specification}

Phase: ${phase.name}
${phase.description}

Requirements for this phase:
${reqLines}

Plan only the tasks needed to implement the requirements listed above. Do not plan tasks for requirements belonging to other phases. This applies especially to database tables — do not create a table unless it is directly needed by a requirement listed above, even if you can tell it will be needed in a later phase.

Important: Do NOT plan any task that creates a Roles table, a permissions table, or any table describing what roles are allowed to do. Saltcorn has a built-in role system (1=admin, 40=staff, 80=user, 100=public) and every entity (view, page, table) already has a min_role property for access control. There is nothing to store in the database — access control is configured on each entity directly.
${typeInstruction}
${storePluginsSection}${
        existingTablesSection ? "\n" + existingTablesSection + "\n" : ""
      }${entitiesSection ? "\n" + entitiesSection + "\n" : ""}
${isFeature ? task_planning_rules : ""}

${task_planning_closing}

Now call the plan_tasks tool with your tasks for this phase.`,
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
    for (const t of phaseTasks) {
      const tType = t.body.task_type || "feature";
      if (!taskType || tType === taskType) await t.delete();
    }

    // Clear any existing "no plugins needed" markers for this phase
    if (!taskType || taskType === "plugin") {
      const oldMarkers = await MetaData.find({
        type: "CopilotConstructMgr",
        name: "phase_plugin_generated",
      });
      for (const m of oldMarkers.filter((m) => m.body?.phase_idx === phaseIdx))
        await m.delete();
    }

    for (const task of tc.input.tasks)
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: "task",
        body: { ...task, phase_idx: phaseIdx, phase_name: phase.name },
        user_id: userId,
      });

    // If plugin generation produced 0 tasks, record that it was considered
    if (
      (taskType === "plugin" || taskType === null) &&
      tc.input.tasks.filter((t) => t.task_type === "plugin").length === 0
    ) {
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: "phase_plugin_generated",
        body: { phase_idx: phaseIdx },
        user_id: userId,
      });
    }
  } finally {
    await generatingMd.delete();
    try {
      getState().emitDynamicUpdate(db.getTenantSchema(), {
        eval_js: `if(typeof copilotPhaseTasksDone==='function')copilotPhaseTasksDone(${phaseIdx});`,
      });
    } catch (_) {}
  }
};

// ── Phase task chain runner ───────────────────────────────────────────────────

const doRunPhaseTasks = async (phaseIdx, taskType, req) => {
  const flagName = `phase_running_${phaseIdx}_${taskType}`;
  const running = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: flagName,
  });
  if (!running) return;

  const allTasks = await MetaData.find({
    type: "CopilotConstructMgr",
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
    await doRunPhaseTasks(phaseIdx, taskType, req);
  } else {
    const runningMd = await MetaData.findOne({
      type: "CopilotConstructMgr",
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

const gen_phases = async (table_id, vn, config, body, { req, res }) => {
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  if (!spec) return { json: { error: "Specification not found" } };
  doGenPhases(spec, req.user?.id).catch((e) =>
    console.error("gen_phases error", e)
  );
  return { json: { success: true } };
};

const phases_status = async (table_id, vn, config, body, { req, res }) => {
  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_phases",
  });
  return { json: { generating: !!generating } };
};

const phases_html = async (table_id, vn, config, body, { req, res }) => {
  const html = await phasesHtml(req);
  return { json: { html } };
};

const phase_detail_html = async (table_id, vn, config, body, { req, res }) => {
  const idx = parseInt(body.idx);
  const phasesMd = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "phases",
  });
  const phase = phasesMd?.body?.phases?.[idx];
  if (!phase) return { json: { error: "Phase not found" } };
  return { json: { html: await phaseDetailHtml(phase, idx) } };
};

const generate_phase_tasks = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const idx = parseInt(body.idx);
  const taskType = body.task_type || null;
  const phasesMd = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "phases",
  });
  const phase = phasesMd?.body?.phases?.[idx];
  if (!phase) return { json: { error: "Phase not found" } };
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  if (!spec) return { json: { error: "Specification not found" } };
  doGenPhaseTasks(idx, phase, spec, req.user?.id, taskType).catch((e) =>
    console.error("generate_phase_tasks error", e)
  );
  return { json: { success: true } };
};

const phase_tasks_status = async (table_id, vn, config, body, { req, res }) => {
  const idx = parseInt(body.idx);
  const taskType = body.task_type || null;
  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
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
  const idx = parseInt(body.idx);
  const taskType = body.task_type || "feature";
  const html = await phaseTasksHtml(idx, taskType);
  return { json: { html } };
};

const run_phase_tasks = async (table_id, vn, config, body, { req, res }) => {
  const idx = parseInt(body.idx);
  const taskType = body.task_type || "feature";
  const flagName = `phase_running_${idx}_${taskType}`;
  const existing = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: flagName,
  });
  if (!existing)
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: flagName,
      body: { started: Date.now() },
      user_id: req.user?.id,
    });
  doRunPhaseTasks(idx, taskType, {
    user: req.user,
    __: req.__ || ((s) => s),
    getLocale: req.getLocale || (() => "en"),
  }).catch((e) => console.error("run_phase_tasks error", e));
  return { json: { success: true } };
};

const stop_phase_tasks = async (table_id, vn, config, body, { req, res }) => {
  const idx = parseInt(body.idx);
  const taskType = body.task_type || "feature";
  const running = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: `phase_running_${idx}_${taskType}`,
  });
  if (running) await running.delete();
  const allTasks = await MetaData.find({
    type: "CopilotConstructMgr",
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
  const idx = parseInt(body.idx);
  const taskType = body.task_type || "feature";
  const allTasks = await MetaData.find({
    type: "CopilotConstructMgr",
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
      type: "CopilotConstructMgr",
      name: "phase_plugin_generated",
    });
    for (const m of markers.filter((m) => m.body?.phase_idx === idx))
      await m.delete();
  }
  if (taskType === "data_model") {
    const tablePhase = await MetaData.find({
      type: "CopilotConstructMgr",
      name: "table_phase",
    });
    for (const m of tablePhase.filter((m) => m.body?.phase_idx === idx))
      await m.delete();
  }
  return { json: { success: true } };
};

const phase_run_status = async (table_id, vn, config, body, { req, res }) => {
  const idx = parseInt(body.idx);
  const taskType = body.task_type || "feature";
  const runningMd = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: `phase_running_${idx}_${taskType}`,
  });
  const isRunning = !!runningMd;
  const allTasks = await MetaData.find({
    type: "CopilotConstructMgr",
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
  const allTasks = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "task",
  });
  for (const t of allTasks.filter((t) => t.body?.phase_idx !== undefined))
    await t.delete();
  const markers = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "phase_plugin_generated",
  });
  for (const m of markers) await m.delete();
  const tablePhase = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "table_phase",
  });
  for (const m of tablePhase) await m.delete();
  const phasesMd = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "phases",
  });
  if (phasesMd) await phasesMd.delete();
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
};

module.exports = { phasesPanel, phasesStaticScript, phase_routes };
