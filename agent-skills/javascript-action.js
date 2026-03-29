const GenerateJsAction = require("../actions/generate-js-action");
const Trigger = require("@saltcorn/data/models/trigger");

class GenerateJsActionSkill {
  static skill_name = "Javascript Action";

  get skill_label() {
    return "Javascript Action";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt() {
    return await GenerateJsAction.system_prompt();
  }

  get userActions() {
    return {
      async build_copilot_js_action(input) {
        const name = input.name;
        const code = input.code;
        const description = input.description;
        const when_trigger = input.when_trigger;
        const trigger_table = input.trigger_table || input.table_name;
        const user = input.user;
        if (!name || !code) {
          return {
            notify:
              "Both name and code are required to generate a Javascript action.",
          };
        }
        const result = await GenerateJsAction.execute(
          {
            action_javascript_code: code,
            action_name: name,
            action_description: description,
            when_trigger,
            trigger_table,
          },
          { user },
        );
        // Always output canonical field names
        return {
          notify: result?.postExec || `Javascript action saved: ${name}`,
          name,
          code,
          description,
        };
      },
    };
  }

  provideTools = async () => {
    // log a trigger
    console.log(await Trigger.findOne({ name: "treops" }));
    const parameters = GenerateJsAction.json_schema();
    console.log("£££££ Providing Javascript Action tool to agent", {
      parameters,
    });
    return {
      type: "function",
      process: async (input) => {
        console.log({ input });
        // Map all possible variants to canonical names, but only output canonical
        const name = input.name;
        const code = input.code;
        const description = input.description;
        if (!name || !code) {
          return "Both name and code are required to generate a Javascript action.";
        }
        return [
          `Ready to create Javascript action: ${name}.`,
          description ? `Description: ${description}` : null,
          `Code preview:\n\n${code}`,
        ]
          .filter(Boolean)
          .join("\n");
      },
      postProcess: async ({ tool_call }) => {
        // Map all possible variants to canonical names, but only output canonical
        const input = tool_call.input || {};
        const name =
          input.name ||
          input.input_name ||
          input.action_name ||
          input.js_action_name ||
          input.actionName ||
          input.jsName ||
          input.table_name;
        const code =
          input.code ||
          input.js_code ||
          input.js_action_code ||
          input.action_javascript_code ||
          input.actionCode;
        const description =
          input.description ||
          input.action_description ||
          input.js_action_description;
        if (!name || !code) {
          return {
            stop: true,
            add_response:
              "Cannot create Javascript action: name and code are required.",
          };
        }
        // Always output canonical field names in user action
        return {
          stop: true,
          add_response: `<pre><b>${name}</b>\n${description ? description + "\n" : ""}${code}</pre>`,
          add_user_action: {
            name: "build_copilot_js_action",
            type: "button",
            label: `Save Javascript action (${name})`,
            input: { name, code, description },
          },
        };
      },
      function: {
        name: GenerateJsAction.function_name,
        description: GenerateJsAction.description,
        parameters: {
          type: "object",
          required: ["name", "code"],
          properties: {
            name: {
              type: "string",
              description: "Name of the Javascript action.",
            },
            code: {
              type: "string",
              description: "Javascript code for the action.",
            },
            description: {
              type: "string",
              description: "Description of the action.",
            },
            when_trigger: {
              type: "string",
              description: "When the action should trigger.",
            },
            trigger_table: {
              type: "string",
              description: "Table to trigger the action.",
            },
          },
        },
      },
    };
  };
}

module.exports = GenerateJsActionSkill;
