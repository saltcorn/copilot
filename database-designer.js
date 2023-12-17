const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const { findType } = require("@saltcorn/data/models/discovery");
const db = require("@saltcorn/data/db");
const Workflow = require("@saltcorn/data/models/workflow");
const { renderForm } = require("@saltcorn/markup");
const { div, script, domReady, pre, code } = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const { getCompletion, getPromptFromTemplate } = require("./common");
const { Parser } = require("node-sql-parser");
const parser = new Parser();
const { initial_config_all_fields } = require("@saltcorn/data/plugin-helper");

const get_state_fields = () => [];

const getForm = async ({ viewname, body, hasCode }) => {
  const fields = [
    {
      name: "prompt",
      label: "Database description",
      fieldview: "textarea",
      sublabel: "What would you like to design a database for?",
      type: "String",
    },

    ...(hasCode
      ? [
          {
            name: "code",
            label: "Generated code",
            fieldview: "textarea",
            attributes: { mode: "application/javascript" },
            input_type: "code",
          },
          {
            name: "basic_views",
            label: "Generate views",
            sublabel:
              "Also generate basic views (Show, Edit, List) for the generated tables",
            type: "Bool",
          },
        ]
      : []),
  ];
  const form = new Form({
    action: `/view/${viewname}`,
    fields,
    submitLabel: body?.prompt
      ? "Re-generate database design"
      : "Generate database design",
    additionalButtons: body?.prompt
      ? [
          {
            label: "Save this database permanently",
            onclick: "save_database(this)",
            class: "btn btn-primary",
            afterSave: true,
          },
        ]
      : undefined,
  });
  return form;
};

const js = (viewname) =>
  script(`
function save_database(that) {
  const form = $(that).closest('form');
  view_post("${viewname}", "save_database", $(form).serialize())
}
`);

const run = async (table_id, viewname, cfg, state, { res, req }) => {
  const form = await getForm({ viewname });
  return renderForm(form, req.csrfToken());
};

const runPost =
  (module_config) =>
  async (table_id, viewname, config, state, body, { req, res }) => {
    const form = await getForm({ viewname, body, hasCode: true });
    form.validate(body);

    form.hasErrors = false;
    form.errors = {};

    const fullPrompt = await getPromptFromTemplate(
      "database-designer.txt",
      form.values.prompt
    );
    const completion = await getCompletion(module_config, "SQL", fullPrompt);

    form.values.code = completion?.data?.choices?.[0]?.message?.content;
    res.sendWrap("Databse Designer Copilot", [
      renderForm(form, req.csrfToken()),
      js(viewname),
    ]);
  };

const save_database = async (table_id, viewname, config, body, { req }) => {
  const form = await getForm({ viewname, body, hasCode: true });
  form.validate(body);

  if (!form.hasErrors) {
    const genTables = [];
    const { tableList, ast } = parser.parse(form.values.code, {
      database: "PostgreSQL",
    });
    const tables_to_create = [];
    for (const { type, keyword, create_definitions, table } of ast) {
      if (type !== "create" || keyword !== "table" || !table?.length) continue;
      const tblName = table[0].table;

      const fields = [];
      for (const {
        column,
        definition,
        primary_key,
        reference_definition,
      } of create_definitions) {
        if (primary_key) continue;
        let type = findType(definition.dataType.toLowerCase());
        if (reference_definition)
          type = `Key to ${reference_definition.table[0].table}`;

        fields.push({
          name: column.column,
          type,
        });

        //onsole.log(fld, definition.dataType);
      }
      tables_to_create.push({ name: tblName, fields });
    }
    for (const table of tables_to_create) await Table.create(table.name);

    for (const tbl of tables_to_create) {
      const table = Table.findOne({ name: tbl.name });

      for (const field of tbl.fields) {
        field.table = table;
        //pick summary field
        if (field.type === "Key to users") {
          field.attributes = { summary_field: "email" };
        } else if (field.type.startsWith("Key to ")) {
          const reftable_name = field.type.replace("Key to ", "");
          const reftable = tables_to_create.find(
            (t) => t.name === reftable_name
          );
          const summary_field = reftable.fields.find(
            (f) => f.type === "String"
          );
          if (summary_field)
            field.attributes = { summary_field: summary_field.name };
          else field.attributes = { summary_field: "id" };
        }
        await Field.create(field);
      }
    }

    //todo: menu, show view

    if (form.values.basic_views)
      for (const { name } of tables_to_create) {
        const table = Table.findOne({ name });

        const list = await initial_view(table, "List");
        const edit = await initial_view(table, "Edit");
        const show = await initial_view(table, "Show");
        await View.update(
          {
            configuration: {
              ...list.configuration,
              view_to_create: `Edit ${name}`,
            },
          },
          list.id
        );
        await View.update(
          {
            configuration: {
              ...edit.configuration,
              view_when_done: `List ${name}`,
              destination_type: "View",
            },
          },
          edit.id
        );
      }

    return { json: { success: "ok", notify: `Database created` } };
  }
  return { json: { error: "Form incomplete" } };
};

const initial_view = async (table, viewtemplate) => {
  const configuration = await initial_config_all_fields(
    viewtemplate === "Edit"
  )({ table_id: table.id });
  //console.log(configuration);
  const name = `${viewtemplate} ${table.name}`;
  const view = await View.create({
    name,
    configuration,
    viewtemplate,
    table_id: table.id,
    min_role: 100,
  });
  return view;
};

module.exports = (config) => ({
  name: "Database Design Copilot",
  display_state_form: false,
  get_state_fields,
  tableless: true,
  singleton: true,
  run,
  runPost: runPost(config),
  routes: { save_database },
});
