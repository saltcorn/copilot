const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const MetaData = require("@saltcorn/data/models/metadata");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const { findType } = require("@saltcorn/data/models/discovery");
const { save_menu_items } = require("@saltcorn/data/models/config");
const db = require("@saltcorn/data/db");
const WorkflowRun = require("@saltcorn/data/models/workflow_run");
const {
  localeDateTime,
  renderForm,
  mkTable,
  post_delete_btn,
} = require("@saltcorn/markup");
const {
  div,
  script,
  domReady,
  pre,
  code,
  input,
  h4,
  style,
  h5,
  button,
  text_attr,
  i,
  p,
  span,
  small,
  form,
  textarea,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const renderLayout = require("@saltcorn/markup/layout");
const { viewname } = require("./common");

const errorList = async (req) => {
  const errs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "error",
  });
  if (errs.length) {
    return div(
      { class: "mt-2" },
      mkTable(
        [
          { label: "Status", key: (m) => m.body.status },
          {
            label: "Error",
            key: (m) => pre(JSON.stringify(m.body.error, null, 2)),
          },
          {
            label: "Delete",
            key: (r) =>
              button(
                {
                  class: "btn btn-outline-danger btn-sm",
                  onclick: `view_post("${viewname}", "del_err", {id:${r.id}})`,
                },
                i({ class: "fas fa-trash-alt" }),
              ),
          },
        ],
        errs,
      ),
      button(
        {
          class: "btn btn-outline-danger",
          onclick: `view_post("${viewname}", "del_all_errs")`,
        },
        "Delete all",
      ),
    );
  } else {
    return div({ class: "mt-2" }, p("No errors"));
  }
};

const del_err = async (table_id, viewname, config, body, { req, res }) => {
  const r = await MetaData.findOne({
    id: body.id,
  });

  if (!r) throw new Error("Error not found");
  await r.delete();
  return { json: { reload_page: true } };
};
const del_all_errs = async (table_id, viewname, config, body, { req, res }) => {
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "error",
  });
  for (const r of rs) await r.delete();
  return { json: { reload_page: true } };
};

const error_routes = { del_err, del_all_errs };

module.exports = { errorList, error_routes };
