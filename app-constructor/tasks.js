const MetaData = require("@saltcorn/data/models/metadata");
const { div, button, text_attr, textarea } = require("@saltcorn/markup/tags");
const { runTask, runNextTask } = require("./run_task");

const del_task = async (table_id, viewname, config, body, { req, res }) => {
  const r = await MetaData.findOne({
    id: body.id,
    type: "CopilotConstructMgr",
    name: "task",
  });

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
        const allTasks = await MetaData.find({
          type: "CopilotConstructMgr",
          name: "task",
        });
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
    runTask(body.id, { user: reqUser, __: req.__ }).catch((e) =>
      console.error("run_task error", e)
    );
    return { json: { success: true } };
  }
  runNextTask(true).catch((e) => console.error("run_task error", e));
  return { json: { success: true } };
};

const reset_task = async (table_id, viewname, config, body, { req, res }) => {
  const r = await MetaData.findOne({
    id: body.id,
    type: "CopilotConstructMgr",
    name: "task",
  });
  if (!r) throw new Error("Task not found");
  const { status, run_id, ...rest } = r.body;
  await r.update({ body: { ...rest, status: "To do" } });
  return { json: { success: true } };
};

const task_status = async (table_id, viewname, config, body, { req, res }) => {
  const ids = body.ids || [];
  const tasks = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "task",
  });
  const relevant = tasks.filter((t) => ids.includes(String(t.id)));
  const any_done = relevant.some((t) => t.body.status !== "Running");
  return { json: { any_done } };
};

const edit_task_desc = async (table_id, vname, config, body, { req, res }) => {
  const id = body.id || req.query?.id;
  const r = await MetaData.findOne({
    id: Number(id),
    type: "CopilotConstructMgr",
    name: "task",
  });
  if (!r) return { json: { error: "Task not found" } };
  const html =
    div(
      { class: "mb-3" },
      textarea(
        {
          id: "edit-task-desc-text",
          class: "form-control",
          rows: "10",
        },
        text_attr(r.body.description || "")
      )
    ) +
    div(
      { class: "d-flex gap-2 mt-3" },
      button(
        {
          type: "button",
          class: "btn btn-primary",
          onclick: `view_post(${JSON.stringify(vname)}, 'save_task_desc', {
  id: ${r.id},
  description: document.getElementById('edit-task-desc-text').value
}, () => {
  $('#scmodal').modal('hide');
  if (typeof copilotRefreshTasks === 'function') copilotRefreshTasks();
})`,
        },
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
    );
  return { html, title: `Edit: ${r.body.name || "task"}` };
};

const save_task_desc = async (table_id, vname, config, body, { req, res }) => {
  const r = await MetaData.findOne({
    id: Number(body.id),
    type: "CopilotConstructMgr",
    name: "task",
  });
  if (!r) throw new Error("Task not found");
  await r.update({ body: { ...r.body, description: body.description } });
  return { json: { success: true } };
};

const task_routes = {
  del_task,
  reset_task,
  edit_task_desc,
  save_task_desc,
  run_task,
  task_status,
};

module.exports = { task_routes };
