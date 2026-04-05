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
  a,
  textarea,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const renderLayout = require("@saltcorn/markup/layout");
const { viewname } = require("./common");
const { runTask, runNextTask } = require("./run_task");

const makeTaskChart = async (req) => {
  const rs = await MetaData.find(
    {
      type: "CopilotConstructMgr",
      name: "task",
    },
    { orderBy: "written_at" },
  );

  const taskIds = {};
  rs.forEach((md) => {
    taskIds[md.body.name] = md.id;
  });
  return div(
    pre({
      class: "mermaid",
      "mm-src": `flowchart LR
${rs.map((md) => `  task${md.id}["${md.body.name}"]`).join("\n")}
${rs.map((md) => md.body.depends_on.map((depon) => `  task${taskIds[depon]} --> task${md.id}`).join("\n")).join("\n")}
${rs
  .filter((m) => m.body.status === "Done")
  .map((md) => `  style task${md.id} fill:#777`)
  .join("\n")}

         `,
    }),
  );
};

module.exports = { makeTaskChart };
