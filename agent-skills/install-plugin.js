const InstallPluginAction = require("../actions/install-plugin-action");

class InstallPluginSkill {
  static skill_name = "Install Plugin";

  get skill_label() {
    return "Install Plugin";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  provideTools = () => {
    return {
      type: "function",
      process: async (input) => {
        const label = input.plugin_name || input.npm_package;
        if (!label) return "Please provide a plugin name or npm package.";
        return `Installing plugin: ${label}...`;
      },
      postProcess: async ({ tool_call, req }) => {
        const input = tool_call.input || {};
        const result = await InstallPluginAction.execute(input, req);
        return {
          stop: true,
          add_response: result.postExec || "Plugin installation complete.",
        };
      },
      function: {
        name: InstallPluginAction.function_name,
        description: InstallPluginAction.description,
        parameters: InstallPluginAction.json_schema(),
      },
    };
  };
}

module.exports = InstallPluginSkill;
