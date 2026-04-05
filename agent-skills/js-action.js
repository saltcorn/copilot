const GenerateJsAction = require("../actions/generate-js-action");
const { getPromptFromTemplate } = require("../common");

class GenerateJsActionSkill {
  static skill_name = "Javascript Action";

  get skill_label() {
    return "Javascript Action";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
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
        const name = input.name;
        const description = input.description;
        if (!name) {
          return "A name is required to generate a Javascript action.";
        }
        return [
          `Generating Javascript action: ${name}.`,
          description ? `Description: ${description}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      },
      postProcess: async ({ tool_call, generate }) => {
        const input = tool_call.input || {};
        const name = input.name;
        const description = input.description;
        const when_trigger = input.when_trigger;
        const trigger_table = input.trigger_table;
        if (!name) {
          return {
            stop: true,
            add_response: "Cannot create Javascript action: name is required.",
          };
        }

        const partPrompt = await getPromptFromTemplate(
          "action-builder.txt",
          "",
        );
        const contextParts = [
          description ? `Action description: ${description}` : null,
          when_trigger ? `Trigger: ${when_trigger}` : null,
          trigger_table ? `Table: ${trigger_table}` : null,
        ].filter(Boolean);

        const prompt = [
          partPrompt,
          contextParts.length ? contextParts.join("\n") : null,
          `Generate the JavaScript code for the action named "${name}" by calling the generate_js_code tool.`,
        ]
          .filter(Boolean)
          .join("\n\n");

        const answer = await generate(prompt, {
          tools: [
            {
              type: "function",
              function: {
                name: "generate_js_code",
                description: "Provide the JavaScript code for the action",
                parameters: {
                  type: "object",
                  required: ["code"],
                  properties: {
                    code: {
                      type: "string",
                      description: "JavaScript code for the action",
                    },
                  },
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "generate_js_code" },
          },
        });

        const tc = answer.getToolCalls()[0];
        const code = tc?.input?.code;

        if (!code) {
          return {
            stop: true,
            add_response: "Failed to generate JavaScript code for the action.",
          };
        }

        return {
          stop: true,
          add_response: GenerateJsAction.render_html({
            action_javascript_code: code,
            action_name: name,
            action_description: description,
            when_trigger,
            trigger_table,
          }),
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
          required: ["name"],
          properties: {
            name: {
              type: "string",
              description: "Name of the Javascript action.",
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
