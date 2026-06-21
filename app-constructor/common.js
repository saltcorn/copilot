const viewname = "Saltcorn AppConstructor";

const TaskType = Object.freeze({
  PLUGIN: "plugin",
  DATA_MODEL: "data_model",
  FEATURE: "feature",
});

const tool_choice = (tool_name) => ({
  tool_choice: {
    type: "function",
    function: {
      name: tool_name,
    },
  },
});

// Namespaced MetaData type for a specific project.
// All per-project records use this type so projects are fully isolated.
const projectType = (projectId) => `CopilotConstructMgr:${projectId}`;

// Top-level type used only for project list records themselves.
const BASE_TYPE = "CopilotConstructMgr";

module.exports = { viewname, tool_choice, TaskType, projectType, BASE_TYPE };
