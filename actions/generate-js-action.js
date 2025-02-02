const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const Field = require("@saltcorn/data/models/field");
const { apply, removeAllWhiteSpace } = require("@saltcorn/data/utils");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");
const { a, pre, script, div } = require("@saltcorn/markup/tags");
const { fieldProperties } = require("../common");

class GenerateJsAction {
  static title = "Generate JavaScript Action";
  static function_name = "generate_js_action";
  static description = "Generate Javascript Action";

  static async json_schema() {
    return {
      type: "object",
      required: ["code", "action_name"],
      properties: {
        code: {
          description: "JavaScript code that constitutes the action",
          type: "string",
        },
        action_name: {
          description:
            "A human-readable label for the action. Can include spaces and mixed case, should be 1-5 words.",
          type: "string",
        },
        action_description: {
          description:
            "A description of the purpose of the action.",
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
}

module.exports = GenerateJsAction;
