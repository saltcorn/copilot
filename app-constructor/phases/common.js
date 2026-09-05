const { getState } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");

// Small, pure/generic pieces used by PhaseHelper and index.js that aren't
// phase-run state or state-machine logic in their own right.

const emitChainUpdate = (idx) => {
  try {
    getState().emitDynamicUpdate(db.getTenantSchema(), {
      eval_js: `if(typeof copilotPhaseChainUpdate==='function')copilotPhaseChainUpdate(${idx});`,
    });
  } catch (_) {}
};

// Same as emitChainUpdate, but for the phases overview.
const emitOverviewUpdate = (pt) => {
  try {
    getState().emitDynamicUpdate(db.getTenantSchema(), {
      eval_js: `if(typeof copilotPhasesOverviewUpdate==='function')copilotPhasesOverviewUpdate();`,
    });
  } catch (_) {}
};

const tasksOfType = (tasks, taskType) =>
  tasks.filter((t) => (t.body.task_type || "feature") === taskType);

const allTasksDone = (tasks) =>
  tasks.length > 0 && tasks.every((t) => t.body?.status === "Done");

/** Depends_on names not yet done. With restrictTo, only those names can block. */
const unmetDeps = (depends_on, doneNames, restrictTo = null) =>
  (depends_on || []).filter((d) => {
    if (restrictTo && !restrictTo.has(d)) return false;
    return !doneNames.has(d);
  });

module.exports = {
  emitChainUpdate,
  emitOverviewUpdate,
  tasksOfType,
  allTasksDone,
  unmetDeps,
};
