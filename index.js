const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const { features } = require("@saltcorn/data/db/state");

const configuration_workflow = () =>
  new Workflow({
    steps: [],
  });

module.exports = {
  sc_plugin_api_version: 1,
  //configuration_workflow,
  dependencies: ["@saltcorn/large-language-model"],
  viewtemplates: features.workflows
    ? [require("./chat-copilot")]
    : [require("./action-builder"), require("./database-designer")],
  functions: features.workflows
    ? { copilot_generate_workflow: require("./workflow-gen") }
    : {},
};
