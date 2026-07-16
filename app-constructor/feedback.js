const feedbackAction = require("./feedback-action.js");
const MetaData = require("@saltcorn/data/models/metadata");
const { save_menu_items } = require("@saltcorn/data/models/config");
const { mkTable } = require("@saltcorn/markup");
const {
  div,
  script,
  domReady,
  h5,
  button,
  i,
  p,
  a,
  hr,
  input,
  label,
  textarea,
  small,
  span,
} = require("@saltcorn/markup/tags");
const { getState, features } = require("@saltcorn/data/db/state");
const { viewname, projectType } = require("./common");
const getPt = (body, req) =>
  projectType(body?.project_id ?? req?.query?.project_id);
const { questions_tool } = require("./research");
const { PromptGenerator } = require("./prompt-generator");

/**
 * Returns the Bootstrap modal HTML that prompts the user to analyse or skip.
 */
const feedbackClarifyModal = () =>
  `<div class="modal fade" id="fb-clarify-modal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header border-0 pb-0">
        <h5 class="modal-title fw-semibold">Analyse feedback?</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body pt-2">
        <p class="text-muted small mb-0">Before saving, I can analyse your feedback and ask a few short questions to help clarify the requirements. Answering them produces more accurate tasks — but you can also save right away.</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" onclick="fbSubmit()">Save without questions</button>
        <button type="button" class="btn btn-primary" data-bs-dismiss="modal" onclick="fbAnalyseFeedback()">Analyse</button>
      </div>
    </div>
  </div>
</div>`;

const scopeLabel = (scope, phases) => {
  if (!scope || scope === "overall") return "Overall";
  const m = scope.match(/^phase_(\d+)$/);
  if (!m) return scope;
  const idx = parseInt(m[1]);
  const ph = phases[idx];
  return ph ? `Phase ${idx + 1}: ${ph.name}` : `Phase ${idx + 1}`;
};

/** Inner content of #feedback-views-area — data only, no JS. Swapped in on ajax refresh. */
const feedbackViewsContent = async (pt, projectId) => {
  const safeViewName = JSON.stringify(viewname);
  const phasesMd = await MetaData.findOne({
    type: pt,
    name: "phases",
  });
  const phases = phasesMd?.body?.phases || [];

  const pendingMds = await MetaData.find(
    { type: pt, name: "feedback_pending" },
    { orderBy: "id" }
  );

  const approvingIds = new Set(
    (
      await Promise.all(
        pendingMds.map(async (r) => {
          const md = await MetaData.findOne({
            type: pt,
            name: `approving_feedback_${r.id}`,
          });
          return md ? r.id : null;
        })
      )
    ).filter(Boolean)
  );

  const addButton = features.view_route_modal
    ? button(
        {
          class: "btn btn-outline-primary btn-sm mt-1",
          title: "Submit feedback",
          onclick: `ajax_modal('/view/${encodeURIComponent(
            viewname
          )}/get_feedback_form?project_id=${projectId}', {method:'POST'})`,
        },
        i({ class: "fas fa-plus me-1" }),
        "Add feedback"
      )
    : small(
        { class: "text-muted mt-1 d-block" },
        i({ class: "fas fa-info-circle me-1" }),
        "Submitting feedback requires a newer version of Saltcorn."
      );

  let pendingSection;
  if (!pendingMds.length) {
    pendingSection =
      h5({ class: "mb-2" }, "Pending feedback") +
      p({ class: "text-muted mt-2" }, "No pending feedback submissions.") +
      addButton;
  } else {
    const tableHtml = mkTable(
      [
        { label: "Scope", key: (r) => scopeLabel(r.body.scope, phases) },
        { label: "Title", key: (r) => r.body.title },
        { label: "Description", key: (r) => r.body.description || "" },
        { label: "Status", key: (r) => r.body.status || "" },
        {
          label: "Actions",
          key: (r) =>
            a(
              {
                href: "#",
                class: "btn btn-outline-primary btn-sm me-1",
                onclick: `copilotOpenFeedbackEdit(${r.id});return false;`,
              },
              "Edit"
            ) +
            (approvingIds.has(r.id)
              ? button(
                  {
                    class: "btn btn-success btn-sm me-1",
                    disabled: true,
                    "data-approving-id": r.id,
                  },
                  i({ class: "fas fa-spinner fa-spin" })
                )
              : button(
                  {
                    class: "btn btn-success btn-sm me-1",
                    id: `approve-btn-${r.id}`,
                    onclick: `copilotApprove(${r.id})`,
                  },
                  "Approve"
                )) +
            button(
              {
                class: "btn btn-outline-danger btn-sm",
                onclick: `copilotDeleteFeedback(${r.id})`,
              },
              i({ class: "fas fa-trash-alt" })
            ),
        },
      ],
      pendingMds
    );
    pendingSection =
      h5({ class: "mb-2" }, "Pending feedback") + tableHtml + addButton;
  }

  const processed = await MetaData.find(
    { type: pt, name: "feedback" },
    { orderBy: "written_at" }
  );

  const allTasks = await MetaData.find({
    type: pt,
    name: "task",
  });
  const feedbackTasks = allTasks.filter((t) => t.body?.source === "feedback");
  const tasksByFeedbackId = {};
  for (const t of feedbackTasks) {
    const key = t.body.feedback_id;
    if (key == null) continue;
    if (!tasksByFeedbackId[key]) tasksByFeedbackId[key] = [];
    tasksByFeedbackId[key].push(t);
  }

  const taskBadge = (t) => {
    const status = t.body.status;
    if (!status || status === "Pending")
      return button(
        {
          class: "btn btn-outline-primary btn-sm",
          id: `fb-task-run-btn-${t.id}`,
          onclick: `copilotRunFeedbackTask(${t.id})`,
          title: t.body.name,
        },
        i({ class: "fas fa-play me-1" }),
        span(
          {
            class: "text-truncate d-inline-block",
            style: "max-width:120px;vertical-align:middle",
          },
          t.body.name
        )
      );
    if (status === "Running")
      return span(
        { class: "badge bg-warning text-dark", title: t.body.name },
        i({ class: "fas fa-spinner fa-spin me-1" }),
        "Running"
      );
    if (status === "Done")
      return span(
        { class: "badge bg-success", title: t.body.name },
        i({ class: "fas fa-check me-1" }),
        "Done"
      );
    return span({ class: "badge bg-danger", title: t.body.name }, status);
  };

  const processedSection = div(
    { class: "mt-4" },
    h5("Approved feedback"),
    processed.length
      ? div(
          mkTable(
            [
              { label: "Scope", key: (m) => scopeLabel(m.body.scope, phases) },
              { label: "Title", key: (m) => m.body.title },
              { label: "Description", key: (m) => m.body.description },
              {
                label: "Tasks",
                key: (m) => {
                  const tasks = tasksByFeedbackId[m.body.feedback_id] || [];
                  if (!tasks.length)
                    return span({ class: "text-muted small" }, "—");
                  return div(
                    { class: "d-flex flex-column gap-1" },
                    ...tasks.map(taskBadge)
                  );
                },
              },
              {
                label: "",
                key: (r) =>
                  button(
                    {
                      class: "btn btn-outline-secondary btn-sm me-1",
                      onclick: `copilotShowProcessedFeedback(${r.id})`,
                    },
                    i({ class: "fas fa-eye" })
                  ) +
                  button(
                    {
                      class: "btn btn-outline-danger btn-sm",
                      onclick: `view_post(${safeViewName}, "del_feedback", {id:${r.id}}, refreshFeedbackViews)`,
                    },
                    i({ class: "fas fa-trash-alt" })
                  ),
              },
            ],
            processed
          ),
          button(
            {
              class: "btn btn-outline-danger btn-sm",
              onclick: `view_post(${safeViewName}, "del_all_feedback", {}, refreshFeedbackViews)`,
            },
            "Delete all"
          )
        )
      : p({ class: "text-muted" }, "No processed feedback yet.")
  );

  return pendingSection + processedSection;
};

/** Shared form body — phases baked into the scope select. Used by both the inline modal and the POST route popup. */
const feedbackFormInner = (phases, preselectedScope = "") => {
  const sel = (val) => (preselectedScope === val ? " selected" : "");
  const scopeOptions = [
    `<option value="overall"${sel("overall")}>Overall</option>`,
    ...phases.map(
      (ph, idx) =>
        `<option value="phase_${idx}"${sel(`phase_${idx}`)}>Phase ${idx + 1}: ${
          ph.name
        }</option>`
    ),
  ].join("");

  return (
    div(
      { id: "fb-step1" },
      small(
        { class: "text-muted d-block mb-3" },
        "Describe a feature request, bug, or improvement."
      ),
      div(
        { id: "fb-fields" },
        div(
          { class: "mb-3" },
          label({ class: "form-label", for: "fb-title" }, "Title"),
          input({ type: "text", class: "form-control", id: "fb-title" })
        ),
        div(
          { class: "mb-3" },
          label({ class: "form-label", for: "fb-desc" }, "Description"),
          textarea({ class: "form-control", id: "fb-desc", rows: 3 }, "")
        ),
        div(
          { class: "mb-3" },
          label({ class: "form-label", for: "fb-scope" }, "Phase"),
          `<select class="form-select" id="fb-scope">${scopeOptions}</select>`,
          small(
            { class: "form-text text-muted" },
            "Select a phase if this feedback applies to a specific part of the build, or leave as Overall."
          )
        ),
        div(
          { class: "mb-3" },
          label({ class: "form-label", for: "fb-url" }, "Page URL"),
          input({
            type: "text",
            class: "form-control",
            id: "fb-url",
            placeholder: "Optional — the page this feedback relates to",
          })
        )
      ),
      div(
        { id: "fb-analyse-area", class: "mb-2" },
        button(
          {
            type: "button",
            class: "btn btn-outline-secondary btn-sm",
            onclick: "fbAnalyseFeedback()",
          },
          i({ class: "fas fa-search me-1" }),
          "Analyse feedback"
        ),
        small(
          { class: "text-muted d-block mt-1" },
          "Checks if anything needs clarifying before saving."
        )
      ),
      div(
        { id: "fb-regen-area", class: "mb-2", style: "display:none" },
        button(
          {
            type: "button",
            class: "btn btn-outline-secondary btn-sm me-2",
            onclick: "fbAnalyseFeedback()",
          },
          i({ class: "fas fa-sync me-1" }),
          "Regenerate"
        ),
        button(
          {
            type: "button",
            class: "btn btn-outline-danger btn-sm",
            onclick: "fbDismissQuestions()",
          },
          "Dismiss"
        )
      ),
      div(
        {
          id: "fb-spinner",
          class: "my-2 text-muted small",
          style: "display:none",
        },
        i({ class: "fas fa-spinner fa-spin me-2" }),
        "Analysing feedback..."
      ),
      div({ id: "fb-questions-area" }),
      div(
        {
          id: "fb-clear-area",
          class: "alert alert-success py-2 mt-2",
          style: "display:none",
        },
        i({ class: "fas fa-check-circle me-2" }),
        "Feedback is clear — no questions needed."
      ),
      div(
        { class: "mt-3" },
        button(
          {
            type: "button",
            class: "btn btn-primary",
            onclick: "fbSaveOrPrompt()",
          },
          "Save feedback"
        )
      )
    ) +
    div(
      { id: "fb-success", class: "text-success mt-3", style: "display:none" },
      i({ class: "fas fa-check-circle me-2" }),
      "Thank you! Your feedback has been submitted."
    ) +
    feedbackClarifyModal()
  );
};

/** Outer shell of the feedback tab — renders once, includes modals, JS, and #feedback-views-area. */
const feedbackList = async (pt, projectId) => {
  const phasesMd = await MetaData.findOne({
    type: pt,
    name: "phases",
  });
  const phases = phasesMd?.body?.phases || [];
  const safeViewName = JSON.stringify(viewname);

  const topSection = div(
    { id: "feedback-views-area" },
    await feedbackViewsContent(pt, projectId)
  );

  const clientScript = script(
    domReady(`
const safeViewName = ${safeViewName};
const _pollingIds = new Set();
function startApprovalPolling() {
  document.querySelectorAll('[data-approving-id]').forEach(el => {
    const id = parseInt(el.dataset.approvingId);
    if (_pollingIds.has(id)) return;
    _pollingIds.add(id);
    const poll = () => {
      view_post(safeViewName, 'approval_status', { id }, (resp) => {
        if (resp && !resp.approving) {
          _pollingIds.delete(id);
          refreshFeedbackViews();
          refreshReqTaskAreas();
        }
        else setTimeout(poll, 3000);
      });
    };
    setTimeout(poll, 3000);
  });
}
window.refreshFeedbackViews = () => {
  view_post(safeViewName, 'feedback_views_html', {}, (r) => {
    if (r && r.html) {
      document.getElementById('feedback-views-area').innerHTML = r.html;
      startApprovalPolling();
    }
  });
};
window.copilotAddFeedbackToMenu = () => {
  view_post(safeViewName, 'add_feedback_to_menu', {}, (resp) => {
    if (resp && !resp.error) location.reload();
  });
};
window.copilotApprove = (id) => {
  const btn = document.getElementById('approve-btn-' + id);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  _pollingIds.add(id);
  view_post(safeViewName, 'start_approve_feedback', { id }, () => {
    const poll = () => {
      view_post(safeViewName, 'approval_status', { id }, (resp) => {
        if (resp && !resp.approving) {
          _pollingIds.delete(id);
          refreshFeedbackViews();
          refreshReqTaskAreas();
        }
        else setTimeout(poll, 3000);
      });
    };
    setTimeout(poll, 3000);
  });
};
window.copilotDeleteFeedback = (id) => {
  view_post(safeViewName, 'delete_feedback_row', { id }, (resp) => {
    if (resp && !resp.error) refreshFeedbackViews();
  });
};
window.copilotOpenFeedbackEdit = (id) => {
  view_post(safeViewName, 'get_feedback_edit_html', { id }, (resp) => {
    if (!resp || !resp.html) return;
    document.getElementById('fb-edit-modal-body').innerHTML = resp.html;
    document.getElementById('fb-edit-modal').dataset.feedbackId = id;
    new bootstrap.Modal(document.getElementById('fb-edit-modal')).show();
  });
};
window.copilotSaveFeedbackEdit = () => {
  const id = document.getElementById('fb-edit-modal').dataset.feedbackId;
  const payload = {
    id,
    title: document.getElementById('fbed-title').value,
    description: document.getElementById('fbed-desc').value,
    url: document.getElementById('fbed-url').value,
  };
  document.querySelectorAll('.fbed-answer').forEach(el => {
    payload[el.dataset.q] = el.value;
  });
  view_post(safeViewName, 'save_feedback_edit', payload, (resp) => {
    if (resp && !resp.error) {
      bootstrap.Modal.getInstance(document.getElementById('fb-edit-modal')).hide();
      refreshFeedbackViews();
    }
  });
};
window.copilotRunFeedbackTask = (taskId) => {
  const btn = document.getElementById('fb-task-run-btn-' + taskId);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  view_post(safeViewName, 'run_task', { id: taskId }, () => {
    const poll = () => {
      view_post(safeViewName, 'task_status', { ids: [String(taskId)] }, (resp) => {
        if (resp && resp.any_done) {
          if (resp.any_failed && typeof notifyAlert === 'function')
            notifyAlert({ type: 'danger', text: 'Task run failed. Please try again.' });
          refreshFeedbackViews();
        } else setTimeout(poll, 3000);
      });
    };
    setTimeout(poll, 3000);
  });
};
window.copilotShowProcessedFeedback = (id) => {
  view_post(safeViewName, 'show_processed_feedback', { id }, (resp) => {
    if (!resp || !resp.html) return;
    document.getElementById('fb-details-modal-body').innerHTML = resp.html;
    new bootstrap.Modal(document.getElementById('fb-details-modal')).show();
  });
};
document.addEventListener('shown.bs.tab', () => startApprovalPolling());
startApprovalPolling();
`)
  );

  const editModal = div(
    {
      class: "modal fade",
      id: "fb-edit-modal",
      tabindex: "-1",
      "aria-hidden": "true",
    },
    div(
      { class: "modal-dialog modal-lg" },
      div(
        { class: "modal-content" },
        div(
          { class: "modal-header" },
          h5({ class: "modal-title" }, "Edit feedback"),
          button({
            type: "button",
            class: "btn-close",
            "data-bs-dismiss": "modal",
            "aria-label": "Close",
          })
        ),
        div({ class: "modal-body", id: "fb-edit-modal-body" }),
        div(
          { class: "modal-footer" },
          button(
            {
              type: "button",
              class: "btn btn-outline-secondary",
              "data-bs-dismiss": "modal",
            },
            "Cancel"
          ),
          button(
            {
              type: "button",
              class: "btn btn-primary",
              onclick: "copilotSaveFeedbackEdit()",
            },
            "Save"
          )
        )
      )
    )
  );

  const detailsModal = div(
    {
      class: "modal fade",
      id: "fb-details-modal",
      tabindex: "-1",
      "aria-hidden": "true",
    },
    div(
      { class: "modal-dialog modal-lg" },
      div(
        { class: "modal-content" },
        div(
          { class: "modal-header" },
          h5({ class: "modal-title" }, "Feedback details"),
          button({
            type: "button",
            class: "btn-close",
            "data-bs-dismiss": "modal",
            "aria-label": "Close",
          })
        ),
        div({ class: "modal-body", id: "fb-details-modal-body" }),
        div(
          { class: "modal-footer" },
          button(
            {
              type: "button",
              class: "btn btn-secondary",
              "data-bs-dismiss": "modal",
            },
            "Close"
          )
        )
      )
    )
  );

  const menuItems = getState().getConfig("menu_items", []);
  const feedbackInMenu = menuItems.some(
    (mi) => mi.type === "Link" && mi.url?.includes("get_feedback_form")
  );
  const navbarBtn = !features.view_route_modal
    ? div(
        { class: "mt-3" },
        small(
          { class: "text-muted" },
          i({ class: "fas fa-info-circle me-1" }),
          "Adding a feedback button to the navbar requires a newer version of Saltcorn."
        )
      )
    : feedbackInMenu
    ? ""
    : div(
        { class: "mt-3" },
        button(
          {
            class: "btn btn-outline-secondary btn-sm",
            onclick: "copilotAddFeedbackToMenu()",
            title: "Add a Feedback button to the site navigation bar",
          },
          i({ class: "fas fa-bars me-1" }),
          "Add feedback button to navbar"
        )
      );

  return div(
    { class: "mt-2" },
    topSection,
    navbarBtn,
    editModal,
    detailsModal,
    clientScript
  );
};

/**
 * Route: returns the rendered feedbackViewsContent HTML for in-place ajax refresh.
 */
const feedback_views_html = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const projectId = body.project_id ?? req.query?.project_id;
  const html = await feedbackViewsContent(pt, projectId);
  return { json: { html } };
};

/**
 * Route: starts async approval of a pending feedback row.
 * Runs feedbackAction in the background, then deletes the MetaData record and its research metadata.
 */
const start_approve_feedback = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const projectId = body.project_id ?? req.query?.project_id;
  const id = parseInt(body.id);
  const mdRow = await MetaData.findOne({
    id,
    type: pt,
    name: "feedback_pending",
  });
  if (!mdRow) return { json: { error: "Not found" } };
  const row = mdRow.body;

  const mdName = `approving_feedback_${id}`;
  await MetaData.create({
    type: pt,
    name: mdName,
    body: { id },
  });

  const researchMd = await MetaData.findOne({
    type: pt,
    name: `feedback_research_${id}`,
  });
  let research_context = null;
  if (researchMd) {
    const questions = researchMd.body.questions || [];
    const answers = researchMd.body.answers || {};
    const pairs = questions.map((q, idx) => {
      const a = answers[`q${idx + 1}`];
      return `Q: ${q}\nA: ${a && a.trim() ? a.trim() : "(no answer)"}`;
    });
    if (pairs.length) research_context = pairs.join("\n\n");
  }

  if (row.phase_idx != null) {
    {
      const phIdx = row.phase_idx;
      const phasesMd = await MetaData.findOne({
        type: pt,
        name: "phases",
      });
      const ph = phasesMd?.body?.phases?.[phIdx];
      if (ph) {
        const allPhaseRecords = await MetaData.find({
          type: pt,
        });
        const forPhase = (name) =>
          allPhaseRecords.filter(
            (r) => r.name === name && r.body?.phase_idx === phIdx
          );

        const tableLines = forPhase("table_phase").map(
          (r) => `- ${r.body.table_name}`
        );
        const pluginLines = forPhase("plugin_phase").map(
          (r) => `- ${r.body.plugin_name}`
        );
        const viewLines = forPhase("view_phase").map((r) =>
          r.body.viewtemplate === "page"
            ? `- page: ${r.body.view_name}`
            : `- view: ${r.body.view_name} (${r.body.viewtemplate})`
        );

        const sections = [
          pluginLines.length
            ? `Plugins installed in this phase:\n${pluginLines.join("\n")}`
            : "",
          tableLines.length
            ? `Tables created in this phase:\n${tableLines.join("\n")}`
            : "",
          viewLines.length
            ? `Views and pages created in this phase:\n${viewLines.join("\n")}`
            : "",
        ].filter(Boolean);

        const phaseNote = `This feedback is scoped to Phase ${phIdx + 1}: ${
          ph.name
        }. ${ph.description}${
          sections.length ? "\n\n" + sections.join("\n\n") : ""
        }`;
        research_context = research_context
          ? phaseNote + "\n\n" + research_context
          : phaseNote;
      }
    }
  }

  const existingTaskIds = new Set(
    (await MetaData.find({ type: pt, name: "task" })).map((t) => t.id)
  );

  feedbackAction
    .run({
      row,
      user: req.user,
      mode: "table",
      req,
      configuration: {
        title_field: "title",
        description_field: "description",
        url_field: "url",
        research_context,
        pt,
        project_id: projectId,
        feedback_id: id,
      },
    })
    .then(async () => {
      if (row.phase_idx != null) {
        const phIdx = row.phase_idx;
        const phasesMd = await MetaData.findOne({
          type: pt,
          name: "phases",
        });
        const phaseName = phasesMd?.body?.phases?.[phIdx]?.name;
        const allTasks = await MetaData.find({
          type: pt,
          name: "task",
        });
        for (const t of allTasks.filter((t) => !existingTaskIds.has(t.id)))
          await t.update({
            body: { ...t.body, phase_idx: phIdx, phase_name: phaseName },
          });
      }
      const md = await MetaData.findOne({
        type: pt,
        name: mdName,
      });
      if (md) await md.delete();
      await mdRow.delete();
      const rmd = await MetaData.findOne({
        type: pt,
        name: `feedback_research_${id}`,
      });
      if (rmd) await rmd.delete();
    })
    .catch(async (e) => {
      console.error("approve_feedback error", e);
      const md = await MetaData.findOne({
        type: pt,
        name: mdName,
      });
      if (md) await md.delete();
    });

  return { json: { success: true } };
};

/**
 * Route: polls whether a given feedback row is still being approved.
 */
const approval_status = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const id = parseInt(body.id);
  const md = await MetaData.findOne({
    type: pt,
    name: `approving_feedback_${id}`,
  });
  return { json: { approving: !!md } };
};

/**
 * Route: deletes a pending feedback MetaData record and its associated research metadata.
 */
const delete_feedback_row = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const id = parseInt(body.id);
  const mdRow = await MetaData.findOne({
    id,
    type: pt,
    name: "feedback_pending",
  });
  if (mdRow) await mdRow.delete();
  const rmd = await MetaData.findOne({
    type: pt,
    name: `feedback_research_${id}`,
  });
  if (rmd) await rmd.delete();
  return { json: { success: true } };
};

/** Route: returns the show HTML for a processed feedback entry, displayed in the details modal. */
const show_processed_feedback = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const id = parseInt(body.id);
  const md = await MetaData.findOne({ id });
  if (!md) return { json: { error: "Not found" } };

  const { title, description, url, research_context, phase_idx } = md.body;

  const field = (lbl, val) =>
    val
      ? div(
          { class: "mb-3" },
          small({ class: "text-muted fw-semibold d-block" }, lbl),
          p({ class: "mb-0" }, val)
        )
      : "";

  // Phase — compact label only
  let phaseHtml = "";
  if (phase_idx != null) {
    const phasesMd = await MetaData.findOne({ type: pt, name: "phases" });
    const ph = phasesMd?.body?.phases?.[phase_idx];
    const phaseLabel = ph
      ? `Phase ${phase_idx + 1}: ${ph.name}`
      : `Phase ${phase_idx + 1}`;
    phaseHtml = field("Phase", phaseLabel);
  }

  // Q&A: only pairs that actually have a Q: line (filters out the phase note)
  const qaPairs = research_context
    ? research_context
        .split("\n\n")
        .map((pair) => {
          const lines = pair.split("\n");
          const qLine = lines.find((l) => l.startsWith("Q:"));
          const aLine = lines.find((l) => l.startsWith("A:"));
          if (!qLine) return null;
          return {
            q: qLine.replace(/^Q:\s*/, ""),
            a: aLine?.replace(/^A:\s*/, "") || "",
          };
        })
        .filter(Boolean)
    : [];

  const qaHtml =
    hr() +
    p({ class: "fw-semibold mb-2" }, "Clarifying questions") +
    (qaPairs.length
      ? qaPairs
          .map(({ q, a }) =>
            div(
              { class: "mb-2" },
              small({ class: "text-muted fw-semibold d-block" }, q),
              p({ class: "mb-0" }, a || "—")
            )
          )
          .join("")
      : p({ class: "text-muted small mb-0" }, "None"));

  // Generated tasks
  const allTasks = await MetaData.find({ type: pt, name: "task" });
  const feedbackTasks = allTasks.filter(
    (t) => t.body?.feedback_id === md.body.feedback_id
  );
  const tasksHtml = feedbackTasks.length
    ? hr() +
      p({ class: "fw-semibold mb-2" }, "Generated tasks") +
      feedbackTasks
        .map((t) =>
          div(
            { class: "mb-3" },
            small({ class: "text-muted fw-semibold d-block" }, t.body.name),
            p({ class: "mb-0 small" }, t.body.description || "")
          )
        )
        .join("")
    : "";

  return {
    json: {
      html:
        field("Title", title) +
        field("Description", description) +
        field("URL", url) +
        phaseHtml +
        qaHtml +
        tasksHtml,
    },
  };
};

/**
 * Route: returns editable HTML for a pending feedback record including all fields
 * and any associated Q&A answers, shown in the edit modal.
 */
const get_feedback_edit_html = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const id = parseInt(body.id);
  const mdRow = await MetaData.findOne({
    id,
    type: pt,
    name: "feedback_pending",
  });
  if (!mdRow) return { json: { error: "Not found" } };
  const row = mdRow.body;

  const rmd = await MetaData.findOne({
    type: pt,
    name: `feedback_research_${id}`,
  });
  const rmdValid = parseInt(rmd?.body?.feedback_id) === id;
  const questions = rmdValid ? rmd.body.questions || [] : [];
  const answers = rmdValid ? rmd.body.answers || {} : {};

  const fieldsHtml =
    div(
      { class: "mb-3" },
      label({ class: "form-label fw-semibold", for: "fbed-title" }, "Title"),
      input({
        type: "text",
        class: "form-control",
        id: "fbed-title",
        value: row.title || "",
      })
    ) +
    div(
      { class: "mb-3" },
      label(
        { class: "form-label fw-semibold", for: "fbed-desc" },
        "Description"
      ),
      textarea(
        { class: "form-control", id: "fbed-desc", rows: 3 },
        row.description || ""
      )
    ) +
    div(
      { class: "mb-3" },
      label({ class: "form-label fw-semibold", for: "fbed-url" }, "URL"),
      input({
        type: "text",
        class: "form-control",
        id: "fbed-url",
        value: row.url || "",
      })
    );

  const questionsHtml = questions.length
    ? hr() +
      p({ class: "fw-semibold mb-3" }, "Clarifying questions") +
      questions
        .map((q, idx) => {
          const key = `q${idx + 1}`;
          return div(
            { class: "mb-3" },
            label({ class: "form-label small fw-semibold" }, q),
            textarea(
              {
                class: "form-control form-control-sm fbed-answer",
                "data-q": key,
                rows: 2,
              },
              answers[key] || ""
            )
          );
        })
        .join("")
    : "";

  return { json: { html: fieldsHtml + questionsHtml } };
};

/**
 * Route: saves edits to a pending feedback MetaData record and updates its Q&A answers metadata.
 */
const save_feedback_edit = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const { _csrf, id: rawId, title, description, url, ...rest } = body;
  const id = parseInt(rawId);
  const mdRow = await MetaData.findOne({
    id,
    type: pt,
    name: "feedback_pending",
  });
  if (mdRow) {
    await mdRow.update({ body: { ...mdRow.body, title, description, url } });
  }

  const rmd = await MetaData.findOne({
    type: pt,
    name: `feedback_research_${id}`,
  });
  if (rmd) {
    const answers = { ...rmd.body.answers };
    for (const [k, v] of Object.entries(rest)) {
      if (/^q\d+$/.test(k)) answers[k] = v;
    }
    await rmd.update({ body: { ...rmd.body, answers } });
  }

  return { json: { success: true, notify_success: "Feedback saved" } };
};

/**
 * Route: adds a Feedback link to the navigation menu if not already present.
 */
const get_feedback_form = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const phasesMd = await MetaData.findOne({
    type: pt,
    name: "phases",
  });
  const phases = phasesMd?.body?.phases || [];
  const preselectedScope = body.scope || req?.query?.scope || "";
  const safeViewNameJson = JSON.stringify(viewname);

  const standaloneScript = `<script>
(function(){
const safeViewName = ${safeViewNameJson};
let _fbQuestions;
const _urlField = document.getElementById('fb-url');
if (_urlField) {
  try {
    const _href = window.location.href;
    if (!decodeURIComponent(_href).includes('/view/' + safeViewName)) _urlField.value = _href;
  } catch (_e) { _urlField.value = window.location.href; }
}
function fbGetUrl() {
  const url = document.getElementById('fb-url')?.value?.trim() || '';
  if (!url) return '';
  try { if (decodeURIComponent(url).includes('/view/' + safeViewName)) return ''; } catch (_e) {}
  return url;
}
function fbPopulateQuestions(questions) {
  const area = document.getElementById('fb-questions-area');
  area.innerHTML = '';
  for (const [idx, q] of questions.entries()) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';
    const lbl = document.createElement('label');
    lbl.className = 'form-label';
    lbl.textContent = q;
    lbl.htmlFor = 'fb-answer-' + idx;
    const ta = document.createElement('textarea');
    ta.className = 'form-control';
    ta.id = 'fb-answer-' + idx;
    ta.rows = 2;
    wrapper.appendChild(lbl);
    wrapper.appendChild(ta);
    area.appendChild(wrapper);
  }
}
window.fbAnalyseFeedback = () => {
  const title = document.getElementById('fb-title').value.trim();
  if (!title) { document.getElementById('fb-title').classList.add('is-invalid'); return; }
  document.getElementById('fb-title').classList.remove('is-invalid');
  document.getElementById('fb-spinner').style.display = '';
  document.getElementById('fb-analyse-area').style.display = 'none';
  document.getElementById('fb-regen-area').style.display = 'none';
  view_post(safeViewName, 'analyse_feedback', { title, description: document.getElementById('fb-desc').value.trim(), url: fbGetUrl() }, (resp) => {
    document.getElementById('fb-spinner').style.display = 'none';
    if (!resp || resp.error) { document.getElementById('fb-analyse-area').style.display = ''; return; }
    const questions = resp.questions || [];
    _fbQuestions = questions;
    if (questions.length === 0) {
      document.getElementById('fb-clear-area').style.display = '';
      document.getElementById('fb-regen-area').style.display = '';
      return;
    }
    fbPopulateQuestions(questions);
    document.getElementById('fb-fields').style.display = 'none';
    document.getElementById('fb-regen-area').style.display = '';
  });
};
window.fbDismissQuestions = () => {
  _fbQuestions = undefined;
  document.getElementById('fb-questions-area').innerHTML = '';
  document.getElementById('fb-clear-area').style.display = 'none';
  document.getElementById('fb-fields').style.display = '';
  document.getElementById('fb-regen-area').style.display = 'none';
  document.getElementById('fb-analyse-area').style.display = '';
};
window.fbSaveOrPrompt = () => {
  const title = document.getElementById('fb-title').value.trim();
  if (!title) { document.getElementById('fb-title').classList.add('is-invalid'); return; }
  document.getElementById('fb-title').classList.remove('is-invalid');
  if (_fbQuestions !== undefined) { fbSubmit(); return; }
  new bootstrap.Modal(document.getElementById('fb-clarify-modal')).show();
};
window.fbSubmit = () => {
  const title = document.getElementById('fb-title').value.trim();
  if (!title) { document.getElementById('fb-title').classList.add('is-invalid'); return; }
  document.getElementById('fb-title').classList.remove('is-invalid');
  const scope = document.getElementById('fb-scope')?.value || 'overall';
  const payload = { title, description: document.getElementById('fb-desc').value.trim(), url: fbGetUrl(), scope };
  for (const [idx, q] of (_fbQuestions || []).entries()) {
    payload['question_' + (idx + 1)] = q;
    const ta = document.getElementById('fb-answer-' + idx);
    payload['a' + (idx + 1)] = ta ? ta.value : '';
  }
  view_post(safeViewName, 'submit_feedback_with_answers', payload, (resp) => {
    if (resp && !resp.error) {
      document.getElementById('fb-step1').style.display = 'none';
      document.getElementById('fb-success').style.display = '';
      if (typeof refreshFeedbackViews === 'function') refreshFeedbackViews();
    }
  });
};
})();
</script>`;

  return {
    html: feedbackFormInner(phases, preselectedScope) + standaloneScript,
    title: "Submit feedback",
  };
};

const add_feedback_to_menu = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  if (!features.view_route_modal) {
    return {
      json: {
        error: "requires_newer_saltcorn",
        notify_error:
          "Adding a navbar feedback button requires a newer version of Saltcorn.",
      },
    };
  }

  const menuUrl = `javascript:ajax_modal('/view/${encodeURIComponent(
    viewname
  )}/get_feedback_form', {method:'POST'})`;
  const current = getState().getConfig("menu_items", []);
  const alreadyAdded = current.some(
    (mi) => mi.type === "Link" && mi.url?.includes("get_feedback_form")
  );
  if (!alreadyAdded) {
    await save_menu_items([
      ...current,
      {
        type: "Link",
        label: "Feedback",
        text: "Feedback",
        icon: "fas fa-comment-alt",
        url: menuUrl,
        min_role: 80,
      },
    ]);
  }
  return { json: { success: true } };
};

/**
 * Route: deletes a single processed feedback metadata entry.
 */
const del_feedback = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const r = await MetaData.findOne({ id: body.id });
  if (!r) throw new Error("Feedback not found");
  const feedbackId = r.body?.feedback_id;
  await r.delete();

  // just to be sure
  // feedback_research_${body.id} should already be cleaned up
  const stale = await MetaData.findOne({
    type: pt,
    name: `feedback_research_${body.id}`,
  });
  if (stale) {
    getState().log(
      5,
      `del_feedback: found stale feedback_research_${body.id}, deleting`
    );
    await stale.delete();
  }

  // delete tasks generated from this feedback
  const tasks = await MetaData.find({ type: pt, name: "task" });
  for (const t of tasks.filter((t) => t.body?.feedback_id === feedbackId))
    await t.delete();

  return { json: { success: true } };
};

/**
 * Route: deletes all processed feedback metadata entries.
 */
const del_all_feedback = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const rs = await MetaData.find({
    type: pt,
    name: "feedback",
  });
  for (const r of rs) {
    await r.delete();
    const stale = await MetaData.findOne({
      type: pt,
      name: `feedback_research_${r.id}`,
    });
    if (stale) {
      getState().log(
        5,
        `del_all_feedback: found stale feedback_research_${r.id}, deleting`
      );
      await stale.delete();
    }
  }
  return { json: { success: true } };
};

/**
 * Route: asks the LLM whether the feedback needs clarification.
 * Returns an array of questions, or an empty array if the feedback is clear.
 */
const analyse_feedback = async (table_id, vn, config, body, { req, res }) => {
  const pt = getPt(body, req);
  const { title, description, url = "" } = body;

  let knownContext = null;
  if (url) {
    const mView = url.match(/\/view\/([^/?#]+)/);
    const mPage = url.match(/\/page\/([^/?#]+)/);
    const entityType = mView ? "view" : mPage ? "page" : null;
    const entityName = mView?.[1] ?? mPage?.[1] ?? null;
    if (entityType) {
      knownContext = {
        section:
          "Known context (do NOT ask about these — they are already established facts):\n" +
          `- The feedback targets the Saltcorn ${entityType} named "${entityName}"\n` +
          `- URL: ${url}\n`,
        doNotAsk:
          `- Which ${entityType}, screen, or part of the application this concerns` +
          ` — it is the ${entityType} "${entityName}" as stated above`,
      };
    } else {
      knownContext = {
        section: `Known context:\n- URL: ${url}\n`,
        doNotAsk: null,
      };
    }
  }

  const generator = await PromptGenerator.createInstance({ pt });

  const answer = await getState().functions.llm_generate.run(
    generator.feedbackAnalysePrompt({ title, description, knownContext }),
    {
      tools: [questions_tool],
      systemPrompt:
        "You are a requirements analyst reviewing user feedback. " +
        "Your default is to ask NO questions — only use the tool when something\n" +
        "is genuinely too ambiguous to act on without clarification.\n" +
        "Never fish for detail that a competent developer could infer or decide themselves.",
    }
  );
  const tc =
    typeof answer.getToolCalls === "function"
      ? answer.getToolCalls()[0]
      : undefined;
  return { json: { questions: tc?.input?.questions ?? [] } };
};

/**
 * Route: creates a new pending feedback MetaData record and stores any Q&A answers
 * as a separate metadata record keyed by the record id.
 */
const submit_feedback_with_answers = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const pt = getPt(body, req);
  const { _csrf, title, description, url, scope, ...rest } = body;

  const phaseMatch = (scope || "").match(/^phase_(\d+)$/);
  const phase_idx = phaseMatch ? parseInt(phaseMatch[1]) : null;

  const newMd = await MetaData.create({
    type: pt,
    name: "feedback_pending",
    body: {
      title,
      description: description || null,
      url: url || null,
      scope: scope || "overall",
      phase_idx,
      status: "Pending",
    },
    user_id: req?.user?.id,
  });
  const rowId = newMd.id;

  const questions = [];
  const answers = {};
  let idx = 1;
  while (rest[`question_${idx}`] !== undefined) {
    questions.push(rest[`question_${idx}`]);
    answers[`q${idx}`] = rest[`a${idx}`] || "";
    idx++;
  }

  if (questions.length) {
    await MetaData.create({
      type: pt,
      name: `feedback_research_${rowId}`,
      body: {
        feedback_id: rowId,
        title,
        questions,
        answers,
      },
    });
  }

  return { json: { success: true } };
};

const feedback_routes = {
  del_feedback,
  del_all_feedback,
  feedback_views_html,
  get_feedback_form,
  start_approve_feedback,
  approval_status,
  delete_feedback_row,
  analyse_feedback,
  submit_feedback_with_answers,
  get_feedback_edit_html,
  save_feedback_edit,
  show_processed_feedback,
  add_feedback_to_menu,
};

module.exports = { feedbackList, feedback_routes };
