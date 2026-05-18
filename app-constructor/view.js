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
const { showSchema, schema_routes } = require("./schema");
const { makeTaskList, task_routes } = require("./tasks");
const { errorList, error_routes } = require("./errors");
const { feedbackList, feedback_routes } = require("./feedback");
const { progressList, progress_routes } = require("./progress");
const { runNextTask } = require("./run_task");
const { makeTaskChart } = require("./taskchart");
const { researchPanel, research_routes } = require("./research");

const get_state_fields = () => [];

const sys_prompt = ``;

const makeSpecForm = async (req) => {
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });

  return new Form({
    blurb: "Describe the application you want to build",
    fields: [
      {
        name: "specification",
        label: "Specification",
        type: "String",
        fieldview: "textarea",
        attributes: { rows: 10 },
      },
    ],
    xhrSubmit: true,
    action: `/view/${encodeURIComponent(viewname)}/submit_specs`,
    values: spec?.body || {},
  });
};

const specDepsModal = `
<div class="modal fade" id="specDepsModal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">Specification changed</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <p>The following items were generated from the previous specification
        and may now be outdated. Select any you want to clear:</p>
        <div id="spec-deps-checks"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="specDepsKeepBtn">Save (keep all)</button>
        <button type="button" class="btn btn-primary" id="specDepsSaveBtn">Clear selected &amp; save</button>
      </div>
    </div>
  </div>
</div>`;

const specDepsScript = (vn) =>
  script(
    domReady(`
const _specVn = ${JSON.stringify(vn)};
const form = document.querySelector('form[action*="submit_specs"]');
if (!form) return;
const btn = form.querySelector('button[onclick*="ajaxSubmitForm"]');
if (!btn) return;

const doSaveSpec = () => {
  const data = {};
  for (const [k, v] of new FormData(form)) data[k] = v;
  view_post(_specVn, 'submit_specs', data);
};

// Remove Saltcorn's inline onclick and replace with our own handler
btn.removeAttribute('onclick');
btn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  view_post(_specVn, 'check_spec_dependencies', {}, (deps) => {
    const items = [];
    if (deps.hasResearch) items.push({ key: 'clearResearch', label: 'Research questions & answers' });
    if (deps.hasRequirements) items.push({ key: 'clearRequirements', label: 'Requirements' });
    if (deps.hasSchema) items.push({ key: 'clearSchema', label: 'Schema' });
    if (deps.hasTasks) items.push({ key: 'clearTasks', label: 'Tasks' });
    if (!items.length) { doSaveSpec(); return; }
    document.getElementById('spec-deps-checks').innerHTML = items.map((item) =>
      '<div class="form-check">' +
        '<input class="form-check-input" type="checkbox" id="dep_' + item.key +
        '" value="' + item.key + '" checked>' +
        '<label class="form-check-label" for="dep_' + item.key + '">' + item.label + '</label>' +
        '</div>'
    ).join('');
    new bootstrap.Modal(document.getElementById('specDepsModal')).show();
  });
});

document.getElementById('specDepsSaveBtn').addEventListener('click', () => {
  const modal = bootstrap.Modal.getInstance(document.getElementById('specDepsModal'));
  const clearData = {};
  document.querySelectorAll('#spec-deps-checks input:checked').forEach((cb) => {
    clearData[cb.value] = '1';
  });
  modal.hide();
  if (Object.keys(clearData).length) {
    const formData = {};
    for (const [k, v] of new FormData(form)) formData[k] = v;
    view_post(_specVn, 'clear_and_save_spec', Object.assign(formData, clearData));
  } else {
    doSaveSpec();
  }
});

document.getElementById('specDepsKeepBtn').addEventListener('click', () => {
  bootstrap.Modal.getInstance(document.getElementById('specDepsModal')).hide();
  doSaveSpec();
});
`)
  );

const run = async (table_id, viewname, cfg, state, { req, res }) => {
  const specForm = await makeSpecForm(req);
  const research = await researchPanel(req);
  const reqList = await requirementsList(req);
  const taskList = await makeTaskList(req);
  const errList = await errorList(req);
  const feedbacks = await feedbackList(req);
  const progress = await progressList(req);
  const taskChart = await makeTaskChart(req);
  const schema = await showSchema(req);
  const layout = {
    type: "tabs",
    ntabs: 5,
    tabId: "",
    lazyLoadViews: true,
    titles: [
      "Specification",
      "Research",
      "Requirements",
      "Schema",
      "Tasks",
      "Task chart",
      "Progress",
      "Feedback",
      "Errors",
    ],
    contents: [
      {
        type: "blank",
        contents: div(
          { class: "mt-2" },
          renderForm(specForm, req.csrfToken()),
          specDepsModal,
          specDepsScript(viewname)
        ),
      },
      { type: "blank", contents: research },
      { type: "blank", contents: div({ id: "req-list-area" }, reqList) },
      { type: "blank", contents: schema },
      { type: "blank", contents: div({ id: "task-list-area" }, taskList) },
      { type: "blank", contents: taskChart },
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

const check_spec_dependencies = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const hasResearch =
    !!(await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "research_questions",
    })) ||
    !!(await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "research_answers",
    }));
  const hasRequirements =
    (
      await MetaData.find({
        type: "CopilotConstructMgr",
        name: "requirement",
      })
    ).length > 0;
  const hasSchema = !!(await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "schema",
  }));
  const hasTasks =
    (
      await MetaData.find({
        type: "CopilotConstructMgr",
        name: "task",
      })
    ).length > 0;
  return { json: { hasResearch, hasRequirements, hasSchema, hasTasks } };
};

// Clears selected dependencies, saves the spec, and reloads — all in one round trip
const clear_and_save_spec = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const {
    _csrf,
    clearResearch,
    clearRequirements,
    clearSchema,
    clearTasks,
    ...specBody
  } = body;
  if (clearResearch) {
    for (const name of ["research_questions", "research_answers"]) {
      const md = await MetaData.findOne({ type: "CopilotConstructMgr", name });
      if (md) await md.delete();
    }
  }
  if (clearRequirements) {
    const rs = await MetaData.find({
      type: "CopilotConstructMgr",
      name: "requirement",
    });
    for (const r of rs) await r.delete();
  }
  if (clearSchema) {
    const md = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "schema",
    });
    if (md) await md.delete();
  }
  if (clearTasks) {
    const ts = await MetaData.find({
      type: "CopilotConstructMgr",
      name: "task",
    });
    for (const t of ts) await t.delete();
  }
  const existing = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  if (existing)
    await db.update("_sc_metadata", { body: specBody }, existing.id);
  else
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "spec",
      user_id: req.user?.id || undefined,
      body: specBody,
    });
  return { json: { reload_page: true } };
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
  return {
    json: {
      success: "ok",
      notify: "Specification saved",
      notify_type: "success",
    },
  };
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
    check_spec_dependencies,
    clear_and_save_spec,
    ...req_routes,
    ...research_routes,
    ...task_routes,
    ...error_routes,
    ...feedback_routes,
    ...progress_routes,
    ...schema_routes,
  },
  virtual_triggers,
};
