const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");

const configuration_workflow = () =>
  new Workflow({
    steps: [],
  });

module.exports = {
  sc_plugin_api_version: 1,
  //configuration_workflow,
  dependencies: ["@saltcorn/large-language-model"],
  viewtemplates: [require("./action-builder"), require("./database-designer")],
};
