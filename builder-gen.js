const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");

module.exports = {
  run: async (prompt, mode, table) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 5000);
    });
    return {
      type: "blank",
      isHTML: true,
      contents: `<h4>Placeholder copilot response</h4>
      <blockquote class="blockquote"><p>${prompt}</p></blockquote>
      <pre>mode=${mode} table=${table}</pre>`,
      text_strings: [],
    };
  },
  isAsync: true,
  description: "Generate a builder layout",
  arguments: [
    { name: "prompt", type: "String" },
    { name: "mode", type: "String" },
    { name: "table", type: "String" },
  ],
};
