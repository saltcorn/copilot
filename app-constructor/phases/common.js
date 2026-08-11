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

// LLM tool schema for phase planning - pure data, used by PhaseHelper.generatePhases.
const phases_tool = {
  type: "function",
  function: {
    name: "set_phases",
    description:
      "Set the development phases for the application. Each phase groups " +
      "a set of requirements that belong together and should be built in " +
      "the same iteration.",
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

module.exports = {
  emitChainUpdate,
  emitOverviewUpdate,
  tasksOfType,
  allTasksDone,
  unmetDeps,
  phases_tool,
};
