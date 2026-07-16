const MetaData = require("@saltcorn/data/models/metadata");
const {
  div,
  button,
  text_attr,
  textarea,
  input,
  label,
  select,
  option,
  small,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const { runTask, runNextTask } = require("./run_task");
const { projectType } = require("./common");

const del_task = async (table_id, viewname, config, body, { req, res }) => {
  const r = await MetaData.findOne({ id: body.id, name: "task" });
  if (!r) throw new Error("Task not found");
  await r.delete();
  return {
    json: {
      eval_js:
        "if(typeof copilotRefreshTasks==='function')copilotRefreshTasks();",
    },
  };
};

const run_task = async (table_id, viewname, config, body, { req, res }) => {
  const reqUser = req?.user;
  if (body.id) {
    if (!body.force) {
      const task = await MetaData.findOne({ id: Number(body.id) });
      const deps = task?.body?.depends_on || [];
      if (deps.length > 0) {
        const pt = projectType(task.body.project_id);
        const allTasks = await MetaData.find({ type: pt, name: "task" });
        const doneNames = new Set(
          allTasks
            .filter((t) => t.body.status === "Done")
            .map((t) => t.body.name)
        );
        const unmet = deps.filter((d) => !doneNames.has(d));
        if (unmet.length > 0)
          return {
            json: { unmet_deps: unmet, task_name: task.body.name || "" },
          };
      }
    }
    runTask(body.id, { user: reqUser, __: req.__ }).catch((e) => {
      console.error("run_task error", e);
      try {
        const statusCode =
          e?.statusCode ||
          e?.lastError?.statusCode ||
          (e?.errors || [])[0]?.statusCode;
        const msg = statusCode
          ? `Task run failed: API error (HTTP ${statusCode})`
          : `Task run failed: ${String(e?.message || e)
              .replace(/\s+/g, " ")
              .slice(0, 120)}`;
        getState().emitDynamicUpdate(db.getTenantSchema(), {
          eval_js: `notifyAlert({type:'danger',text:${JSON.stringify(msg)}});`,
        });
      } catch (_) {}
    });
    return { json: { success: true } };
  }
  runNextTask(true).catch((e) => console.error("run_task error", e));
  return { json: { success: true } };
};

const reset_task = async (table_id, viewname, config, body, { req, res }) => {
  const r = await MetaData.findOne({ id: body.id, name: "task" });
  if (!r) throw new Error("Task not found");
  const { status, run_id, ...rest } = r.body;
  await r.update({ body: { ...rest, status: "To do" } });
  return { json: { success: true } };
};

const task_status = async (table_id, viewname, config, body, { req, res }) => {
  const pt = projectType(body.project_id);
  const ids = body.ids || [];
  const tasks = await MetaData.find({ type: pt, name: "task" });
  const relevant = tasks.filter((t) => ids.includes(String(t.id)));
  const any_done = relevant.some((t) => t.body.status !== "Running");
  const any_failed = relevant.some(
    (t) => !t.body.status || t.body.status === "To do"
  );
  return { json: { any_done, any_failed } };
};

/** Build the modal form HTML for edit (when task is provided) or create. */
const taskFormHtml = (
  vname,
  { task = null, phaseIdx, taskType, peerTasks = [] }
) => {
  const isEdit = !!task;
  const existingDeps = task?.body?.depends_on || [];
  const currentPriority = task?.body?.priority ?? 3;
  const pi = isEdit ? task.body.phase_idx : phaseIdx;
  const tt = isEdit ? task.body.task_type || "feature" : taskType;

  const depsSelect = select(
    {
      id: "task-form-deps",
      class: "form-select",
      multiple: true,
      size: Math.min(6, Math.max(3, peerTasks.length)),
    },
    ...peerTasks.map((t) =>
      option(
        {
          value: t.body.name,
          ...(existingDeps.includes(t.body.name) ? { selected: true } : {}),
        },
        t.body.name
      )
    )
  );

  const saveOnclick = `view_post(${JSON.stringify(vname)}, 'save_task', {
  id: ${isEdit ? task.id : -1},
  phaseIdx: ${pi},
  taskType: ${JSON.stringify(tt)},
  name: document.getElementById('task-form-name').value,
  description: document.getElementById('task-form-desc').value,
  priority: parseInt(document.getElementById('task-form-priority').value),
  depends_on: Array.from(document.getElementById('task-form-deps').selectedOptions).map(o => o.value)
}, () => {
  $('#scmodal').modal('hide');
  if (typeof _refreshPhaseArea === 'function') _refreshPhaseArea(${pi}, ${JSON.stringify(
    tt
  )});
})`;

  return (
    div(
      { class: "mb-3" },
      label({ class: "form-label fw-semibold", for: "task-form-name" }, "Name"),
      input({
        type: "text",
        id: "task-form-name",
        class: "form-control",
        value: text_attr(task?.body?.name || ""),
      })
    ) +
    div(
      { class: "mb-3" },
      label(
        { class: "form-label fw-semibold", for: "task-form-desc" },
        "Description"
      ),
      textarea(
        { id: "task-form-desc", class: "form-control", rows: 8 },
        text_attr(task?.body?.description || "")
      )
    ) +
    div(
      { class: "mb-3" },
      label(
        { class: "form-label fw-semibold", for: "task-form-priority" },
        "Priority"
      ),
      select(
        { id: "task-form-priority", class: "form-select" },
        ...[1, 2, 3, 4, 5].map((n) =>
          option(
            { value: n, ...(n === currentPriority ? { selected: true } : {}) },
            String(n)
          )
        )
      )
    ) +
    (peerTasks.length
      ? div(
          { class: "mb-4" },
          label(
            { class: "form-label fw-semibold", for: "task-form-deps" },
            "Dependencies"
          ),
          depsSelect,
          div(
            { class: "d-flex justify-content-between mt-1" },
            small(
              { class: "text-muted" },
              "Hold Ctrl / Cmd to select multiple."
            ),
            button(
              {
                type: "button",
                class: "btn btn-link btn-sm p-0 text-muted",
                onclick:
                  "Array.from(document.getElementById('task-form-deps')" +
                  ".options).forEach(o => o.selected = false)",
              },
              "Clear all"
            )
          )
        )
      : "") +
    div(
      { class: "d-flex gap-2 mt-3" },
      button(
        { type: "button", class: "btn btn-primary", onclick: saveOnclick },
        "Save"
      ),
      button(
        {
          type: "button",
          class: "btn btn-secondary",
          "data-bs-dismiss": "modal",
        },
        "Cancel"
      )
    )
  );
};

/** Modal form for editing an existing task (name, description, priority, deps). */
const get_task_form = async (table_id, vname, config, body, { req, res }) => {
  const id = body.id || req.query?.id;
  const r = await MetaData.findOne({ id: Number(id), name: "task" });
  if (!r) return { json: { error: "Task not found" } };

  const phaseIdx = r.body.phase_idx;
  const taskType = r.body.task_type || "feature";
  const pt = projectType(r.body.project_id);

  const allTasks = await MetaData.find({ type: pt, name: "task" });
  const peerTasks = allTasks.filter(
    (t) =>
      t.id !== r.id &&
      t.body?.phase_idx === phaseIdx &&
      (t.body?.task_type || "feature") === taskType
  );

  const html = taskFormHtml(vname, { task: r, peerTasks });
  return { html, title: `Edit: ${r.body.name || "task"}` };
};

/** Modal form for creating a new task in a given phase + task type. */
const get_new_task_form = async (
  table_id,
  vname,
  config,
  body,
  { req, res }
) => {
  const phaseIdx = parseInt(body.phaseIdx ?? req.query?.phaseIdx);
  const taskType = body.taskType ?? req.query?.taskType ?? "feature";
  const pt = projectType(body.project_id ?? req.query?.project_id);

  const allTasks = await MetaData.find({ type: pt, name: "task" });
  const peerTasks = allTasks.filter(
    (t) =>
      t.body?.phase_idx === phaseIdx &&
      (t.body?.task_type || "feature") === taskType
  );

  const html = taskFormHtml(vname, { phaseIdx, taskType, peerTasks });
  const label =
    taskType === "plugin"
      ? "Plugin"
      : taskType === "data_model"
      ? "Data model"
      : "Feature";
  return { html, title: `New ${label} task — Phase ${phaseIdx + 1}` };
};

/** Save handler for both edit (id >= 0) and create (id === -1). */
const save_task = async (table_id, vname, config, body, { req, res }) => {
  const {
    id,
    phaseIdx,
    taskType,
    name,
    description,
    priority,
    depends_on,
    project_id,
  } = body;
  const pt = projectType(project_id);

  const deps = Array.isArray(depends_on)
    ? depends_on
    : depends_on
    ? [depends_on]
    : [];

  if (Number(id) >= 0) {
    const r = await MetaData.findOne({ id: Number(id), name: "task" });
    if (!r) return { json: { error: "Task not found" } };
    await r.update({
      body: {
        ...r.body,
        name,
        description,
        priority: parseInt(priority),
        depends_on: deps,
      },
    });
  } else {
    await MetaData.create({
      type: pt,
      name: "task",
      body: {
        name,
        description,
        priority: parseInt(priority),
        depends_on: deps,
        status: "To do",
        phase_idx: parseInt(phaseIdx),
        task_type: taskType || "feature",
        project_id: Number(project_id),
      },
      user_id: req.user?.id,
    });
  }
  return { json: { success: true } };
};

const task_routes = {
  del_task,
  reset_task,
  get_task_form,
  get_new_task_form,
  save_task,
  run_task,
  task_status,
};

module.exports = { task_routes };
