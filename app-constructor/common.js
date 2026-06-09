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

module.exports = { viewname, tool_choice, TaskType };
