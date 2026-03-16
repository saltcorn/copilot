const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");

module.exports = {
  run: async ({ table, language, has_table }) => {
    if (language === "javascript" && has_table)
      return await getPromptFromTemplate("action-builder.txt", "");
  },
  isAsync: true,
  description: "Generate a builder layout",
  arguments: [
    { name: "prompt", type: "String" },
    { name: "mode", type: "String" },
    { name: "table", type: "String" },
  ],
};
