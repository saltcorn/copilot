const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const db = require("@saltcorn/data/db");
const Workflow = require("@saltcorn/data/models/workflow");
const { renderForm } = require("@saltcorn/markup");
const { div, script, domReady, pre, code } = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const { getCompletion, getPromptFromTemplate } = require("./common");
const { Parser } = require("node-sql-parser");
const parser = new Parser();

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
            subabel:
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
    console.log(ast[0]);

    return { json: { success: "ok", notify: `Database created` } };
  }
  return { json: { error: "Form incomplete" } };
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
