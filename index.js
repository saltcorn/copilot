const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const { features } = require("@saltcorn/data/db/state");

module.exports = {
  sc_plugin_api_version: 1,
  dependencies: ["@saltcorn/large-language-model", "@saltcorn/agents"],
  viewtemplates: features.workflows
    ? [
        require("./chat-copilot"),
        require("./user-copilot"),
        require("./copilot-as-agent"),
      ]
    : [require("./action-builder"), require("./database-designer")],
  functions: features.workflows
    ? {
        copilot_generate_layout: require("./builder-gen.js"),
        copilot_generate_workflow: require("./workflow-gen"),
      }
    : {},
  actions: { copilot_generate_page: require("./page-gen-action") },
  exchange: {
    agent_skills: [
      require("./agent-skills/pagegen.js"),
      require("./agent-skills/database-design.js"),
      require("./agent-skills/workflow.js"),
      require("./agent-skills/viewgen.js"),
    ],
  },
};
