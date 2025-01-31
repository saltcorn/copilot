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
            a.copilot_description ||
            `${a.label}.${a.sublabel ? ` ${a.sublabel}` : ""}`,
          ...fieldProperties(a),
        };
      });
      return {
        type: "object",
        description: ty.copilot_description || ty.description,
        properties,
      };
    });
    fieldTypeCfg.push({
      type: "object",
      description:
        "A foreign key to a different table. This will reference the primary key on another table.",
      properties: {
        data_type: { const: "ForeignKey" },
        reference_table: {
          type: "string",
          description: "Name of the table being referenced",
        },
      },
    });
    fieldTypeCfg.push({
      type: "object",
      description:
        "A reference (file path) to a file on disk. This can be used for example to hold images or documents",
      properties: {
        data_type: { const: "File" },
      },
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
                    importance: {
                      type: "number",
                      description:
                        "How important is this field if only some fields can be displayed to the user. From 1 (least important) to 10 (most important).",
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  static async system_prompt() {
    const tableLines = [];
    const tables = await Table.find({});
    tables.forEach((table) => {
      const fieldLines = table.fields.map(
        (f) =>
          `  * ${f.name} with type: ${f.pretty_type.replace(
            "Key to",
            "ForeignKey referencing"
          )}.${f.description ? ` ${f.description}` : ""}`
      );
      tableLines.push(
        `${table.name}${
          table.description ? `: ${table.description}.` : "."
        } Contains the following fields:\n${fieldLines.join("\n")}`
      );
    });
    return `Use the generate_tables tool to construct one or more database tables. If you are
    building more than one table, use one call to the generate_tables tool to build all the 
    tables.

    The argument to generate_tables is an array of tables, each with an array of fields. You do not
    need to specify a primary key, a primary key called id with autoincrementing integers is
    autmatically generated. 

    The database already contains the following tables: 

    ${tableLines.join("\n\n")}
    
    `;
  }
}

module.exports = GenerateTables;
