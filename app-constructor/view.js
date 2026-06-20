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
  style,
  h5,
  button,
  text_attr,
  i,
  p,
  a,
  form,
  textarea,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const renderLayout = require("@saltcorn/markup/layout");
const { viewname, projectType, BASE_TYPE } = require("./common");
const { showSchema, schema_routes, schemaStaticScript } = require("./schema");
const { task_routes } = require("./tasks");
const {
  errorList,
  doCreateErrorFixTask,
  error_routes,
  errTableStaticHtml,
} = require("./errors");
const { feedbackList, feedback_routes } = require("./feedback");
const { progress_routes } = require("./progress");
const { runNextTask } = require("./run_task");
const { researchPanel, research_routes } = require("./research");
const { phasesPanel, phasesStaticScript, phase_routes } = require("./phases");

const get_state_fields = () => [{ name: "project_id", type: "Integer" }];

const sys_prompt = ``;

const makeSpecForm = async (req, pt) => {
  const spec = await MetaData.findOne({
    type: pt,
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
    if (deps.hasPhases) items.push({ key: 'clearPhases', label: 'Phases' });
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

const projectListHtml = async (req) => {
  const projects = await MetaData.find(
    { type: BASE_TYPE, name: "project" },
    { orderBy: "id" }
  );
  const safeVn = JSON.stringify(viewname);
  const attrVn = safeVn.replace(/"/g, "&quot;");
  const table = mkTable(
    [
      {
        label: "Name",
        key: (p) =>
          a(
            { href: `/view/${encodeURIComponent(viewname)}?project_id=${p.id}` },
            text_attr(p.body.name || "Unnamed")
          ),
      },
      {
        label: "Description",
        key: (p) => text_attr(p.body.description || ""),
      },
      {
        label: "",
        key: (p) =>
          `<div class="dropdown">` +
          `<button class="btn btn-sm btn-outline-secondary" data-boundary="viewport" type="button" id="projDrop${p.id}" data-bs-toggle="dropdown" aria-haspopup="true" aria-expanded="false">` +
          `<i class="fas fa-ellipsis-h"></i></button>` +
          `<div class="dropdown-menu dropdown-menu-end" aria-labelledby="projDrop${p.id}">` +
          `<a class="dropdown-item" onclick="ajax_modal('/view/${encodeURIComponent(viewname)}/get_edit_project_form?id=${p.id}',{method:'POST'})">` +
          `<i class="fas fa-edit"></i>&nbsp;Edit</a>` +
          `<a class="dropdown-item" onclick="view_post(${attrVn},'duplicate_project',{id:${p.id}},function(){location.reload()})">` +
          `<i class="far fa-copy"></i>&nbsp;Duplicate</a>` +
          `<div class="dropdown-divider"></div>` +
          `<a class="dropdown-item" onclick="if(confirm('Delete project and all its data?'))view_post(${attrVn},'delete_project',{id:${p.id}})">` +
          `<i class="far fa-trash-alt"></i>&nbsp;Delete</a>` +
          `</div></div>`,
      },
    ],
    projects,
    { hover: true, class: "table-valign-middle" }
  );

  const body = projects.length
    ? table
    : p({ class: "text-muted" }, "No projects yet. Create one to get started.");

  return div(
    { class: "card shadow mt-0 card-max-full-screen" },
    `<span class="card-header"><h5 class="card-title">Your projects</h5></span>` +
    div(
      { class: "card-body", tabindex: "-1", style: "max-height:336px;overflow-y:auto;" },
      div({ id: "project-list-area" }, body)
    ) +
    div(
      { class: "card-footer" },
      button(
        {
          class: "btn btn-primary",
          onclick: `ajax_modal('/view/${encodeURIComponent(viewname)}/get_create_project_form', {method:'POST'})`,
        },
        "Create project"
      )
    )
  );
};

const projectIdWrapperScript = (projectId) =>
  script(
    domReady(`
(function(){
  var _vn=${JSON.stringify(viewname)};
  var _pid=${Number(projectId)};
  var _origVP=window.view_post;
  if(!_origVP||window._copilotPidWrapped)return;
  window._copilotPidWrapped=true;
  window.view_post=function(vn,action,data,cb,opts){
    if(vn===_vn){data=Object.assign({},data,{project_id:_pid});}
    return _origVP(vn,action,data,cb,opts);
  };
})();
`)
  );

const run = async (table_id, viewname, cfg, state, { req, res }) => {
  const projects = await MetaData.find({ type: BASE_TYPE, name: "project" });
  if (!state?.project_id) {
    const listHtml = await projectListHtml(req);
    return renderLayout({
      blockDispatch: {},
      layout: { type: "blank", contents: div({ class: "mt-2" }, listHtml) },
      role: req.user?.role_id || 100,
      req,
      hints: getState().getLayout(req.user).hints || {},
    });
  }

  const projectId = Number(state.project_id);
  const pt = projectType(projectId);

  // Look up project name for the selector
  const projectMd = projects.find((p) => p.id === projectId);
  const projectName = projectMd?.body?.name || "Project";
  const allProjectsUrl = `/view/${encodeURIComponent(viewname)}`;

  const specForm = await makeSpecForm(req, pt);
  const research = await researchPanel(req, pt);
  const phases = await phasesPanel(req, pt, projectId);
  const errList = await errorList(req);
  const feedbacks = await feedbackList(pt, projectId);
  const schema = await showSchema(req, pt);

  const tabDefs = [
    { id: "spec",     label: "Specification", content: div({ class: "mt-2" }, renderForm(specForm, req.csrfToken()), specDepsModal, specDepsScript(viewname)) },
    { id: "research", label: "Research",      content: research },
    { id: "phases",   label: "Phases",        content: div(phasesStaticScript, phases) },
    { id: "schema",   label: "Schema",        content: div(schemaStaticScript, div({ id: "schema-list-area" }, schema)) },
    { id: "feedback", label: "Feedback",      content: feedbacks },
    { id: "errors",   label: "Errors",        content: div(errTableStaticHtml, div({ id: "err-list-area" }, errList)) },
  ];

  const projectDropdownItems = projects
    .map((p) => {
      const cur = p.id === projectId;
      return `<li><a class="dropdown-item d-flex align-items-center justify-content-between${cur ? " active" : ""}"
        href="/view/${encodeURIComponent(viewname)}?project_id=${p.id}">
        <span>${text_attr(p.body?.name || "Unnamed")}</span>
        ${cur ? '<i class="fas fa-check" style="font-size:0.75rem"></i>' : ""}
      </a></li>`;
    })
    .join("");

  const sidebarIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0">
    <path fill-rule="evenodd" d="M6 5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2V5H6Zm4 0v14h8a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-8ZM3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6Z" clip-rule="evenodd"></path>
  </svg>`;

  const tabsHtml = `
<ul class="nav nav-tabs" role="tablist">
  ${tabDefs.map((t, idx) => `<li class="nav-item" role="presentation">
    <a class="nav-link${idx === 0 ? " active" : ""}" data-bs-toggle="tab"
       href="#copilot-tab-${t.id}" role="tab">${t.label}</a>
  </li>`).join("")}
  <li class="nav-item ms-auto d-flex align-items-center pe-2" aria-hidden="true">
    <div style="width:1px;height:1.25rem;background:var(--bs-border-color,#dee2e6)"></div>
  </li>
  <li class="nav-item dropdown">
    <a class="nav-link fw-semibold d-flex align-items-center gap-1"
       data-bs-toggle="dropdown" href="#" role="button" aria-expanded="false"
       style="color: inherit; min-width: 180px; padding-right: 0.5rem;">
      <span>${text_attr(projectName)}</span>
      <svg width="10" height="10" viewBox="0 0 10 16" fill="currentColor" style="flex-shrink:0;opacity:0.6"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.34151 0.747423C4.71854 0.417526 5.28149 0.417526 5.65852 0.747423L9.65852 4.24742C10.0742 4.61111 10.1163 5.24287 9.75259 5.6585C9.38891 6.07414 8.75715 6.11626 8.34151 5.75258L5.00001 2.82877L1.65852 5.75258C1.24288 6.11626 0.61112 6.07414 0.247438 5.6585C-0.116244 5.24287 -0.0741267 4.61111 0.34151 4.24742L4.34151 0.747423ZM0.246065 10.3578C0.608879 9.94139 1.24055 9.89795 1.65695 10.2608L5.00001 13.1737L8.34308 10.2608C8.75948 9.89795 9.39115 9.94139 9.75396 10.3578C10.1168 10.7742 10.0733 11.4058 9.65695 11.7687L5.65695 15.2539C5.28043 15.582 4.7196 15.582 4.34308 15.2539L0.343082 11.7687C-0.0733128 11.4058 -0.116749 10.7742 0.246065 10.3578Z"/></svg>
      <span class="flex-grow-1"></span>
      ${sidebarIcon}
    </a>
    <ul class="dropdown-menu dropdown-menu-end shadow-sm" style="min-width:220px">
      <li><span class="dropdown-header text-uppercase" style="font-size:0.7rem;letter-spacing:0.05em">Projects</span></li>
      ${projectDropdownItems}
      <li><hr class="dropdown-divider my-1"></li>
      <li><a class="dropdown-item" href="${allProjectsUrl}">Manage projects</a></li>
    </ul>
  </li>
</ul>
<div class="tab-content mt-3">
  ${tabDefs.map((t, idx) => `<div class="tab-pane fade${idx === 0 ? " show active" : ""}"
    id="copilot-tab-${t.id}" role="tabpanel">${t.content}</div>`).join("")}
</div>
<script>
(function(){
  var hash = location.hash;
  if (hash) {
    var el = document.querySelector('.nav-tabs a[href="' + hash + '"]');
    if (el) bootstrap.Tab.getOrCreateInstance(el).show();
  }
  document.querySelectorAll('.nav-tabs a[data-bs-toggle="tab"]').forEach(function(el){
    el.addEventListener('shown.bs.tab', function(e){
      history.replaceState(null, null, e.target.getAttribute('href'));
    });
  });
})();
</script>`;

  return projectIdWrapperScript(projectId) + tabsHtml;
};

const check_spec_dependencies = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const pt = projectType(body.project_id ?? req.query?.project_id);
  const hasResearch =
    !!(await MetaData.findOne({ type: pt, name: "research_questions" })) ||
    !!(await MetaData.findOne({ type: pt, name: "research_answers" }));
  const hasRequirements =
    (await MetaData.find({ type: pt, name: "requirement" })).length > 0;
  const hasSchema = !!(await MetaData.findOne({ type: pt, name: "schema" }));
  const hasPhases =
    (await MetaData.find({ type: pt, name: "phase" })).length > 0;
  const hasTasks =
    (await MetaData.find({ type: pt, name: "task" })).length > 0;
  return {
    json: { hasResearch, hasRequirements, hasPhases, hasSchema, hasTasks },
  };
};

// Clears selected dependencies, saves the spec, and reloads — all in one round trip
const clear_and_save_spec = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const pt = projectType(body.project_id ?? req.query?.project_id);
  const {
    _csrf,
    project_id,
    clearResearch,
    clearRequirements,
    clearSchema,
    clearPhases,
    clearTasks,
    ...specBody
  } = body;
  if (clearResearch) {
    for (const name of ["research_questions", "research_answers"]) {
      const md = await MetaData.findOne({ type: pt, name });
      if (md) await md.delete();
    }
  }
  if (clearRequirements) {
    const rs = await MetaData.find({ type: pt, name: "requirement" });
    for (const r of rs) await r.delete();
  }
  if (clearSchema) {
    const md = await MetaData.findOne({ type: pt, name: "schema" });
    if (md) await md.delete();
  }
  if (clearTasks) {
    const ts = await MetaData.find({ type: pt, name: "task" });
    for (const t of ts) await t.delete();
  }
  if (clearPhases) {
    const ps = await MetaData.find({ type: pt, name: "phase" });
    for (const ph of ps) await ph.delete();
  }
  const existing = await MetaData.findOne({ type: pt, name: "spec" });
  if (existing)
    await db.update("_sc_metadata", { body: specBody }, existing.id);
  else
    await MetaData.create({
      type: pt,
      name: "spec",
      user_id: req.user?.id || undefined,
      body: specBody,
    });
  return { json: { reload_page: true } };
};

const submit_specs = async (table_id, viewname, config, body, { req, res }) => {
  const pt = projectType(body.project_id ?? req.query?.project_id);
  const { _csrf, project_id, ...spec } = body;
  const existing = await MetaData.findOne({ type: pt, name: "spec" });

  if (existing) await db.update("_sc_metadata", { body: spec }, existing.id);
  else
    await MetaData.create({
      type: pt,
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

// Creates fix tasks for application errors recorded while self-healing was off.
const healPendingErrors = async () => {
  const settings = await MetaData.findOne({
    type: BASE_TYPE,
    name: "settings",
  });
  if (!settings?.body?.error_heal) return;
  const spec = await MetaData.findOne({
    type: BASE_TYPE,
    name: "spec",
  });
  if (!spec) return;
  const errors = await MetaData.find({
    type: BASE_TYPE,
    name: "error",
  });
  for (const err of errors) {
    if (
      err.body.source !== "application" ||
      err.body.fix_task_created ||
      err.body.cannot_fix_reason
    )
      continue;
    doCreateErrorFixTask(err, null).catch((e) =>
      console.error("healPendingErrors failed", e)
    );
  }
};

const virtual_triggers = () => {
  return [
    {
      when_trigger: "Error",
      run: async (row) => {
        const existing = await MetaData.find({
          type: BASE_TYPE,
          name: "error",
        });
        // Allow a new record once a fix task exists — same error recurring after a fix gets another task.
        const unfixedDuplicate =
          row.stack &&
          existing.find(
            (m) =>
              m.body?.error?.stack === row.stack && !m.body?.fix_task_created
          );
        if (unfixedDuplicate) return;

        const source = (row.stack || "").includes("/app-constructor/")
          ? "constructor"
          : "application";

        const errorMd = await MetaData.create({
          type: BASE_TYPE,
          name: "error",
          body: { status: "New", error: row, source },
          user_id: null,
        });

        if (source === "application") {
          const settings = await MetaData.findOne({
            type: BASE_TYPE,
            name: "settings",
          });
          if (settings?.body?.error_heal) {
            const spec = await MetaData.findOne({
              type: BASE_TYPE,
              name: "spec",
            });
            if (spec)
              doCreateErrorFixTask(errorMd, null).catch((e) =>
                console.error("auto error fix task failed", e)
              );
          }
        }
      },
    },
    {
      when_trigger: "Often",
      run: async () => {
        await runNextTask();
        await healPendingErrors();
      },
    },
  ];
};

const get_create_project_form = (table_id, vn) => {
  const safeVn = JSON.stringify(vn);
  const html =
    div(
      { class: "mb-3" },
      `<label class="form-label">Name</label>` +
      `<input type="text" class="form-control" id="cpf-name" placeholder="My project">`
    ) +
    div(
      { class: "mb-3" },
      `<label class="form-label">Description</label>` +
      `<input type="text" class="form-control" id="cpf-desc" placeholder="Short description">` +
      `<div class="form-text">A brief summary of what this project is — not the full specification (that goes in the Specification tab).</div>`
    ) +
    div(
      { class: "d-flex gap-2" },
      button(
        {
          type: "button",
          class: "btn btn-primary",
          onclick: `view_post(${safeVn},'add_project',{name:document.getElementById('cpf-name').value.trim()||'New project',description:document.getElementById('cpf-desc').value.trim()},function(r){$('#scmodal').modal('hide');if(r&&r.redirect)location.href=r.redirect})`,
        },
        "Create project"
      ),
      button(
        { type: "button", class: "btn btn-secondary", "data-bs-dismiss": "modal" },
        "Cancel"
      )
    );
  return { html, title: "Create project" };
};

const get_edit_project_form = async (table_id, vn, config, body, { req }) => {
  const id = Number(body.id ?? req.query?.id);
  const project = await MetaData.findOne({ id, type: BASE_TYPE, name: "project" });
  if (!project) return { json: { error: "Project not found" } };
  const safeVn = JSON.stringify(vn);
  const safeName = JSON.stringify(project.body.name || "");
  const safeDesc = JSON.stringify(project.body.description || "");
  const html =
    div(
      { class: "mb-3" },
      `<label class="form-label">Name</label>` +
      `<input type="text" class="form-control" id="epf-name" value=${safeName}>`
    ) +
    div(
      { class: "mb-3" },
      `<label class="form-label">Description</label>` +
      `<input type="text" class="form-control" id="epf-desc" value=${safeDesc}>` +
      `<div class="form-text">A brief summary of what this project is — not the full specification (that goes in the Specification tab).</div>`
    ) +
    div(
      { class: "d-flex gap-2" },
      button(
        {
          type: "button",
          class: "btn btn-primary",
          onclick: `view_post(${safeVn},'update_project',{id:${id},name:document.getElementById('epf-name').value.trim(),description:document.getElementById('epf-desc').value.trim()},function(){$('#scmodal').modal('hide');location.reload()})`,
        },
        "Save"
      ),
      button(
        { type: "button", class: "btn btn-secondary", "data-bs-dismiss": "modal" },
        "Cancel"
      )
    );
  return { html, title: "Edit project" };
};

const update_project = async (table_id, vn, config, body, { req, res }) => {
  const id = Number(body.id);
  const project = await MetaData.findOne({ id, type: BASE_TYPE, name: "project" });
  if (!project) return { json: { error: "Project not found" } };
  const name = (body.name || "").trim() || project.body.name || "New project";
  const description = (body.description || "").trim();
  await db.update("_sc_metadata", { body: { ...project.body, name, description: description || undefined } }, id);
  return { json: { success: true } };
};

const duplicate_project = async (table_id, vn, config, body, { req, res }) => {
  const id = Number(body.id);
  const source = await MetaData.findOne({ id, type: BASE_TYPE, name: "project" });
  if (!source) return { json: { error: "Project not found" } };

  const copy = await MetaData.create({
    type: BASE_TYPE,
    name: "project",
    body: { ...source.body, name: `Copy of ${source.body.name || "project"}` },
    user_id: req.user?.id,
  });

  const srcType = projectType(id);
  const dstType = projectType(copy.id);
  const records = await MetaData.find({ type: srcType });
  for (const r of records) {
    await MetaData.create({ type: dstType, name: r.name, body: r.body, user_id: r.user_id });
  }

  return { json: { success: true } };
};

const add_project = async (table_id, vn, config, body, { req, res }) => {
  const name = (body.name || "").trim() || "New project";
  const description = (body.description || "").trim();
  const project = await MetaData.create({
    type: BASE_TYPE,
    name: "project",
    body: { name, ...(description ? { description } : {}) },
    user_id: req.user?.id,
  });
  return {
    json: {
      redirect: `/view/${encodeURIComponent(viewname)}?project_id=${project.id}`,
    },
  };
};

const delete_project = async (table_id, vn, config, body, { req, res }) => {
  const id = Number(body.id);
  const project = await MetaData.findOne({ id, type: BASE_TYPE, name: "project" });
  if (!project) return { json: { error: "Project not found" } };

  const pt = projectType(id);
  const allProjectData = await MetaData.find({ type: pt });
  for (const r of allProjectData) await r.delete();
  await project.delete();

  return { json: { reload_page: true } };
};

module.exports = {
  name: viewname,
  display_state_form: false,
  get_state_fields,
  tableless: true,
  singleton: true,
  run,
  routes: {
    get_create_project_form,
    get_edit_project_form,
    add_project,
    duplicate_project,
    update_project,
    delete_project,
    submit_specs,
    check_spec_dependencies,
    clear_and_save_spec,
    ...research_routes,
    ...task_routes,
    ...error_routes,
    ...feedback_routes,
    ...progress_routes,
    ...schema_routes,
    ...phase_routes,
  },
  virtual_triggers,
};
