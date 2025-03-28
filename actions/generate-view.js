const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Page = require("@saltcorn/data/models/page");
const View = require("@saltcorn/data/models/view");
const Table = require("@saltcorn/data/models/table");
const User = require("@saltcorn/data/models/user");
const Field = require("@saltcorn/data/models/field");
const { apply, removeAllWhiteSpace } = require("@saltcorn/data/utils");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");
const { a, pre, script, div, code } = require("@saltcorn/markup/tags");
const {
  fieldProperties,
  getPromptFromTemplate,
  splitContainerStyle,
  containerHandledStyles,
  walk_response,
} = require("../common");

class GenerateView {
  static title = "Generate View";
  static function_name = "generate_view";
  static description = "Generate view";

  static async json_schema() {
    const tables = Table.find({});
    //const viewtypes = getState().
    const roles = await User.get_roles();
    return {
      type: "object",
      required: ["name", "viewpattern", "table"],
      properties: {
        name: {
          description: `The name of the view, this should be a short name which is part of the url. `,
          type: "string",
        },
        viewpattern: {
          description: `The type of view to generate. Show for a read-only view of a single table row, 
List for a tabular grid view of many rows, Edit for forms for editing a single row, Feed to repeatedly show 
another view (typically a Show view), Filter for selecting a subset of rows based on field values
to be shown in another view (typically List or Feed views) on the same page.`,
          type: "string",
          enum: ["Show", "List", "Edit", "Filter", "Feed"],
        },
        table: {
          description: "Which table is this a view on",
          type: "string",
          enum: tables.map((t) => t.name),
        },
        min_role: {
          description:
            "The minimum role needed to access the view. For vies accessible only by admin, use 'admin', pages with min_role 'public' is publicly accessible and also available to all users",
          type: "string",
          enum: roles.map((r) => r.role),
        },
      },
    };
  }
  static async system_prompt() {
    return `Use the generate_view tool to generate a view.`;
  }

  static async follow_on_generate_list({ name, viewpattern, table }) {
    const tbl = Table.findOne({ name: table });
    const triggers = Trigger.find({
      when_trigger: { or: ["API call", "Never"] },
    }).filter(
      (tr) =>
        tr.description && tr.name && (!tr.table_id || tr.table_id === tbl.id)
    );
    const own_show_views = await View.find_table_views_where(
      tbl.id,
      ({ state_fields, viewtemplate, viewrow }) =>
        state_fields.some((sf) => sf.name === "id")
    );
    const prompt = `Now generate the structure of the ${name} ${viewpattern} view on the ${table} table`;
    const response_schema = {
      type: "object",
      properties: {
        columns: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "object",
                description: "Show a field value",
                //required: ["name", "title", "min_role"],
                properties: {
                  coltype: { const: "Field" },
                  fieldSpec: {
                    anyOf: tbl.fields.map((f) => ({
                      type: "object",
                      properties: {
                        fieldname: { const: f.name },
                        fieldview: {
                          type: "string",
                          enum: Object.keys(f.type?.fieldviews || {}),
                        },
                      },
                    })),
                  },
                },
              },
              {
                type: "object",
                description: "Action button",
                //required: ["name", "title", "min_role"],
                properties: {
                  coltype: { const: "Action" },
                  label: { type: "string", description: "The button label" },
                  style: {
                    type: "string",
                    description: "The bootstrap button class",
                    enum: [
                      "btn-primary",
                      "btn-secondary",
                      "btn-outline-primary",
                      "btn-outline-secondary",
                    ],
                  },
                  action: {
                    anyOf: [
                      {
                        type: "object",
                        description: "Delete this row form the database table",
                        properties: {
                          action_name: { const: "Delete" },
                        },
                      },
                      ...triggers.map((tr) => ({
                        type: "object",
                        description: tr.description,
                        properties: {
                          action_name: { const: tr.name },
                        },
                      })),
                    ],
                  },
                },
              },
              {
                type: "object",
                description: "a link to a different view on the same table",
                properties: {
                  coltype: { const: "View link" },
                  label: { type: "string", description: "The view label" },
                  style: {
                    type: "string",
                    description:
                      "Link for a normal link, or for a button, the bootstrap button class",
                    enum: [
                      "Link",
                      "btn-primary",
                      "btn-secondary",
                      "btn-outline-primary",
                      "btn-outline-secondary",
                    ],
                  },
                  view: {
                    type: "string",
                    description: "the view to link to",
                    enum: own_show_views.map((v) => v.name),
                  },
                },
              },
            ],
          },
        },
      },
    };
  }

  static async follow_on_generate(properties) {
    switch (properties.viewpattern) {
      case "List":
        return GenerateView.follow_on_generate(properties);

      default:
        break;
    }
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
              description: "Position items vertically, each above the next",
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
              description: "An element containing HTML",
              properties: {
                type: { const: "blank" },
                isHTML: { const: true },
                contents: {
                  type: "string",
                  description: "The HTML contents of this element",
                },
              },
            },
            {
              type: "object",
              required: ["type", "contents"],
              description: "An element containing text",
              properties: {
                type: { const: "blank" },
                contents: {
                  type: "string",
                  description: "The plain text contents of this element",
                },
                style: {
                  type: "object",
                  description:
                    "Some CSS properties that can be applied to the text element",
                  properties: {
                    "font-size": {
                      type: "string",
                      description:
                        "CSS size identifier, for example 12px or 2rem",
                    },
                    color: {
                      type: "string",
                      description:
                        "CSS color specifier, for example #15d48a or rgb(0, 255, 0)",
                    },
                  },
                },
                textStyle: {
                  type: "array",
                  description: "The style to apply to the text",
                  items: {
                    type: "string",
                    description:
                      "h1-h6 to put in a header element. fst-italic for italic, text-muted for muted color, fw-bold for bold, text-underline for underline, small for smaller size, font-monospace for monospace font",
                    enum: [
                      "h1",
                      "h2",
                      "h3",
                      "h4",
                      "h5",
                      "h6",
                      "fst-italic",
                      "text-muted",
                      "fw-bold",
                      "text-underline",
                      "small",
                      "font-monospace",
                    ],
                  },
                },
              },
            },
            {
              type: "object",
              required: ["type", "contents"],
              description: "An container element that can set various styles",
              properties: {
                type: { const: "container" },
                contents: {
                  type: "object",
                  $ref: "#",
                },
                style: {
                  type: "string",
                  description:
                    "CSS properties to set on the container formatted as the html style attribute, with no CSS selector and separated by semi-colons. Example: color: #00ff00; margin-top: 5px",
                },
                customClass: {
                  type: "string",
                  description:
                    "Custom class to set. You can use bootstrap 5 utility classes here as bootstrap 5 is loaded",
                },
                htmlElement: {
                  type: "string",
                  description: "The HTML element to use for the container",
                  enum: [
                    "div",
                    "span",
                    "article",
                    "section",
                    "header",
                    "nav",
                    "main",
                    "aside",
                    "footer",
                  ],
                },
              },
            },
            {
              type: "object",
              description: "An image",
              properties: {
                type: { const: "image" },
                description: {
                  type: "string",
                  description: "A description of the contents of the image",
                },
                width: {
                  type: "integer",
                  description: "The width of the image in px",
                },
                height: {
                  type: "integer",
                  description: "The height of the image in px",
                },
              },
            },
          ],
        },
      },
    };
    return { response_schema, prompt: "foobar" };
  }

  static render_html(attrs, contents) {
    return (
      pre(code(JSON.stringify(attrs, null, 2))) +
      pre(code(JSON.stringify(walk_response(contents), null, 2)))
    );
  }
  static async execute({ name, title, description, min_role }, req, contents) {
    console.log("execute", name, contents);
    const roles = await User.get_roles();
    const min_role_id = roles.find((r) => r.role === min_role).id;
    await Page.create({
      name,
      title,
      description,
      min_role: min_role_id,
      layout: walk_response(contents),
    });
    return {
      postExec:
        "Page created. " +
        a(
          { target: "_blank", href: `/page/${name}`, class: "me-1" },
          "Go to page"
        ) +
        " | " +
        a(
          { target: "_blank", href: `/pageedit/edit/${name}`, class: "ms-1" },
          "Configure page"
        ),
    };
  }
}

module.exports = GenerateView;
