const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const Field = require("@saltcorn/data/models/field");
const { apply, removeAllWhiteSpace } = require("@saltcorn/data/utils");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");
const { a, pre, script, div, code } = require("@saltcorn/markup/tags");
const { fieldProperties, getPromptFromTemplate } = require("../common");

class GenerateJsAction {
  static title = "Generate JavaScript Action";
  static function_name = "generate_js_action";
  static description = "Generate Javascript Action";

  static async json_schema() {
    return {
      type: "object",
      required: ["action_javascript_code", "action_name"],
      properties: {
        action_javascript_code: {
          description: "JavaScript code that constitutes the action",
          type: "string",
        },
        action_name: {
          description:
            "A human-readable label for the action. Can include spaces and mixed case, should be 1-5 words.",
          type: "string",
        },
        action_description: {
          description: "A description of the purpose of the action.",
          type: "string",
        },
        when_trigger: {
          description:
            "When the action should trigger. Optional, leave blank if unspecified or workflow will be run on button click",
          type: "string",
          enum: ["Insert", "Delete", "Update", "Daily", "Hourly", "Weekly"],
        },
        trigger_table: {
          description:
            "If the action trigger is Insert, Delete or Update, the name of the table that triggers the workflow",
          type: "string",
        },
      },
    };
  }
  static async system_prompt() {
    const partPrompt = await getPromptFromTemplate("action-builder.txt", "");
    return (
      `Use the generate_js_action to generate actions based on JavaScript code. ` +
      partPrompt
    );
  }
  static render_html({
    action_javascript_code,
    action_name,
    action_description,
    when_trigger,
    trigger_table,
  }) {
    return (
      div({class: "mb-3"},
        `${action_name}${when_trigger ? `: ${when_trigger}` : ""}${
          trigger_table ? ` on ${trigger_table}` : ""
        }`
      ) + pre(code(action_javascript_code))
    );
  }
  static async execute(
    {
      action_javascript_code,
      action_name,
      action_description,
      when_trigger,
      trigger_table,
    },
    req
  ) {
    let table_id;
    if (trigger_table) {
      const table = Table.findOne({ name: trigger_table });
      if (!table) return { postExec: `Table not found: ${trigger_table}` };
      table_id = table.id;
    }
    const trigger = await Trigger.create({
      name: action_name,
      when_trigger: when_trigger || "Never",
      table_id,
      action: "run_js_code",
      configuration: {code: action_javascript_code},
    });
    Trigger.emitEvent("AppChange", `Trigger ${trigger.name}`, req?.user, {
      entity_type: "Trigger",
      entity_name: trigger.name,
    });
    return {
      postExec:
        "Action created. " +
        a(
          { target: "_blank", href: `/actions/configure/${trigger.id}` },
          "Configure action."
        ),
    };
  }
}

module.exports = GenerateJsAction;
