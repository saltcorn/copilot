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

const get_rndid = () => {
  let characters = "0123456789abcdef";
  let str = "";
  for (let i = 0; i < 6; i++) {
    str += characters[Math.floor(Math.random() * 16)];
  }
  return str;
};

const snakeToPascal = (str) => {
  const snakeToCamel = (str) =>
    str.replace(/([-_]\w)/g, (g) => g[1].toUpperCase());
  let camelCase = snakeToCamel(str);
  let pascalCase = camelCase[0].toUpperCase() + camelCase.substr(1);
  return pascalCase;
};

const col2layoutSegment = (table, col) => {
  switch (col.coltype) {
    case "Field":
      return {
        type: "field",
        field_name: col.fieldSpec.fieldname,
        fieldview: col.fieldSpec.fieldview,
      };
    case "Action":
      console.log("action col", col);
      
      return {
        type: "action",
        action_name: col.action.action_name,
        action_style: col.style,
        action_label: col.label,
        rndid: get_rndid(),
      };
    case "View link":
      return {
        type: "view_link",
        view: col.view,
        relation: `.${table.name}`,
        link_style: col.style === "Link" ? "" : col.style,
        view_label: col.label,
      };

    default:
      break;
  }
  return {
    type: col.coltype.toLowerCase(),
  };
};

const segment2column = (seg) => {
  return {
    ...seg,
    type: snakeToPascal(seg.type),
  };
};

class GenerateView {
  static title = "Generate View";
  static function_name = "generate_view";
  static description = "Generate view";

  static async json_schema() {
    const tables = await Table.find({});
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
        return GenerateView.follow_on_generate_list(properties);
    }
  }

  static render_html(attrs, contents) {
    console.log(contents);

    return (
      pre(code(JSON.stringify(attrs, null, 2))) +
      (contents ? pre(code(JSON.stringify(JSON.parse(contents), null, 2))) : "")
    );
  }
  static async execute({ name, table, viewpattern, min_role }, req, contents) {
    console.log("execute", name, contents);
    const roles = await User.get_roles();
    const min_role_id = roles.find((r) => r.role === min_role).id;
    const tbl = Table.findOne({ name: table });
    const viewCfg = {
      table_id: tbl.id,
      name,
      viewtemplate: viewpattern,
      min_role: min_role_id,
      configuration: {},
    };
    switch (viewpattern) {
      case "List":
        const conts = JSON.parse(contents);
        const cols = conts.columns;
        const segments = cols.map((c) => col2layoutSegment(tbl, c));
        viewCfg.configuration.layout = {
          besides: segments.map((s) => ({ contents: s })),
        };
        viewCfg.configuration.columns = segments.map(segment2column);

        break;

      default:
        break;
    }
    console.log(viewCfg);

    await View.create(viewCfg);
    return {
      postExec:
        "View created. " +
        a(
          { target: "_blank", href: `/view/${name}`, class: "me-1" },
          "Go to view"
        ) +
        " | " +
        a(
          {
            target: "_blank",
            href: `/viewedit/config/${name}`,
            class: "ms-1",
          },
          "Configure view"
        ),
    };
  }
}

module.exports = GenerateView;
