const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const { apply } = require("@saltcorn/data/utils");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");
const { a, pre, script, div } = require("@saltcorn/markup/tags");
const { fieldProperties } = require("../common");

class GenerateTables {
  static title = "Generate Tables";
  static function_name = "generate_tables";
  static description = "Generate database tables";

  static async json_schema() {
    const types = Object.values(getState().types);
    const fieldTypeCfg = types.map((ty) => {
      const properties = {
        data_type: { const: ty.name },
      };
      const attrs = apply(ty.attributes, {}) || [];
      attrs.forEach((a) => {
        properties[a.name] = {
          description:
            a.copilot_description || `${a.label}.${a.sublabel ? ` ${a.sublabel}`|| ""}`,
          ...fieldProperties(a),
        };
      });
      return {
        type: "object",
        description: ty.copilot_description || ty.description,
        properties,
      };
    });
    return {
      type: "object",
      properties: {
        tables: {
          type: "array",
          items: {
            type: "object",
            properties: {
              table_name: {
                type: "string",
                description: "The name of the table",
              },
              fields: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                      description:
                        "The field name. Must be a valid identifier in both SQL and JavaScript, all lower case, snake_case (underscore instead of spaces)",
                    },
                    label: {
                      type: "string",
                      description:
                        "A human-readable label for the field. Should be short, 1-4 words, can have spaces and mixed case.",
                    },
                    not_null: {
                      type: "boolean",
                      description:
                        "A value is required and the field will be NOT NULL in the database",
                    },
                    unique: {
                      type: "boolean",
                      description:
                        "The value is unique - different rows must have different values for this field",
                    },

                    type_and_configuration: { anyOf: fieldTypeCfg },
                  },
                },
              },
            },
          },
        },
      },
    };
  }
}

module.exports = GenerateTables;
