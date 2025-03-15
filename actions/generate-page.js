const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Page = require("@saltcorn/data/models/page");
const Table = require("@saltcorn/data/models/table");
const User = require("@saltcorn/data/models/user");
const Field = require("@saltcorn/data/models/field");
const { apply, removeAllWhiteSpace } = require("@saltcorn/data/utils");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");
const { a, pre, script, div, code } = require("@saltcorn/markup/tags");
const { fieldProperties, getPromptFromTemplate } = require("../common");

class GeneratePage {
  static title = "Generate Page";
  static function_name = "generate_page";
  static description = "Generate Page";

  static async json_schema() {
    const allPageNames = (await Page.find({})).map((p) => p.page);
    let namedescription = `The name of the page, this should be a short name which is part of the url. `;
    if (allPageNames.length) {
      namedescription += `These are the names of the exising pages: ${allPageNames.join(
        ", "
      )}. Do not pick a name that is identical but follow the same naming convention.`;
    }
    const roles = await User.get_roles();
    return {
      type: "object",
      required: ["name", "title", "min_role"],
      properties: {
        name: {
          description: namedescription,
          type: "string",
        },
        title: {
          description: "Page title, this is in the <title> tag.",
          type: "string",
        },
        description: {
          description:
            "A longer description that is not visible but appears in the page header and is indexed by search engines",
          type: "string",
        },
        min_role: {
          description:
            "The minimum role needed to access the page. For pages accessible only by admin, use 'admin', pages with min_role 'public' is publicly accessible and also available to all users",
          type: "string",
          enum: roles.map((r) => r.role),
        },
      },
    };
  }
  static async system_prompt() {
    return `Use the generate_page to generate a page.`;
  }
  static async follow_on_generate({ name }) {
    const prompt = `Now generate the contents of the ${name} page`;
    const response_schema = {
      type: "object",
      properties: {
        element: {
          anyOf: [
            {
              type: "object",
              description: "Position items next to each other in grid columns",
              //required: ["name", "title", "min_role"],
              properties: {
                besides: {
                  type: "array",
                  items: {
                    type: "object",
                    $ref: "#",
                  },
                },
                widths: {
                  type: "array",
                  items: {
                    type: "integer",
                    description:
                      "The width of each column 1-12. The sum of all columns must equal 12",
                  },
                },
              },
            },
            {
              type: "object",
              //required: ["name", "title", "min_role"],
              properties: {
                above: {
                  type: "array",
                  items: {
                    type: "object",
                    $ref: "#",
                  },
                },
              },
            },
            {
              type: "object",
              required: ["type", "isHTML", "contents"],
              description: "An element containing text or HTML",
              properties: {
                type: { const: "blank" },
                isHTML: {
                  type: "boolean",
                  description: "True if the contents contain HTML tags",
                },
                contents: {
                  type: "string",
                  description: "The text or HTML contents of this element",
                },
              },
            },
          ],
        },
      },
    };
    return { response_schema, prompt };
  }

  static render_html({
    action_javascript_code,
    action_name,
    action_description,
    when_trigger,
    trigger_table,
  }) {
    return (
      div(
        { class: "mb-3" },
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
      configuration: { code: action_javascript_code },
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

module.exports = GeneratePage;
