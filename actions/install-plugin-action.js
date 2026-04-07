// Core install logic. Deprecated chat-copilot format;
// the Agent Chat structure uses agent-skills/install-plugin.js instead.
const { getState } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const Plugin = require("@saltcorn/data/models/plugin");
const { div, span, a } = require("@saltcorn/markup/tags");

class InstallPluginAction {
  static title = "Install Plugin";
  static function_name = "install_plugin";
  static description = "Install a Saltcorn plugin from the store or from npm";

  static json_schema() {
    return {
      type: "object",
      properties: {
        plugin_name: {
          description:
            "Name of the plugin as it appears in the Saltcorn plugin store (e.g. 'maps', 'chart'). Use this when the user refers to a plugin by its friendly name.",
          type: "string",
        },
        npm_package: {
          description:
            "NPM package name to install directly (e.g. '@saltcorn/fullcalendar'). Use this when the user specifies an npm package name.",
          type: "string",
        },
      },
    };
  }

  static async system_prompt() {
    return (
      `Use the install_plugin function to install a Saltcorn plugin when the user asks to install, add, or enable a plugin. ` +
      `Prefer plugin_name (store lookup) when the user gives a human-readable name. ` +
      `Use npm_package when the user supplies an npm package name. ` +
      `Do not install the same plugin twice; check if it is already installed first.`
    );
  }

  static render_html({ plugin_name, npm_package }) {
    const label = plugin_name || npm_package;
    return div(
      { class: "mb-2" },
      span({ class: "badge bg-secondary me-2" }, "Plugin"),
      span({ class: "fw-bold" }, label)
    );
  }

  static async execute({ plugin_name, npm_package }, req) {
    const schema = db.getTenantSchema();

    // Resolve the plugin object
    let plugin;
    if (plugin_name) {
      plugin = await Plugin.store_by_name(plugin_name);
      if (!plugin) {
        return { postExec: `Plugin "${plugin_name}" not found in store.` };
      }
      // strip any existing DB id so we insert fresh
      delete plugin.id;
    } else if (npm_package) {
      plugin = new Plugin({
        name: npm_package,
        source: "npm",
        location: npm_package,
      });
    } else {
      return { postExec: "Please provide a plugin name or npm package." };
    }

    // Check already installed
    const existing = await Plugin.findOne({ name: plugin.name });
    if (existing) {
      return {
        postExec:
          `Plugin "${plugin.name}" is already installed. ` +
          a({ target: "_blank", href: `/plugins` }, "Manage plugins."),
      };
    }

    const force = schema === db.connectObj.default_schema;

    try {
      const msgs = await Plugin.loadAndSaveNewPlugin(
        plugin,
        force,
        undefined,
        (s) => s,
        true // allowUnsafeOnTenantsWithoutConfigSetting
      );
      const warnings = (msgs || []).map((m) => `<br>⚠ ${m}`).join("");
      return {
        postExec:
          `Plugin "${plugin.name}" installed successfully.${warnings} ` +
          a({ target: "_blank", href: `/plugins` }, "Manage plugins."),
      };
    } catch (e) {
      return { postExec: `Error installing plugin: ${e.message}` };
    }
  }
}

module.exports = InstallPluginAction;
