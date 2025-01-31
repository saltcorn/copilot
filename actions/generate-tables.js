const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const Field = require("@saltcorn/data/models/field");
const { apply, removeAllWhiteSpace } = require("@saltcorn/data/utils");
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
      required: ["tables"],
      properties: {
        tables: {
          type: "array",
          items: {
            type: "object",
            required: ["table_name", "fields"],
            properties: {
              table_name: {
                type: "string",
                description: "The name of the table",
              },
              fields: {
                type: "array",
                items: {
                  type: "object",
                  required: [
                    "name",
                    "label",
                    "type_and_configuration",
                    "importance",
                  ],
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
    return `Use the generate_tables tool to construct one or more database tables.

    Do not call this tool more than once. It should only be called one time. If you are
    building more than one table, use one call to the generate_tables tool to build all the 
    tables.

    The argument to generate_tables is an array of tables, each with an array of fields. You do not
    need to specify a primary key, a primary key called id with autoincrementing integers is
    autmatically generated. 

    The database already contains the following tables: 

    ${tableLines.join("\n\n")}

    `;
  }
  static render_html({ tables }) {
    const sctables = this.process_tables(tables);
    const mmdia = buildMermaidMarkup(sctables);
    return (
      pre({ class: "mermaid" }, mmdia) +
      script(`mermaid.run({querySelector: 'pre.mermaid'});`)
    );
  }

  static async execute({ tables }, req) {
    const sctables = this.process_tables(tables);
    for (const table of sctables) await Table.create(table.name);
    for (const table of sctables) {
      for (const field of table.fields) {
        field.table = Table.findOne({ name: table.name });
        await Field.create(field);
      }
    }
    Trigger.emitEvent("AppChange", `Tables created`, req?.user, {
      entity_type: "Table",
      entity_names: sctables.map((t) => t.name),
    });
  }

  static process_tables(tables) {
    return tables.map((table) => {
      return new Table({
        name: table.table_name,
        fields: table.fields.map((f) => {
          const { data_type, reference_table, ...attributes } =
            f.type_and_configuration;
          let type = data_type;
          const scattributes = { ...attributes, importance: f.importance };
          if (data_type === "ForeignKey") {
            type = `Key to ${reference_table}`;
            let refTableHere = tables.find(
              (t) => t.table_name === reference_table
            );
            if (refTableHere) {
              const strFields = refTableHere.fields.filter(
                (f) => f.type_and_configuration.data_type === "String"
              );
              if (strFields.length) {
                const maxImp = strFields.reduce(function (prev, current) {
                  return prev && prev.importance > current.importance
                    ? prev
                    : current;
                });
                if (maxImp) scattributes.summary_field = maxImp.name;
              }
            } else if (reference_table === "users") {
              scattributes.summary_field = "email";
            }
          }

          return {
            ...f,
            type,
            required: f.not_null,
            attributes: scattributes,
          };
        }),
      });
    });
  }
}

const EOL = "\n";
const indentString = (str, indent) => `${" ".repeat(indent)}${str}`;

const srcCardinality = (field) => (field.required ? "||" : "|o");

const buildTableMarkup = (table) => {
  const fields = table.getFields();
  const members = fields
    // .filter((f) => !f.reftable_name)
    .map((f) =>
      indentString(`${removeAllWhiteSpace(f.type_name)} ${f.name}`, 6)
    )
    .join(EOL);
  const keys = table
    .getForeignKeys()
    .map((f) =>
      indentString(
        `"${table.name}"${srcCardinality(f)}--|| "${f.reftable_name}" : "${
          f.name
        }"`,
        2
      )
    )
    .join(EOL);
  return `${keys}
  "${table.name}" {${EOL}${members}${EOL}  }`;
};

const buildMermaidMarkup = (tables) => {
  const lines = tables.map((table) => buildTableMarkup(table)).join(EOL);
  return `${indentString("erDiagram", 2)}${EOL}${lines}`;
};

module.exports = GenerateTables;
