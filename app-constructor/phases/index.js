const MetaData = require("@saltcorn/data/models/metadata");
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
  textarea,
  label,
  select,
  option,
} = require("@saltcorn/markup/tags");
const { mkTable } = require("@saltcorn/markup");
const { getState, features } = require("@saltcorn/data/db/state");
const { viewname, getPt } = require("../common");
// All phase/task business logic (task generation, run/stop, chain state
// machine, crash recovery, phase-list & requirement CRUD) lives in
// PhaseHelper - this file only does routing + rendering on top of it.
const { PhaseHelper } = require("./phase-helper");
const { tasksOfType, allTasksDone } = require("./common");

// ── Static client-side script ─────────────────────────────────────────────────

const phasesStaticScript = `<script>
const _phasesVn = ${JSON.stringify(viewname)};

function phasesStartPoll() {
  const poll = () => {
    view_post(_phasesVn, 'phases_status', {}, (resp) => {
      if (resp && !resp.generating) {
        if (resp.error) notifyAlert({ type: 'danger', text: resp.error });
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

// Any phase card whose "Generate & Run" is currently in flight, and the
// project-wide "Run all phases" overview if that's active — (re)starts each
// one's status tracking (poll loop, or just an initial sync in push mode).
function _trackBusyPhaseCards() {
  document.querySelectorAll('[id^="phase-all-stop-btn-"]:not(.d-none)').forEach((btn) => {
    const idx = parseInt(btn.id.replace('phase-all-stop-btn-', ''));
    if (!isNaN(idx)) _refreshChainUI(idx);
  });
  const overviewStopBtn = document.getElementById('phases-stop-all-btn');
  if (overviewStopBtn && !overviewStopBtn.classList.contains('d-none')) _refreshOverviewStatus();
}

window.copilotRefreshPhases = function() {
  _setPhaseParam(null);
  view_post(_phasesVn, 'phases_html', {}, (r) => {
    const panel = document.getElementById('phases-panel');
    if (r && r.html && panel) {
      panel.innerHTML = r.html;
      delete panel.dataset.phaseIdx;
      _trackBusyPhaseCards();
    }
  });
};

function _refreshPhaseArea(idx, taskType, cb) {
  const areaId = taskType === 'plugin' ? 'phase-plugins-area'
               : taskType === 'data_model' ? 'phase-data-model-area'
               : 'phase-features-area';
  view_post(_phasesVn, 'phase_tasks_html', { idx, task_type: taskType }, (r) => {
    const el = document.getElementById(areaId);
    if (r && r.html && el) el.innerHTML = r.html;
    if (cb) cb();
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

function _loadPhaseDetail(idx) {
  view_post(_phasesVn, 'phase_detail_html', { idx }, (r) => {
    if (r && r.html) {
      const panel = document.getElementById('phases-panel');
      panel.innerHTML = r.html;
      panel.dataset.phaseIdx = idx;

      _refreshChainUI(idx);

      for (const tt of ['plugin', 'data_model', 'feature']) {
        view_post(_phasesVn, 'phase_tasks_status', { idx, task_type: tt }, (resp) => {
          if (!resp) return;
          if (resp.generating && !window.dynamic_updates_cfg?.enabled) phaseTasksPoll(idx, tt);
        });
        view_post(_phasesVn, 'phase_run_status', { idx, task_type: tt }, (resp) => {
          if (!resp) return;
          if (!window.dynamic_updates_cfg?.enabled && (resp.isRunning || resp.anyRunning)) phasePollRunning(idx, tt);
        });
      }
    }
  });
}
window.openPhaseDetail = function(idx) {
  _setPhaseParam(idx);
  _loadPhaseDetail(idx);
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
    const taskName = btn.closest('.card')?.querySelector('.fw-semibold')?.textContent?.trim() || '';
    const statusEl = document.getElementById('phase-all-run-status-' + phaseIdx);
    if (statusEl) {
      statusEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1 text-success"></i>Running: ';
      statusEl.appendChild(document.createTextNode(taskName));
    }
    const poll = () => {
      view_post(_phasesVn, 'task_status', { ids: [String(id)] }, (statusResp) => {
        if (statusResp && statusResp.any_done) {
          _refreshPhaseArea(phaseIdx, taskType);
          if (typeof copilotRefreshSchema === 'function') copilotRefreshSchema();
          if (statusEl) statusEl.textContent = 'Not running';
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
  if (!confirm('Delete all tasks in this section?')) return;
  view_post(_phasesVn, 'del_phase_type_tasks', { idx, task_type: taskType }, () => {
    _refreshPhaseArea(idx, taskType);
  });
};

function phaseTasksPoll(idx, taskType) {
  const poll = () => {
    view_post(_phasesVn, 'phase_tasks_status', { idx, task_type: taskType }, (resp) => {
      if (resp && !resp.generating) {
        _refreshPhaseArea(idx, taskType);
        if (typeof copilotPhaseTasksDone === 'function') copilotPhaseTasksDone(idx);
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
  const hasTasks = el && el.querySelector('[data-task-card]');
  if (hasTasks && !confirm('Regenerate tasks? This will replace the existing tasks in this section.')) return;

  function doGenerate() {
    if (el) el.innerHTML = _tasksGeneratingHtml(idx, taskType);
    view_post(_phasesVn, 'generate_phase_tasks', { idx, task_type: taskType }, () => {});
    if (!window.dynamic_updates_cfg?.enabled) phaseTasksPoll(idx, taskType);
  }

  if (taskType === 'data_model' || taskType === 'feature') {
    const thisLabel = taskType === 'data_model' ? 'Data model' : 'Feature';
    view_post(_phasesVn, 'prev_section_status', { idx, task_type: taskType }, (resp) => {
      if (resp && resp.hasIncompleteTasks) {
        const labels = (resp.incompleteSections || []).map(function(s) {
          return s === 'plugin' ? 'Plugin' : 'Data model';
        });
        const sectionList = labels.join(' and ');
        const msg = sectionList + ' tasks are not fully completed yet.\\n\\n' +
          thisLabel + ' tasks depend on them - ' +
          'generating now may produce incorrect or incomplete results.\\n\\nGenerate anyway?';
        if (!confirm(msg)) return;
      }
      doGenerate();
    });
  } else {
    doGenerate();
  }
};

function _tasksGeneratingHtml(idx, taskType) {
  return '<div class="d-flex align-items-center gap-2 text-muted small">' +
    '<i class="fas fa-spinner fa-spin"></i> Generating tasks, please wait... ' +
    '<button class="btn btn-sm text-muted ms-2" ' +
    'style="font-size:0.75rem;padding:1px 6px;border:1px solid #ced4da;" ' +
    'title="Cancel generation" ' +
    'data-cancel-idx="' + idx + '" data-cancel-type="' + taskType + '" ' +
    'onclick="cancelGeneratingPhaseTasks(+this.dataset.cancelIdx,this.dataset.cancelType)">' +
    '<i class="fas fa-times me-1"></i>cancel</button></div>';
}

function _runAllTopBar(idx) {
  return {
    status: document.getElementById('phase-all-run-status-' + idx),
    runBtn: document.getElementById('phase-all-run-btn-' + idx),
    stopBtn: document.getElementById('phase-all-stop-btn-' + idx),
    genRunBtn: document.getElementById('phase-all-gen-run-btn-' + idx),
  };
}
function _runAllSetIdle(idx, msg) {
  const { status, runBtn, stopBtn, genRunBtn } = _runAllTopBar(idx);
  if (status) status.textContent = msg || 'Not running';
  if (runBtn) { runBtn.disabled = false; runBtn.innerHTML = '<i class="fas fa-play me-1"></i>Run all'; }
  if (genRunBtn) { genRunBtn.disabled = false; genRunBtn.innerHTML = '<i class="fas fa-play me-1"></i>Generate & Run'; }
  if (stopBtn) stopBtn.classList.add('d-none');
}
function _runAllSetRunning(idx, taskType) {
  const label = taskType === 'plugin' ? 'Plugins' : taskType === 'data_model' ? 'Data model' : 'Features';
  const { status, runBtn, stopBtn, genRunBtn } = _runAllTopBar(idx);
  if (status) status.innerHTML = '<i class="fas fa-spinner fa-spin me-1 text-success"></i>Running: ' + label;
  if (runBtn) { runBtn.disabled = true; runBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Running…'; }
  if (genRunBtn) genRunBtn.disabled = true;
  if (stopBtn) { stopBtn.disabled = false; stopBtn.classList.remove('d-none'); }
}
function _runAllSetGenerating(idx, taskType) {
  const label = taskType === 'plugin' ? 'Plugins' : taskType === 'data_model' ? 'Data model' : 'Features';
  const { status, runBtn, stopBtn, genRunBtn } = _runAllTopBar(idx);
  if (status) status.innerHTML = '<i class="fas fa-spinner fa-spin me-1 text-primary"></i>Generating: ' + label;
  if (runBtn) runBtn.disabled = true;
  if (genRunBtn) { genRunBtn.disabled = true; genRunBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Running…'; }
  if (stopBtn) { stopBtn.disabled = false; stopBtn.classList.remove('d-none'); }
}
function _runAllSetStopping(idx) {
  const { status, runBtn, stopBtn, genRunBtn } = _runAllTopBar(idx);
  if (status) status.innerHTML = '<i class="fas fa-spinner fa-spin me-1 text-danger"></i>Stopping after current task…';
  if (runBtn) runBtn.disabled = true;
  if (genRunBtn) genRunBtn.disabled = true;
  if (stopBtn) { stopBtn.disabled = true; stopBtn.classList.remove('d-none'); }
}

// Requests can land out of order (a poll tick issued just before a click can
// resolve just after that click's own refresh) - _chainStatusSeq tracks the
// latest issued refresh per phase so a stale response can't clobber a newer
// one (e.g. showing "Generating…"/"Running…" again right after "Stopping…").
// Both the card-refresh and the status-check below share the same token per
// _refreshChainUI call, since a stale response from either can cause it.
const _chainStatusSeq = {};

// Patches just one phase card in place (used when the phases list, not a
// phase's detail view, is what's currently showing).
function _refreshPhaseCard(idx, seq) {
  if (seq === undefined) seq = (_chainStatusSeq[idx] = (_chainStatusSeq[idx] || 0) + 1);
  view_post(_phasesVn, 'phase_card_html', { idx }, (r) => {
    if (_chainStatusSeq[idx] !== seq) return; // superseded by a newer refresh
    const el = document.getElementById('phase-card-' + idx);
    if (r && r.html && el) el.outerHTML = r.html;
  });
}

// The server keeps track of the run, not the browser - so this just asks
// what's happening right now and shows that, which is why a reload doesn't lose it.
function _refreshChainUI(idx) {
  const panel = document.getElementById('phases-panel');
  const openIdx = panel && panel.dataset.phaseIdx !== undefined ? parseInt(panel.dataset.phaseIdx) : null;
  const seq = (_chainStatusSeq[idx] = (_chainStatusSeq[idx] || 0) + 1);
  if (openIdx === idx) _refreshAllAreas(idx);
  else if (openIdx === null) _refreshPhaseCard(idx, seq);
  view_post(_phasesVn, 'phase_chain_status', { idx }, (r) => {
    if (_chainStatusSeq[idx] !== seq) return; // superseded by a newer request
    if (!r || !r.active) { _runAllSetIdle(idx, 'Not running'); return; }
    if (r.isStopping) _runAllSetStopping(idx);
    else if (r.isGenerating) _runAllSetGenerating(idx, r.taskType);
    else if (r.isRunning) _runAllSetRunning(idx, r.taskType);
    // else: mid-transition between steps — leave the status text as-is, the
    // next tick (push or poll) will land on the settled state.
    if (!window.dynamic_updates_cfg?.enabled) setTimeout(() => _refreshChainUI(idx), 2500);
  });
}

// ── Overview: "Run all phases" + processing status ─────────────────────────────
// Mirrors _refreshChainUI, but for the phases overview - it reflects only the
// all_phases_chain-driven run (a lone phase card's own run shows its own status).
function _refreshOverviewStatus() {
  const statusEl = document.getElementById('phases-overview-status');
  if (!statusEl) return; // navigated away from the overview
  view_post(_phasesVn, 'phases_overview_status', {}, (r) => {
    const runBtn = document.getElementById('phases-run-all-btn');
    const stopBtn = document.getElementById('phases-stop-all-btn');
    if (r && r.active) {
      const typeLabel = r.taskType === 'plugin' ? 'Plugins'
        : r.taskType === 'data_model' ? 'Data model' : 'Features';
      statusEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1 text-primary"></i>' +
        (r.stopped ? 'Stopping ' + r.phaseName + '…'
          : 'Processing ' + r.phaseName + (r.taskType ? ' (' + typeLabel + ')' : '') + '…');
      if (runBtn) { runBtn.disabled = true; runBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Running…'; }
      if (stopBtn) stopBtn.classList.remove('d-none');
      if (r.idx != null) _refreshPhaseCard(r.idx); // keep the in-flight phase's card in sync too
      if (!window.dynamic_updates_cfg?.enabled) setTimeout(_refreshOverviewStatus, 3000);
    } else {
      // done (or stopped) — full repaint re-enables every card's run button
      // and updates done-badges, so no separate "go idle" patch is needed here.
      copilotRefreshPhases();
    }
  });
}
window.copilotPhasesOverviewUpdate = function() {
  _refreshOverviewStatus();
};

window.runAllPhases = function() {
  const runBtn = document.getElementById('phases-run-all-btn');
  if (runBtn) { runBtn.disabled = true; runBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Running…'; }
  view_post(_phasesVn, 'run_all_phases', {}, () => _refreshOverviewStatus());
};

window.stopAllPhases = function() {
  const statusEl = document.getElementById('phases-overview-status');
  if (statusEl) statusEl.textContent = 'Stopping…';
  const stopBtn = document.getElementById('phases-stop-all-btn');
  if (stopBtn) stopBtn.disabled = true;
  view_post(_phasesVn, 'stop_all_phases', {}, () => _refreshOverviewStatus());
};

window.generateAndRunAllPhaseTasks = function(idx) {
  function start() {
    const { genRunBtn } = _runAllTopBar(idx);
    if (genRunBtn) { genRunBtn.disabled = true; genRunBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Running…'; }
    view_post(_phasesVn, 'run_all_phase_tasks', { idx }, () => _refreshChainUI(idx));
  }
  view_post(_phasesVn, 'prev_phases_status', { idx }, (resp) => {
    if (resp && !resp.allPreviousDone) {
      const msg = 'These earlier phases are not finished yet:\\n\\n  ' + resp.incompletePhases.join('\\n  ') + '\\n\\nRun this phase anyway?';
      if (!confirm(msg)) return;
    }
    start();
  });
};

window.stopAllPhaseTasks = function(idx) {
  _runAllSetStopping(idx);
  view_post(_phasesVn, 'stop_phase_chain', { idx }, () => _refreshChainUI(idx));
};

window.runGroupTasks = function(idx, taskType) {
  _runAllSetRunning(idx, taskType);
  view_post(_phasesVn, 'run_phase_tasks', { idx, task_type: taskType }, (resp) => {
    if (!resp) { _runAllSetIdle(idx, 'Not running'); return; }
    if (!window.dynamic_updates_cfg?.enabled) {
      const poll = () => {
        view_post(_phasesVn, 'phase_run_status', { idx, task_type: taskType }, (r) => {
          if (!r) { _refreshPhaseArea(idx, taskType); _runAllSetIdle(idx, 'Not running'); return; }
          if (r.isRunning || r.anyRunning) {
            _refreshPhaseArea(idx, taskType);
            setTimeout(poll, 3000);
          } else {
            _refreshPhaseArea(idx, taskType);
            if (typeof copilotRefreshSchema === 'function') copilotRefreshSchema();
            _runAllSetIdle(idx, 'Not running');
          }
        });
      };
      setTimeout(poll, 2000);
    }
    // push mode: nothing else to do here — copilotPhaseTasksDone/Failed will
    // fire and repaint via _refreshChainUI, which correctly reports idle.
  });
};

window.cancelGeneratingPhaseTasks = function(idx, taskType) {
  view_post(_phasesVn, 'cancel_generating_phase_tasks', { idx, task_type: taskType }, () => {
    _refreshPhaseArea(idx, taskType);
  });
};

window.copilotPhaseTasksDone = function(idx) { _refreshChainUI(idx); };
window.copilotPhaseTasksFailed = function(idx) { _refreshChainUI(idx); };
window.copilotPhaseChainUpdate = function(idx) { _refreshChainUI(idx); };

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
  if (phaseParam !== null) {
    const idx = parseInt(phaseParam);
    const panel = document.getElementById('phases-panel');
    if (panel) panel.dataset.phaseIdx = idx;
    _refreshChainUI(idx);
    for (const tt of ['plugin', 'data_model', 'feature']) {
      view_post(_phasesVn, 'phase_tasks_status', { idx, task_type: tt }, (resp) => {
        if (!resp) return;
        if (resp.generating && !window.dynamic_updates_cfg?.enabled) phaseTasksPoll(idx, tt);
      });
      view_post(_phasesVn, 'phase_run_status', { idx, task_type: tt }, (resp) => {
        if (!resp) return;
        if (!window.dynamic_updates_cfg?.enabled && (resp.isRunning || resp.anyRunning)) phasePollRunning(idx, tt);
      });
    }
  } else {
    _trackBusyPhaseCards();
  }
}
(function() {
  // Deferred via setTimeout, same as saltcorn's own domReady() helper, so this
  // always runs after projectIdWrapperScript's view_post patch (view.js) has
  // applied - otherwise the very first phase_tasks_html/phase_card_html calls
  // below go out without project_id and come back empty, blanking out tasks
  // that were correctly rendered server-side.
  if (document.readyState === 'complete') setTimeout(copilotInitPhasesState);
  else document.addEventListener('DOMContentLoaded', function() { setTimeout(copilotInitPhasesState); });
})();
</script>`;

// ── Shared helpers ────────────────────────────────────────────────────────────

const phasesSpinner =
  `<p id="phases-generating-state">` +
  i({ class: "fas fa-spinner fa-spin me-2" }) +
  "Generating phases, please wait...</p>";

const tasksSpinner = (phaseIdx, taskType) =>
  div(
    { class: "d-flex align-items-center gap-2 text-muted small" },
    i({ class: "fas fa-spinner fa-spin" }),
    "Generating tasks, please wait...",
    button(
      {
        class: "btn btn-sm text-muted ms-2",
        style: "font-size:0.75rem;padding:1px 6px;border:1px solid #ced4da;",
        title: "Cancel generation",
        onclick: `cancelGeneratingPhaseTasks(${phaseIdx},${JSON.stringify(
          taskType
        )})`,
      },
      i({ class: "fas fa-times me-1" }),
      "cancel"
    )
  );

// ── Phase list view ───────────────────────────────────────────────────────────

const phaseCard = (
  phase,
  idx,
  req,
  allDone,
  hasFeedback,
  projectId,
  runState,
  disableRun
) => {
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
                      onclick: `if(confirm('Delete this requirement?')) view_post(_phasesVn,'delete_requirement',{
                        phaseIdx:${idx},reqIdx:${rIdx}
                      },()=>copilotRefreshPhases())`,
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

  const { statusHtml, genRunBtnHtml, stopBtnHtml } = runControlsHtml(
    idx,
    runState,
    disableRun,
    `Run Phase ${idx + 1}`
  );

  return div(
    {
      id: `phase-card-${idx}`,
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
        { class: "d-flex align-items-center gap-2 mb-2 flex-wrap" },
        genRunBtnHtml,
        stopBtnHtml,
        statusHtml
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

  const dmMarkers = await MetaData.find({
    type: pt,
    name: "phase_data_model_generated",
  });
  const dmMarkerIdxs = new Set(dmMarkers.map((m) => m.body?.phase_idx));

  const phaseAllDone = phases.map((_, idx) => {
    const phaseTasks = allTasks.filter((t) => t.body?.phase_idx === idx);
    // ok if marker says 0 were needed, or if tasks exist and all done
    const pluginOk =
      pluginMarkerIdxs.has(idx) ||
      allTasksDone(tasksOfType(phaseTasks, "plugin"));
    const dmOk =
      dmMarkerIdxs.has(idx) ||
      allTasksDone(tasksOfType(phaseTasks, "data_model"));
    return dmOk && allTasksDone(tasksOfType(phaseTasks, "feature")) && pluginOk;
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

  const [runStates, overviewState] = await Promise.all([
    Promise.all(phases.map((_, idx) => PhaseHelper.status(idx, pt))),
    PhaseHelper.allPhasesStatus(pt),
  ]);
  const taskTypeLabel = (tt) =>
    tt === "plugin"
      ? "Plugins"
      : tt === "data_model"
      ? "Data model"
      : "Features";

  const runAllRow = div(
    { class: "d-flex align-items-center gap-2 mb-3 flex-wrap" },
    button(
      {
        id: "phases-run-all-btn",
        class: "btn btn-success btn-sm",
        onclick: "runAllPhases()",
        title: "Generate and run tasks for every phase, in order",
        ...(overviewState.active ? { disabled: true } : {}),
      },
      i({
        class: overviewState.active
          ? "fas fa-spinner fa-spin me-1"
          : "fas fa-play me-1",
      }),
      overviewState.active ? "Running…" : "Run all phases"
    ),
    button(
      {
        id: "phases-stop-all-btn",
        class: `btn btn-danger btn-sm${overviewState.active ? "" : " d-none"}`,
        onclick: "stopAllPhases()",
      },
      i({ class: "fas fa-stop me-1" }),
      "Stop"
    ),
    span(
      { id: "phases-overview-status", class: "small text-muted" },
      overviewState.active
        ? i({ class: "fas fa-spinner fa-spin me-1 text-primary" }) +
            (overviewState.stopped
              ? `Stopping ${overviewState.phaseName}…`
              : `Processing ${overviewState.phaseName}` +
                (overviewState.taskType
                  ? ` (${taskTypeLabel(overviewState.taskType)})`
                  : "") +
                "…")
        : ""
    )
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
    runAllRow +
    phases
      .map((ph, idx) =>
        phaseCard(
          ph,
          idx,
          req,
          phaseAllDone[idx],
          phasesWithFeedback.has(idx),
          projectId,
          runStates[idx],
          overviewState.active
        )
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
  if (isGenerating) return tasksSpinner(phaseIdx, taskType);

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
  const genOnclick = `generatePhaseTasks(${phaseIdx},'${taskType}')`;
  const genBtn = button(
    {
      class: "btn btn-primary btn-sm",
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

  const hasTodo = tasks.some(
    (t) => !t.body.status || t.body.status === "To do"
  );
  const runGroupBtn = hasTodo
    ? button(
        {
          class: "btn btn-success btn-sm",
          onclick: `runGroupTasks(${phaseIdx},'${taskType}')`,
        },
        i({ class: "fas fa-play me-1" }),
        "Run all"
      )
    : "";

  const topBar = tasks.length
    ? div(
        {
          class: "d-flex align-items-center gap-2 mb-3 flex-wrap",
          "data-phase-loaded": "1",
        },
        runGroupBtn,
        div({ class: "ms-auto" }, addTaskBtn)
      )
    : div(
        {
          class: "d-flex align-items-center gap-2 mb-3 flex-wrap",
          "data-phase-loaded": "1",
        },
        genBtn,
        addTaskBtn
      );

  const bottomBar = tasks.length
    ? div({ class: "mt-3 d-flex gap-2" }, delAllBtn, genBtn)
    : "";

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
              )}/get_task_form?id=${
                t.id
              }&project_id=${projectId}', {method:'POST'})`,
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
      { class: "card mb-2 shadow-sm", "data-task-card": t.id },
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

  const newSchemaTasks =
    taskType === "data_model"
      ? plannedTasks.filter((t) => !t.body.modifies_existing_table)
      : plannedTasks;
  const existingTableTasks =
    taskType === "data_model"
      ? plannedTasks.filter((t) => t.body.modifies_existing_table)
      : [];

  if (!tasks.length) {
    const { markedEmpty } = await PhaseHelper.typeGenerationState(
      phaseIdx,
      taskType,
      pt
    );
    const emptyMsg = !markedEmpty
      ? "No tasks yet."
      : taskType === "plugin"
      ? "No plugin installations needed for this phase."
      : "No schema changes needed for this phase.";
    return (
      staleNotice + topBar + p({ class: "text-muted small mt-2" }, emptyMsg)
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

  const existingTableSection = existingTableTasks.length
    ? div(
        { class: "d-flex align-items-center gap-2 mb-2 mt-4" },
        small(
          {
            class: "text-uppercase fw-semibold text-nowrap",
            style: "font-size:0.7rem;letter-spacing:.06em;color:#7b5230;",
          },
          i({
            class: "fas fa-exclamation-triangle me-1",
            style: "color:#b08050;",
          }),
          "Modifies pre-existing tables"
        ),
        div({ class: "flex-grow-1", style: "border-top:2px solid #b08050;" })
      ) + existingTableTasks.map(renderTask).join("")
    : "";

  return (
    staleNotice +
    topBar +
    newSchemaTasks.map(renderTask).join("") +
    existingTableSection +
    feedbackSection +
    bottomBar
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

// The "Generate & Run" / "Stop" controls for a phase — same three elements
// (status span + run button + stop button, same IDs) wherever a phase's
// run state needs to be shown: the phase card in the list, and the phase
// detail view. Sharing the IDs (never both on screen at once — the list and
// a phase's detail occupy the same panel) is what lets a single client-side
// refresh function drive whichever one is currently rendered.
// disableRun: true while "Run all phases" (project-wide) is active, so a
// phase not yet reached by it can't also be started individually.
const runControlsHtml = (
  idx,
  runState,
  disableRun = false,
  idleLabel = "Generate &amp; Run"
) => {
  const { isBusy, isStopping } = runState;
  const status = isStopping ? "Stopping…" : isBusy ? "Running…" : "";
  const genRunBtnContent = isBusy
    ? `<i class="fas fa-spinner fa-spin me-1"></i>Running…`
    : `<i class="fas fa-play me-1"></i>${idleLabel}`;
  const runBtnTitle =
    disableRun && !isBusy
      ? "Disabled while ‘Run all phases’ is in progress"
      : "Generate and run all tasks for this phase";
  return {
    statusHtml: `<span id="phase-all-run-status-${idx}" class="small text-muted">${status}</span>`,
    genRunBtnHtml: `<button id="phase-all-gen-run-btn-${idx}" class="btn btn-success btn-sm" onclick="generateAndRunAllPhaseTasks(${idx})" title="${runBtnTitle}"${
      isBusy || disableRun ? " disabled" : ""
    }>${genRunBtnContent}</button>`,
    stopBtnHtml: `<button id="phase-all-stop-btn-${idx}" class="btn btn-danger btn-sm${
      isBusy ? "" : " d-none"
    }"${
      isStopping ? " disabled" : ""
    } onclick="stopAllPhaseTasks(${idx})"><i class="fas fa-stop me-1"></i>Stop</button>`,
  };
};

const phaseDetailHtml = async (phase, idx, pt, projectId) => {
  const tabId = `phase-detail-tabs-${idx}`;
  const [plContent, dmContent, ftContent, pgContent, runState] =
    await Promise.all([
      phaseTasksHtml(idx, "plugin", pt, projectId),
      phaseTasksHtml(idx, "data_model", pt, projectId),
      phaseTasksHtml(idx, "feature", pt, projectId),
      phaseProgressHtml(idx, 1, pt),
      PhaseHelper.status(idx, pt),
    ]);

  const { statusHtml, genRunBtnHtml, stopBtnHtml } = runControlsHtml(
    idx,
    runState
  );

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

  const taskGroup = (icon, label, areaId, content) => `
<div class="mb-4">
  <div class="d-flex align-items-center gap-2 mb-3" style="border-bottom:2px solid #dee2e6;padding-bottom:.35rem;">
    <i class="fas ${icon} text-primary" style="font-size:.85rem;"></i>
    <span class="fw-semibold">${label}</span>
  </div>
  <div id="${areaId}">${content}</div>
</div>`;

  const tabs = `
<ul class="nav nav-tabs" id="${tabId}" role="tablist">
  <li class="nav-item" role="presentation">
    <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#${tabId}-tasks" type="button">Tasks</button>
  </li>
  <li class="nav-item" role="presentation">
    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#${tabId}-pg" type="button">Progress</button>
  </li>
</ul>
<div class="tab-content pt-3">
  <div class="tab-pane fade show active" id="${tabId}-tasks">
    <p class="text-muted small mb-2">Generates then runs all tasks for this phase, in order.</p>
    <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
      ${genRunBtnHtml}
      ${stopBtnHtml}
      ${statusHtml}
    </div>
    ${taskGroup("fa-puzzle-piece", "Plugins", "phase-plugins-area", plContent)}
    ${taskGroup(
      "fa-database",
      "Data model",
      "phase-data-model-area",
      dmContent
    )}
    ${taskGroup("fa-layer-group", "Features", "phase-features-area", ftContent)}
  </div>
  <div class="tab-pane fade" id="${tabId}-pg">
    <div id="phase-progress-area-${idx}">${pgContent}</div>
  </div>
</div>`;

  return backBtn + header + tabs;
};

// ── Panel wrapper (rendered on page load) ─────────────────────────────────────

const phasesPanel = async (req, pt, projectId) => {
  const phaseParam = req.query?.phase;
  let innerHtml;
  if (phaseParam !== undefined) {
    const idx = parseInt(phaseParam);
    const phasesMd = await MetaData.findOne({ type: pt, name: "phases" });
    const phase = phasesMd?.body?.phases?.[idx];
    innerHtml = phase
      ? await phaseDetailHtml(phase, idx, pt, projectId)
      : await phasesHtml(req, pt, projectId);
  } else {
    innerHtml = await phasesHtml(req, pt, projectId);
  }
  return div({ class: "mt-2" }, div({ id: "phases-panel" }, innerHtml));
};

// ── Routes ────────────────────────────────────────────────────────────────────

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

const phase_card_html = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const projectId = body.project_id ?? req.query?.project_id;
  const idx = parseInt(body.idx);
  const phasesMd = await MetaData.findOne({ type: pt, name: "phases" });
  const phase = phasesMd?.body?.phases?.[idx];
  if (!phase) return { json: { error: "Phase not found" } };
  const [runState, { allDone, hasFeedback }, overviewState] = await Promise.all(
    [
      PhaseHelper.status(idx, pt),
      PhaseHelper.cardData(idx, pt),
      PhaseHelper.allPhasesStatus(pt),
    ]
  );
  return {
    json: {
      html: phaseCard(
        phase,
        idx,
        req,
        allDone,
        hasFeedback,
        projectId,
        runState,
        overviewState.active
      ),
    },
  };
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
  PhaseHelper.generateTasks(phase, req.user?.id, taskType, pt).catch((e) =>
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
  PhaseHelper.startTaskChain(
    idx,
    taskType,
    {
      user: req.user,
      __: req.__ || ((s) => s),
      getLocale: req.getLocale || (() => "en"),
    },
    pt
  ).catch((e) => console.error("run_phase_tasks error", e));
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
  const allTasks = await MetaData.find({ type: pt, name: "task" });
  const taskStillRunning = allTasks.some(
    (t) =>
      t.body?.phase_idx === idx &&
      (t.body?.task_type || "feature") === taskType &&
      t.body?.status === "Running"
  );
  return { json: { success: true, taskStillRunning } };
};

// Whether every phase before idx is fully done (same "allDone" definition
// phasesHtml uses for the card's done-badge) — the server-side source of
// truth behind the "earlier phases aren't finished yet" confirm dialog.
const prev_phases_status = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  const phasesMd = await MetaData.findOne({ type: pt, name: "phases" });
  const phases = phasesMd?.body?.phases || [];
  const incompletePhases = [];
  for (let i = 0; i < idx; i++) {
    const { allDone } = await PhaseHelper.cardData(i, pt);
    if (!allDone) incompletePhases.push(phases[i]?.name || `Phase ${i + 1}`);
  }
  return {
    json: {
      allPreviousDone: incompletePhases.length === 0,
      incompletePhases,
    },
  };
};

const run_all_phase_tasks = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  await PhaseHelper.start(idx, pt, {
    user: req.user,
    __: req.__ || ((s) => s),
    getLocale: req.getLocale || (() => "en"),
  });
  return { json: { success: true } };
};

const stop_phase_chain = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  await PhaseHelper.stop(idx, pt);
  return { json: { success: true } };
};

const phase_chain_status = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const idx = parseInt(body.idx);
  return { json: await PhaseHelper.status(idx, pt) };
};

const run_all_phases = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  await PhaseHelper.startAll(pt, req.user?.id, {
    user: req.user,
    __: req.__ || ((s) => s),
    getLocale: req.getLocale || (() => "en"),
  });
  return { json: { success: true } };
};

const stop_all_phases = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const allChain = await MetaData.findOne({
    type: pt,
    name: "all_phases_chain",
  });
  if (!allChain) return { json: { success: true } };
  // Stopping the phase currently driving it stops all_phases_chain too.
  await PhaseHelper.stop(allChain.body.phaseIdx, pt);
  return { json: { success: true } };
};

const phases_overview_status = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const state = await PhaseHelper.allPhasesStatus(pt);
  return { json: state };
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
  await PhaseHelper.deleteTypeTasks(idx, pt, taskType);
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

const cancel_generating_phase_tasks = async (
  table_id,
  vn,
  config,
  body,
  { req }
) => {
  const { task_type } = body;
  const idx = parseInt(body.idx, 10);
  const pt = getPt(body, req);
  await PhaseHelper.cancelGenerating(idx, pt, task_type);
  return { json: { success: true } };
};

const prev_section_status = async (table_id, vn, config, body, { req }) => {
  const { task_type } = body;
  const idx = parseInt(body.idx, 10);
  if (task_type !== "data_model" && task_type !== "feature")
    return { json: { hasIncompleteTasks: false, incompleteSections: [] } };
  const pt = getPt(body, req);
  const prevTypes =
    task_type === "data_model" ? ["plugin"] : ["plugin", "data_model"];
  const allTasks = await MetaData.find({ type: pt, name: "task" });
  const phaseTasks = allTasks.filter((t) => t.body?.phase_idx === idx);
  const incompleteSections = prevTypes.filter((prevType) =>
    tasksOfType(phaseTasks, prevType).some(
      (t) => (t.body.status || "To do") !== "Done"
    )
  );
  return {
    json: {
      hasIncompleteTasks: incompleteSections.length > 0,
      incompleteSections,
    },
  };
};

// ── Phase-list & requirement CRUD routes ───────────────────────────────────

const gen_phases = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  PhaseHelper.generatePhases(req.user?.id, pt).catch((e) =>
    getState().log(1, "gen_phases error", e)
  );
  return { json: { success: true } };
};

const phases_status = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const generating = await MetaData.findOne({
    type: pt,
    name: "generating_phases",
  });
  const errorMd = await MetaData.findOne({
    type: pt,
    name: "phases_gen_error",
  });
  // report the error once, then clear it so it doesn't reappear on a later poll
  if (errorMd) await errorMd.delete();
  return {
    json: {
      generating: !!generating,
      error: errorMd?.body?.message || null,
    },
  };
};

const del_all_phases = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  await PhaseHelper.deleteAllPhases(pt);
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

const save_requirement = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const { requirement, priority } = body;
  const result = await PhaseHelper.saveRequirement(
    parseInt(body.phaseIdx),
    pt,
    parseInt(body.reqIdx),
    requirement,
    priority,
    req.user?.id
  );
  return { json: result };
};

const delete_requirement = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const result = await PhaseHelper.deleteRequirement(
    parseInt(body.phaseIdx),
    pt,
    parseInt(body.reqIdx),
    req.user?.id
  );
  return { json: result };
};

const dismiss_stale_notice = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  await PhaseHelper.clearStaleMarker(parseInt(body.phaseIdx), pt);
  return { json: { success: true } };
};

const phase_routes = {
  gen_phases,
  phases_status,
  phases_html,
  phase_detail_html,
  phase_card_html,
  generate_phase_tasks,
  phase_tasks_status,
  phase_tasks_html,
  run_phase_tasks,
  stop_phase_tasks,
  phase_run_status,
  prev_phases_status,
  run_all_phase_tasks,
  stop_phase_chain,
  phase_chain_status,
  run_all_phases,
  stop_all_phases,
  phases_overview_status,
  del_phase_type_tasks,
  del_all_phases,
  phase_progress_html,
  del_phase_progress,
  get_requirement_form,
  save_requirement,
  delete_requirement,
  dismiss_stale_notice,
  prev_section_status,
  cancel_generating_phase_tasks,
};

module.exports = {
  phasesPanel,
  phasesStaticScript,
  phase_routes,
};
