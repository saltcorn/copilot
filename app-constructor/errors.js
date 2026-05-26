const Table = require("@saltcorn/data/models/table");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const Page = require("@saltcorn/data/models/page");
const Plugin = require("@saltcorn/data/models/plugin");
const MetaData = require("@saltcorn/data/models/metadata");
const { mkTable } = require("@saltcorn/markup");
const {
  div,
  script,
  domReady,
  pre,
  button,
  i,
  p,
  a,
  span,
  small,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const { viewname } = require("./common");
const { task_tool } = require("./tools");
const { getResearchAnswersText } = require("./research");
const {
  saltcorn_description,
  implementation_rules,
  fieldview_selection_rules,
  existing_tables_list,
  existing_entities_list,
  installed_plugins_list,
  available_plugins_list,
  task_planning_rules,
  task_planning_closing,
  research_answers_section,
} = require("./prompts");

const doCreateErrorFixTask = async (errorMd, userId) => {
  const currentMd = await MetaData.findOne({
    id: errorMd.id,
    type: "CopilotConstructMgr",
    name: "error",
  });
  if (!currentMd || currentMd.body.fixing) return;
  await currentMd.update({ body: { ...currentMd.body, fixing: true } });
  try {
    const spec = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "spec",
    });
    if (!spec) return;

    const tables = await Table.find({});
    const tableById = Object.fromEntries(tables.map((t) => [t.id, t.name]));
    const views = await View.find({});
    const triggers = await Trigger.find({});
    const pages = await Page.find({});
    const entitiesSection = existing_entities_list({
      views,
      triggers,
      pages,
      tableById,
    });
    const installedPlugins = await Plugin.find({});
    const installedNames = new Set(installedPlugins.map((p) => p.name));
    let storePlugins = [];
    try {
      storePlugins = await Plugin.store_plugins_available();
    } catch (_) {}
    const installedPluginsSection = installed_plugins_list(installedNames);
    const pluginsSection = available_plugins_list(storePlugins, installedNames);
    const allReqs = await MetaData.find({
      type: "CopilotConstructMgr",
      name: "requirement",
    });
    const researchText = await getResearchAnswersText();
    const errorText = JSON.stringify(errorMd.body.error, null, 2);

    // Include the affected entity's config so the planning LLM can name exact broken values.
    let entityConfigSection = "";
    const errorUrl = errorMd.body.error?.url || "";
    const mView = errorUrl.match(/\/view\/([^/?#]+)/);
    const mPage = errorUrl.match(/\/page\/([^/?#]+)/);
    if (mView) {
      const viewName = decodeURIComponent(mView[1]);
      const view = views.find((v) => v.name === viewName);
      if (view)
        entityConfigSection =
          `\nThe error occurred while rendering view "${viewName}". ` +
          `Current configuration:\n\`\`\`json\n` +
          `${JSON.stringify(view.configuration, null, 2)}\n\`\`\`\n`;
    } else if (mPage) {
      const pageName = decodeURIComponent(mPage[1]);
      const page = pages.find((p) => p.name === pageName);
      if (page)
        entityConfigSection =
          `\nThe error occurred while rendering page "${pageName}". ` +
          `Current configuration:\n\`\`\`json\n` +
          `${JSON.stringify(page.layout, null, 2)}\n\`\`\`\n`;
    }

    const cannot_fix_tool = {
      type: "function",
      function: {
        name: "cannot_fix",
        description:
          "Use this when the error cannot be diagnosed or fixed from the available " +
          "information — e.g. the error is too vague, the stack trace points to platform " +
          "internals with no clear application-level fix, or no relevant entity configuration " +
          "is available. Do NOT invent a task just to produce output.",
        parameters: {
          type: "object",
          required: ["reason"],
          properties: {
            reason: {
              type: "string",
              description:
                "One sentence explaining why a fix task cannot be created.",
            },
          },
        },
      },
    };

    const answer = await getState().functions.llm_generate.run(
      "Fix a bug in the following Saltcorn application.\n\n" +
        `${spec.body.specification}\n` +
        `${research_answers_section(researchText)}` +
        (allReqs.length
          ? "\nThe existing application requirements are:\n\n" +
            allReqs.map((r) => `* ${r.body.requirement}`).join("\n") +
            "\n\n"
          : "\n") +
        `${saltcorn_description}\n\n` +
        `${implementation_rules}\n\n` +
        `${fieldview_selection_rules}\n\n` +
        "The database has the following tables:\n\n" +
        `${existing_tables_list(tables)}\n\n` +
        (entitiesSection ? entitiesSection + "\n\n" : "") +
        (installedPluginsSection ? installedPluginsSection + "\n\n" : "") +
        (pluginsSection ? pluginsSection + "\n\n" : "") +
        `${task_planning_rules}\n\n` +
        "The following error occurred in the application:\n```\n" +
        `${errorText}\n` +
        "```\n" +
        `${entityConfigSection}\n` +
        `${task_planning_closing}\n\n` +
        "Either call plan_tasks with exactly one fix task, or call cannot_fix if you cannot " +
        "determine a concrete fix from the information above. Do not invent a task just to " +
        "produce output — prefer cannot_fix over a vague or speculative task.\n\n" +
        "Rules for the plan_tasks description (only if you can diagnose the fix):\n" +
        "- Name the exact Saltcorn entity (view, trigger, page) to fix.\n" +
        "- Describe what is wrong and what kind of fix is needed. Where you can clearly identify " +
        "them from the config shown above, state each broken field, its current value, and the correct value. " +
        "If you are not certain of the exact values, describe the problem instead — do not guess specific values.\n" +
        "- Cover ALL fields of the same error class in one task.\n" +
        "- Prefer fixing a broken reference over removing the element that contains it. " +
        "Only remove an element when there is genuinely no valid replacement. " +
        "Example: a viewlink column referencing a missing view should have its view name " +
        "updated to an existing view — not have the column deleted.\n" +
        "- End with: 'Use get_entity to load the current config, diagnose the exact values, apply the fix, and save with set_entity.'\n" +
        "- One or two sentences. No prose, no save/test instructions.",
      {
        tools: [task_tool, cannot_fix_tool],
        systemPrompt:
          "You are a Saltcorn developer. Analyse the error and decide: can you produce a " +
          "concrete, actionable fix? If yes, call plan_tasks. If not, call cannot_fix.",
      }
    );

    const tc =
      typeof answer.getToolCalls === "function"
        ? answer.getToolCalls()?.[0]
        : undefined;
    if (!tc) return;

    if (tc.tool_name === "cannot_fix") {
      await currentMd.update({
        body: { ...currentMd.body, cannot_fix_reason: tc.input.reason },
      });
      return;
    }

    if (tc.tool_name !== "plan_tasks" || !Array.isArray(tc.input.tasks)) return;

    for (const task of tc.input.tasks)
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: "task",
        body: { ...task, source: "error_fix", error_id: currentMd.id },
        user_id: userId,
      });

    await currentMd.update({
      body: { ...currentMd.body, fix_task_created: true },
    });
  } finally {
    try {
      const current = await MetaData.findOne({
        id: currentMd.id,
        type: "CopilotConstructMgr",
        name: "error",
      });
      if (current) {
        const { fixing, ...rest } = current.body;
        await current.update({ body: rest });
      }
    } catch (_) {}
    try {
      getState().emitDynamicUpdate(db.getTenantSchema(), {
        eval_js: [
          "if(typeof copilotRefreshErrs==='function')copilotRefreshErrs();",
          "if(typeof copilotRefreshTasks==='function')copilotRefreshTasks();",
        ],
      });
    } catch (_) {}
  }
};

/**
 * Renders the self-healing toggle section and error table.
 */
const errorList = async (req) => {
  const settings = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "settings",
  });
  const healEnabled = !!settings?.body?.error_heal;

  const healSection = healEnabled
    ? div(
        {
          class:
            "alert alert-success d-flex align-items-center gap-3 py-2 mb-3",
        },
        i({ class: "fas fa-heartbeat" }),
        span(
          "Self-healing enabled — new errors will automatically generate fix tasks."
        ),
        button(
          {
            class: "btn btn-sm btn-outline-secondary ms-auto",
            onclick: "copilotToggleErrorHealing()",
          },
          "Disable"
        )
      )
    : div(
        {
          class:
            "alert alert-secondary d-flex align-items-center gap-3 py-2 mb-3",
        },
        i({ class: "fas fa-heartbeat" }),
        div(
          span({ class: "d-block" }, "Self-healing is disabled."),
          small(
            { class: "text-muted" },
            "When enabled, new errors automatically generate a fix task."
          )
        ),
        button(
          {
            class: "btn btn-sm btn-primary ms-auto",
            onclick: "copilotToggleErrorHealing()",
          },
          "Enable self-healing"
        )
      );

  const errs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "error",
  });

  // Build error_id → most recent fix task map for run links
  const allTasks = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "task",
  });
  const fixTaskByErrorId = {};
  for (const t of allTasks) {
    if (t.body.source === "error_fix" && t.body.error_id != null) {
      const eid = parseInt(t.body.error_id);
      if (!fixTaskByErrorId[eid] || t.id > fixTaskByErrorId[eid].id)
        fixTaskByErrorId[eid] = t;
    }
  }

  const errTable = errs.length
    ? div(
        mkTable(
          [
            {
              label: "Source",
              key: (m) =>
                m.body.source === "constructor"
                  ? span(
                      {
                        class: "badge bg-secondary",
                        title: "Error in the app constructor itself",
                      },
                      "constructor"
                    )
                  : span(
                      {
                        class: "badge bg-primary",
                        title: "Error in the application being built",
                      },
                      "application"
                    ),
            },
            {
              label: "Error",
              key: (m) => {
                const err = m.body.error || {};
                const msg = err.message || String(err) || "(no message)";
                const urlLine = err.url
                  ? div(
                      { class: "text-muted", style: "font-size:0.75rem" },
                      err.url
                    )
                  : "";
                const stackLines = (err.stack || "").split("\n").slice(0, 5);
                const stackPreview = stackLines.length
                  ? pre(
                      {
                        style:
                          "font-size:0.72rem;white-space:pre-wrap;overflow-wrap:break-word;margin:4px 0 0;",
                      },
                      stackLines.join("\n")
                    )
                  : "";
                return div(
                  { style: "word-break:break-word;min-width:0;" },
                  div({ class: "fw-semibold small" }, msg),
                  urlLine,
                  stackPreview
                );
              },
            },
            {
              label: "Status",
              key: (r) => {
                if (r.body.source === "constructor") return "";
                if (r.body.fixing)
                  return span(
                    {
                      class: "badge bg-info text-dark",
                      "data-fixing-id": r.id,
                    },
                    i({ class: "fas fa-spinner fa-spin me-1" }),
                    "Creating fix task..."
                  );
                if (r.body.cannot_fix_reason)
                  return div(
                    span(
                      { class: "badge bg-warning text-dark" },
                      "No fix found"
                    ),
                    div(
                      {
                        class: "text-muted mt-1",
                        style:
                          "font-size:0.75rem;max-width:220px;white-space:normal;",
                      },
                      r.body.cannot_fix_reason
                    )
                  );
                if (r.body.fix_task_created)
                  return div(
                    { class: "d-flex align-items-center gap-1" },
                    span({ class: "badge bg-success" }, "Fix task created"),
                    fixTaskByErrorId[r.id]?.body?.run_id
                      ? a(
                          {
                            href: `/view/Saltcorn%20Agent%20copilot?run_id=${
                              fixTaskByErrorId[r.id].body.run_id
                            }`,
                            target: "_blank",
                            title: "View fix task run",
                            class: "text-muted",
                          },
                          i({ class: "fas fa-external-link-alt" })
                        )
                      : ""
                  );
                return span(
                  { class: "badge bg-light text-dark border" },
                  "New"
                );
              },
            },
            {
              label: "",
              key: (r) => {
                const iconRow = div(
                  { class: "d-flex align-items-center gap-1" },
                  button(
                    {
                      class: "btn btn-sm btn-outline-secondary",
                      onclick: "copilotShowErrDetail(this)",
                      title: "View full error",
                      "data-err": JSON.stringify(r.body.error),
                    },
                    i({ class: "fas fa-eye" })
                  ),
                  button(
                    {
                      class: "btn btn-sm btn-outline-danger",
                      onclick: `copilotDelErr(${r.id})`,
                      title: "Delete",
                    },
                    i({ class: "fas fa-trash-alt" })
                  )
                );
                const fixRow =
                  r.body.source === "constructor"
                    ? ""
                    : r.body.fixing ||
                      r.body.fix_task_created ||
                      r.body.cannot_fix_reason
                    ? ""
                    : div(
                        { class: "mt-1" },
                        button(
                          {
                            id: `fix-err-btn-${r.id}`,
                            class: "btn btn-sm btn-outline-primary",
                            onclick: `copilotFixError(${r.id})`,
                          },
                          "Create fix task"
                        )
                      );
                return div({ style: "white-space:nowrap;" }, iconRow, fixRow);
              },
            },
          ],
          errs
        ),
        button(
          {
            class: "btn btn-outline-danger",
            onclick: "copilotDelAllErrs()",
          },
          "Delete all"
        )
      )
    : p("No errors");

  return div({ class: "mt-2" }, healSection, errTable);
};

const del_err = async (table_id, vn, config, body, { req, res }) => {
  const r = await MetaData.findOne({
    id: parseInt(body.id),
    type: "CopilotConstructMgr",
    name: "error",
  });
  if (!r) throw new Error("Error not found");
  await r.delete();
  return { json: { success: true } };
};

const del_all_errs = async (table_id, vn, config, body, { req, res }) => {
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "error",
  });
  for (const r of rs) await r.delete();
  return { json: { success: true } };
};

/** Route: toggles the error_heal setting. */
const toggle_error_healing = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const settings = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "settings",
  });
  if (settings) {
    await settings.update({
      body: { ...settings.body, error_heal: !settings.body.error_heal },
    });
  } else {
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "settings",
      body: { error_heal: true },
    });
  }
  return { json: { success: true } };
};

/** Route: fires doCreateErrorFixTask for a single error record. */
const fix_error_task = async (table_id, vn, config, body, { req, res }) => {
  const id = parseInt(body.id);
  const errorMd = await MetaData.findOne({
    id,
    type: "CopilotConstructMgr",
    name: "error",
  });
  if (!errorMd) return { json: { error: "Error record not found" } };
  doCreateErrorFixTask(errorMd, req.user?.id).catch((e) =>
    console.error("fix_error_task error", e)
  );
  return { json: { success: true } };
};

/** Route: returns whether a fix task is still being generated for the given error id. */
const fix_error_status = async (table_id, vn, config, body, { req, res }) => {
  const id = parseInt(body.id);
  const errorMd = await MetaData.findOne({
    id,
    type: "CopilotConstructMgr",
    name: "error",
  });
  return { json: { fixing: !!errorMd?.body?.fixing } };
};

/** Route: returns the rendered error list HTML for AJAX refresh. */
const err_list_html = async (table_id, vn, config, body, { req, res }) => {
  const html = await errorList(req);
  return { json: { html } };
};

const error_routes = {
  del_err,
  del_all_errs,
  toggle_error_healing,
  fix_error_task,
  fix_error_status,
  err_list_html,
};

const errTableStaticHtml = `
<style>
#err-list-area table { table-layout: auto; width: 100%; }
#err-list-area table th:nth-child(1),
#err-list-area table td:nth-child(1),
#err-list-area table th:nth-child(4),
#err-list-area table td:nth-child(4) { width: 1px; white-space: nowrap; }
#err-list-area table th:nth-child(2),
#err-list-area table td:nth-child(2) { width: 100%; }
#err-list-area table th:nth-child(3),
#err-list-area table td:nth-child(3) { padding-right: 2rem; }
</style>
<div class="modal fade" id="err-detail-modal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-lg modal-dialog-scrollable">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">Error details</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <pre id="err-detail-body" style="white-space:pre-wrap;overflow-wrap:break-word;font-size:0.8rem;"></pre>
      </div>
    </div>
  </div>
</div>
<script>
(function () {
  const _vn = ${JSON.stringify(viewname)};
  function refreshErrArea() {
    view_post(_vn, 'err_list_html', {}, (r) => {
      const el = document.getElementById('err-list-area');
      if (r && r.html && el) el.innerHTML = r.html;
    });
  }
  function startFixPolling() {
    if (window.dynamic_updates_cfg?.enabled) return;
    document.querySelectorAll('[data-fixing-id]').forEach((el) => {
      const id = parseInt(el.dataset.fixingId);
      const poll = () => {
        view_post(_vn, 'fix_error_status', { id }, (resp) => {
          if (resp && !resp.fixing) {
            refreshErrArea();
          } else {
            setTimeout(poll, 3000);
          }
        });
      };
      setTimeout(poll, 3000);
    });
  }
  window.copilotRefreshErrs = refreshErrArea;
  window.copilotRefreshReqs = () => {
    view_post(_vn, 'req_list_html', {}, (r) => {
      const a = document.getElementById('req-list-area');
      if (r && r.html && a) {
        a.innerHTML = r.html;
        if (typeof copilotInitReqsState === 'function') copilotInitReqsState();
      }
    });
  };
  window.copilotRefreshSchema = () => {
    view_post(_vn, 'schema_list_html', {}, (r) => {
      const a = document.getElementById('schema-list-area');
      if (r && r.html && a) {
        a.innerHTML = r.html;
        if (typeof copilotInitSchemaState === 'function') copilotInitSchemaState();
      }
    });
  };
  window.copilotRefreshResearch = () => {
    view_post(_vn, 'research_html', {}, (r) => {
      const a = document.getElementById('research-panel');
      if (r && r.html && a) a.innerHTML = r.html;
    });
  };
  window.copilotToggleErrorHealing = () => {
    view_post(_vn, 'toggle_error_healing', {}, () => refreshErrArea());
  };
  window.copilotFixError = (id) => {
    const btn = document.getElementById('fix-err-btn-' + id);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    view_post(_vn, 'fix_error_task', { id }, () => {
      if (window.dynamic_updates_cfg?.enabled) return;
      const poll = () => {
        view_post(_vn, 'fix_error_status', { id }, (resp) => {
          if (resp && !resp.fixing) {
            refreshErrArea();
          } else {
            setTimeout(poll, 3000);
          }
        });
      };
      setTimeout(poll, 3000);
    });
  };
  window.copilotDelErr = (id) => {
    view_post(_vn, 'del_err', { id }, () => refreshErrArea());
  };
  window.copilotDelAllErrs = () => {
    view_post(_vn, 'del_all_errs', {}, () => refreshErrArea());
  };
  window.copilotShowErrDetail = (btn) => {
    let err = {};
    try { err = JSON.parse(btn.dataset.err || '{}'); } catch (e) {}
    document.getElementById('err-detail-body').textContent = JSON.stringify(err, null, 2);
    new bootstrap.Modal(document.getElementById('err-detail-modal')).show();
  };
  if (document.readyState !== 'loading') startFixPolling();
  else document.addEventListener('DOMContentLoaded', () => startFixPolling());
})();
</script>`;

module.exports = {
  errorList,
  doCreateErrorFixTask,
  error_routes,
  errTableStaticHtml,
};
