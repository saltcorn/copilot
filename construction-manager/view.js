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
const { requirementsList, req_routes } = require("./requirements");
const { makeTaskList, task_routes } = require("./tasks");
const { errorList, error_routes } = require("./errors");
const { feedbackList, feedback_routes } = require("./feedback");
const { progressList, progress_routes } = require("./progress");
const { runNextTask } = require("./run_task");

const get_state_fields = () => [];

const sys_prompt = ``;

const makeSpecForm = async (req) => {
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });

  return new Form({
    blurb: "Provide a high-level description of the application",
    fields: [
      {
        name: "description",
        label: "Description",
        type: "String",
        fieldview: "textarea",
      },
      {
        name: "audience",
        label: "Audience",
        type: "String",
        fieldview: "textarea",
      },
      {
        name: "core_features",
        label: "Core features",
        type: "String",
        fieldview: "textarea",
      },
      {
        name: "out_of_scope",
        label: "Out of scope",
        type: "String",
        fieldview: "textarea",
      },
      {
        name: "visual_style",
        label: "Visual style",
        type: "String",
        fieldview: "textarea",
      },
    ],
    xhrSubmit: true,
    action: `/view/${encodeURIComponent(viewname)}/submit_specs`,
    values: spec?.body || {},
  });
};

const run = async (table_id, viewname, cfg, state, { req, res }) => {
  const specForm = await makeSpecForm(req);
  const reqList = await requirementsList(req);
  const taskList = await makeTaskList(req);
  const errList = await errorList(req);
  const feedbacks = await feedbackList(req);
  const progress = await progressList(req);
  const layout = {
    type: "tabs",
    ntabs: 5,
    tabId: "",
    titles: [
      "Specification",
      "Requirements",
      "Tasks",
      "Progress",
      "Feedback",
      "Errors",
    ],
    contents: [
      {
        type: "blank",
        contents: div({ class: "mt-2" }, renderForm(specForm, req.csrfToken())),
      },
      { type: "blank", contents: reqList },
      { type: "blank", contents: taskList },
      { type: "blank", contents: progress },
      { type: "blank", contents: feedbacks },
      { type: "blank", contents: errList },
    ],
    deeplink: true,
    tabsStyle: "Tabs",
  };
  return renderLayout({
    blockDispatch: {},
    layout,
    role: req.user?.role_id || 100,
    req,
    hints: getState().getLayout(req.user).hints || {},
  });
};

const submit_specs = async (table_id, viewname, config, body, { req, res }) => {
  const { _csrf, ...spec } = body;
  const existing = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });

  if (existing) await db.update("_sc_metadata", { body: spec }, existing.id);
  else
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "spec",
      user_id: req.user?.id || undefined,
      body: spec,
    });
};

const virtual_triggers = () => {
  return [
    {
      when_trigger: "Error",
      run: async (row) => {
        const existing = await MetaData.find({
          type: "CopilotConstructMgr",
          name: "error",
        });
        const messages = new Set(existing.map((m) => m.body?.error?.stack));
        if (!messages.has(row.stack))
          await MetaData.create({
            type: "CopilotConstructMgr",
            name: "error",
            body: { status: "New", error: row },
            user_id: null,
          });
      },
    },
    {
      when_trigger: "Often",
      run: async () => {       
        await runNextTask();
      },
    },
  ];
};

module.exports = {
  name: viewname,
  display_state_form: false,
  get_state_fields,
  tableless: true,
  singleton: true,
  run,
  routes: {
    submit_specs,
    ...req_routes,
    ...task_routes,
    ...error_routes,
    ...feedback_routes,
    ...progress_routes,
  },
  virtual_triggers,
};
