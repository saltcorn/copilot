const { installed_plugins_list } = require("./prompts");
const Plugin = require("@saltcorn/data/models/plugin");

const viewname = "Saltcorn AppConstructor (experimental)";

const tool_choice = (tool_name) => ({
  tool_choice: {
    type: "function",
    function: {
      name: tool_name,
    },
  },
});

const get_installed_plugins_section = async () => {
  try {
    const allInstalled = await Plugin.find({});
    const installedNames = new Set(allInstalled.map((p) => p.name));
    return installed_plugins_list(installedNames);
  } catch (_) {
    return "";
  }
};

module.exports = { viewname, tool_choice, get_installed_plugins_section };
