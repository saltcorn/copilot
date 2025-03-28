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
    return { response_schema, prompt };
  }

  static async follow_on_generate(properties) {
    switch (properties.viewpattern) {
      case "List":
      default:
        return GenerateView.follow_on_generate(properties);
    }
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
