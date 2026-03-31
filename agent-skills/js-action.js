const GenerateJsAction = require("../actions/generate-js-action");

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
        const trigger_table = input.trigger_table;
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
        return {
          notify: result?.postExec || `Javascript action saved: ${name}`,
          name,
          code,
          description,
        };
      },
    };
  }

  provideTools = () => {
    return {
      type: "function",
      process: async (input) => {
        console.log({ input });
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
        const input = tool_call.input || {};
        const name = input.name;
        const code = input.code;
        const description = input.description;
        const when_trigger = input.when_trigger;
        const trigger_table = input.trigger_table;
        if (!name || !code) {
          return {
            stop: true,
            add_response:
              "Cannot create Javascript action: name and code are required.",
          };
        }
        return {
          stop: true,
          add_response: `<pre><b>${name}</b>\n${description ? description + "\n" : ""}${code}</pre>`,
          add_user_action: {
            name: "build_copilot_js_action",
            type: "button",
            label: `Save Javascript action (${name})`,
            input: { name, code, description, when_trigger, trigger_table },
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
              enum: ["Insert", "Update", "Delete", "Daily", "Hourly", "Weekly"],
              description:
                "The event that fires this action. Only set if the user explicitly wants this trigger to run on a table row event or schedule. Leave unset if the user has not specified when it should run.",
            },
            trigger_table: {
              type: "string",
              description:
                "The table whose row events (Insert/Update/Delete) should fire this action. Only set if the user explicitly says this action should be triggered by changes to that table. Do NOT set just because the code reads data from a table.",
            },
          },
        },
      },
    };
  };
}

module.exports = GenerateJsActionSkill;
