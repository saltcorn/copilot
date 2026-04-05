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

const progressList = async (req) => {
  const errs = await MetaData.find(
    {
      type: "CopilotConstructMgr",
      name: "progress",
    },
    { orderBy: "written_at" },
  );
  const relDateFieldview = getState().types.Date.fieldviews.relative;
  if (errs.length) {
    return div(
      { class: "mt-2" },
      mkTable(
        [
          {
            label: "Title",
            key: (m) => relDateFieldview.run(m.written_at, req),
          },
          {
            label: "Progress",
            key: (m) => m.body.text,
          },

          {
            label: "Delete",
            key: (r) =>
              button(
                {
                  class: "btn btn-outline-danger btn-sm",
                  onclick: `view_post("${viewname}", "del_progress", {id:${r.id}})`,
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
          onclick: `view_post("${viewname}", "del_all_progress")`,
        },
        "Delete all",
      ),
    );
  } else {
    return div({ class: "mt-2" }, p("No progress"));
  }
};

const del_progress = async (table_id, viewname, config, body, { req, res }) => {
  const r = await MetaData.findOne({
    id: body.id,
  });

  if (!r) throw new Error("Progress not found");
  await r.delete();
  return { json: { reload_page: true } };
};
const del_all_progress = async (
  table_id,
  viewname,
  config,
  body,
  { req, res },
) => {
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "progress",
  });
  for (const r of rs) await r.delete();
  return { json: { reload_page: true } };
};

const progress_routes = { del_progress, del_all_progress };

module.exports = { progressList, progress_routes };
