const feedbackAction = require("./feedback-action.js");
const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const MetaData = require("@saltcorn/data/models/metadata");
const View = require("@saltcorn/data/models/view");
const Page = require("@saltcorn/data/models/page");
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
  input,
  label,
  textarea,
  small,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const { viewname, tool_choice } = require("./common");
const { questions_tool } = require("./research");

const FEEDBACK_TABLE = "app_constructor_feedback";

const feedbackFormHtml = () =>
  div(
    { id: "feedback-form-area", class: "mt-3 border p-3 rounded", style: "display:none" },
    div(
      { id: "feedback-form-step1" },
      p({ class: "fw-semibold mb-3" }, "Add feedback"),
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
        label({ class: "form-label", for: "fb-url" }, "URL"),
        input({ type: "text", class: "form-control", id: "fb-url" })
      ),
      div(
        { id: "fb-step1-spinner", class: "my-2 text-muted", style: "display:none" },
        i({ class: "fas fa-spinner fa-spin me-2" }),
        "Generating questions..."
      ),
      div(
        { class: "mt-2" },
        button(
          {
            type: "button",
            class: "btn btn-primary me-2",
            id: "fb-gen-btn",
            onclick: "copilotGenQuestionsForForm()",
          },
          "Generate questions"
        ),
        button(
          {
            type: "button",
            class: "btn btn-outline-secondary",
            onclick: "copilotCancelFeedbackForm()",
          },
          "Cancel"
        )
      )
    ),
    div(
      { id: "feedback-form-step2", style: "display:none" },
      p({ class: "fw-semibold mb-2" }, "Answer questions"),
      small(
        { class: "text-muted d-block mb-3" },
        "Answer these to help understand your feedback better. You can skip any."
      ),
      div({ id: "fb-questions-area" }),
      div(
        { class: "mt-3" },
        button(
          {
            type: "button",
            class: "btn btn-primary me-2",
            onclick: "copilotSubmitFeedbackForm()",
          },
          "Submit feedback"
        ),
        button(
          {
            type: "button",
            class: "btn btn-outline-secondary",
            onclick: "copilotBackToStep1()",
          },
          "Back"
        )
      )
    )
  );

const feedbackStandalonePageContent = () => {
  const safeViewNameJson = JSON.stringify(viewname);

  const formHtml =
    div(
      { id: "fbs-step1" },
      h5({ class: "mb-3" }, "Submit feedback"),
      div(
        { class: "mb-3" },
        label({ class: "form-label", for: "fbs-title" }, "Title"),
        input({ type: "text", class: "form-control", id: "fbs-title" })
      ),
      div(
        { class: "mb-3" },
        label({ class: "form-label", for: "fbs-desc" }, "Description"),
        textarea({ class: "form-control", id: "fbs-desc", rows: 3 }, "")
      ),
      div(
        { class: "mb-3" },
        label({ class: "form-label", for: "fbs-url" }, "URL"),
        input({ type: "text", class: "form-control", id: "fbs-url" })
      ),
      div(
        { id: "fbs-spinner", class: "my-2 text-muted", style: "display:none" },
        i({ class: "fas fa-spinner fa-spin me-2" }),
        "Generating questions..."
      ),
      div(
        { class: "mt-2" },
        button(
          {
            type: "button",
            class: "btn btn-primary",
            id: "fbs-gen-btn",
            onclick: "fbsGenQuestions()",
          },
          "Generate questions"
        )
      )
    ) +
    div(
      { id: "fbs-step2", style: "display:none" },
      p({ class: "fw-semibold mb-2" }, "Answer questions"),
      small(
        { class: "text-muted d-block mb-3" },
        "Answer these to help understand your feedback. You can skip any."
      ),
      div({ id: "fbs-questions-area" }),
      div(
        { class: "mt-3" },
        button(
          {
            type: "button",
            class: "btn btn-primary me-2",
            onclick: "fbsSubmit()",
          },
          "Submit feedback"
        ),
        button(
          {
            type: "button",
            class: "btn btn-outline-secondary",
            onclick: "fbsBackToStep1()",
          },
          "Back"
        )
      )
    ) +
    div(
      { id: "fbs-success", class: "text-success mt-3", style: "display:none" },
      i({ class: "fas fa-check-circle me-2" }),
      "Thank you! Your feedback has been submitted."
    );

  const clientScript = script(
    domReady(`
const safeViewName = ${safeViewNameJson};
let _fbsQuestions = [];
window.fbsGenQuestions = () => {
  const title = document.getElementById('fbs-title').value.trim();
  if (!title) {
    document.getElementById('fbs-title').classList.add('is-invalid');
    return;
  }
  document.getElementById('fbs-title').classList.remove('is-invalid');
  const description = document.getElementById('fbs-desc').value.trim();
  document.getElementById('fbs-spinner').style.display = '';
  const btn = document.getElementById('fbs-gen-btn');
  if (btn) btn.disabled = true;
  view_post(safeViewName, 'gen_questions_for_form', { title, description }, (resp) => {
    document.getElementById('fbs-spinner').style.display = 'none';
    if (btn) btn.disabled = false;
    if (!resp || resp.error) return;
    const questions = resp.questions || [];
    _fbsQuestions = questions;
    if (questions.length === 0) { fbsSubmit(); return; }
    const area = document.getElementById('fbs-questions-area');
    area.innerHTML = '';
    for (const [idx, q] of questions.entries()) {
      const wrapper = document.createElement('div');
      wrapper.className = 'mb-3';
      const lbl = document.createElement('label');
      lbl.className = 'form-label';
      lbl.textContent = q;
      lbl.htmlFor = 'fbs-answer-' + idx;
      const ta = document.createElement('textarea');
      ta.className = 'form-control';
      ta.id = 'fbs-answer-' + idx;
      ta.rows = 2;
      wrapper.appendChild(lbl);
      wrapper.appendChild(ta);
      area.appendChild(wrapper);
    }
    document.getElementById('fbs-step1').style.display = 'none';
    document.getElementById('fbs-step2').style.display = '';
  });
};
window.fbsBackToStep1 = () => {
  document.getElementById('fbs-step1').style.display = '';
  document.getElementById('fbs-step2').style.display = 'none';
};
window.fbsSubmit = () => {
  const title = document.getElementById('fbs-title').value.trim();
  const description = document.getElementById('fbs-desc').value.trim();
  const url = document.getElementById('fbs-url').value.trim();
  const payload = { title, description, url };
  for (const [idx, q] of _fbsQuestions.entries()) {
    payload['question_' + (idx + 1)] = q;
    const ta = document.getElementById('fbs-answer-' + idx);
    payload['a' + (idx + 1)] = ta ? ta.value : '';
  }
  view_post(safeViewName, 'submit_feedback_with_answers', payload, (resp) => {
    if (resp && !resp.error) {
      document.getElementById('fbs-step1').style.display = 'none';
      document.getElementById('fbs-step2').style.display = 'none';
      document.getElementById('fbs-success').style.display = '';
    }
  });
};
`)
  );

  return div(
    { class: "row" },
    div({ class: "col-md-8" }, formHtml + clientScript)
  );
};

// Pure HTML for both pending and processed sections — no scripts, safe for innerHTML injection
const feedbackViewsContent = async () => {
  const safeViewName = JSON.stringify(viewname);
  const table = Table.findOne({ name: FEEDBACK_TABLE });
  const genFeedbackResearch = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_feedback_research",
  });

  let pendingSection = "";
  if (table) {
    const rows = await table.getRows({}, { orderBy: "id" });

    const addButton = button(
      {
        class: "btn btn-outline-primary btn-sm mt-1",
        title: "Submit feedback",
        onclick: "copilotShowFeedbackForm();return false;",
      },
      i({ class: "fas fa-plus me-1" }),
      "Add feedback"
    );

    if (!rows.length) {
      pendingSection =
        h5({ class: "mb-2" }, "Pending feedback") +
        p({ class: "text-muted mt-2" }, "No pending feedback submissions.") +
        addButton;
    } else {
      const tableHtml = mkTable(
        [
          { label: "Title", key: (r) => r.title },
          { label: "Description", key: (r) => r.description || "" },
          { label: "URL", key: (r) => r.url || "" },
          { label: "Status", key: (r) => r.status || "" },
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
              button(
                {
                  class: "btn btn-success btn-sm me-1",
                  id: `approve-btn-${r.id}`,
                  onclick: `copilotApprove(${r.id})`,
                },
                "Approve"
              ) +
              button(
                {
                  class: "btn btn-outline-danger btn-sm",
                  onclick: `copilotDeleteFeedback(${r.id})`,
                },
                i({ class: "fas fa-trash-alt" })
              ),
          },
        ],
        rows
      );
      pendingSection =
        h5({ class: "mb-2" }, "Pending feedback") + tableHtml + addButton;
    }
    if (genFeedbackResearch) {
      pendingSection += p(
        { class: "text-muted small mt-2" },
        i({ class: "fas fa-spinner fa-spin me-2" }),
        "Generating feedback questions..."
      );
    }
  }

  const processed = await MetaData.find(
    { type: "CopilotConstructMgr", name: "feedback" },
    { orderBy: "written_at" }
  );
  const processedSection = div(
    { class: "mt-4" },
    h5("Processed feedback"),
    processed.length
      ? div(
          mkTable(
            [
              { label: "Title", key: (m) => m.body.title },
              { label: "Description", key: (m) => m.body.description },
              {
                label: "Delete",
                key: (r) =>
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

const feedbackList = async () => {
  const table = Table.findOne({ name: FEEDBACK_TABLE });
  const safeViewName = JSON.stringify(viewname);

  let topSection;
  if (table) {
    topSection = div(
      { id: "feedback-views-area" },
      await feedbackViewsContent()
    );
  } else {
    topSection = div(
      { class: "mb-3", id: "feedback-views-area" },
      button(
        { class: "btn btn-primary", onclick: "copilotSetupFeedback()" },
        i({ class: "fas fa-cog me-2" }),
        "Setup feedback system"
      )
    );
  }

  const clientScript = script(
    domReady(`
const safeViewName = ${safeViewName};
window.refreshFeedbackViews = () => {
  view_post(safeViewName, 'feedback_views_html', {}, (r) => {
    if (r && r.html) document.getElementById('feedback-views-area').innerHTML = r.html;
  });
};
window.copilotSetupFeedback = () => {
  const area = document.getElementById('feedback-views-area');
  area.innerHTML = '<p><i class="fas fa-spinner fa-spin me-2"></i>Setting up...</p>';
  view_post(safeViewName, 'setup_feedback_system', {}, (resp) => {
    if (resp && !resp.error) refreshFeedbackViews();
    else area.innerHTML = '<button class="btn btn-primary" onclick="copilotSetupFeedback()">' +
      '<i class="fas fa-cog me-2"></i>Setup feedback system</button>';
  });
};
window.copilotApprove = (id) => {
  const btn = document.getElementById('approve-btn-' + id);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  view_post(safeViewName, 'start_approve_feedback', { id }, () => {
    const poll = () => {
      view_post(safeViewName, 'approval_status', { id }, (resp) => {
        if (resp && !resp.approving) refreshFeedbackViews();
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
let _feedbackModalPending = false;
window.copilotOpenFeedbackEdit = (id) => {
  _feedbackModalPending = true;
  ajax_modal('/view/app_constructor_feedback_edit?id=' + id);
};
document.addEventListener('hidden.bs.modal', () => {
  if (_feedbackModalPending) {
    _feedbackModalPending = false;
    refreshFeedbackViews();
  }
});
window.copilotShowFeedbackForm = () => {
  const area = document.getElementById('feedback-form-area');
  const step1 = document.getElementById('feedback-form-step1');
  const step2 = document.getElementById('feedback-form-step2');
  area.style.display = '';
  step1.style.display = '';
  step2.style.display = 'none';
  document.getElementById('fb-title').value = '';
  document.getElementById('fb-desc').value = '';
  document.getElementById('fb-url').value = '';
  document.getElementById('fb-step1-spinner').style.display = 'none';
  const genBtn = document.getElementById('fb-gen-btn');
  if (genBtn) genBtn.disabled = false;
};
window.copilotCancelFeedbackForm = () => {
  document.getElementById('feedback-form-area').style.display = 'none';
};
window.copilotGenQuestionsForForm = () => {
  const title = document.getElementById('fb-title').value.trim();
  if (!title) {
    document.getElementById('fb-title').classList.add('is-invalid');
    return;
  }
  document.getElementById('fb-title').classList.remove('is-invalid');
  const description = document.getElementById('fb-desc').value.trim();
  document.getElementById('fb-step1-spinner').style.display = '';
  const genBtn = document.getElementById('fb-gen-btn');
  if (genBtn) genBtn.disabled = true;
  view_post(safeViewName, 'gen_questions_for_form', { title, description }, (resp) => {
    document.getElementById('fb-step1-spinner').style.display = 'none';
    if (genBtn) genBtn.disabled = false;
    if (!resp || resp.error) return;
    const questions = resp.questions || [];
    window._fbFormQuestions = questions;
    if (questions.length === 0) {
      copilotSubmitFeedbackForm();
      return;
    }
    const qArea = document.getElementById('fb-questions-area');
    qArea.innerHTML = '';
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
      qArea.appendChild(wrapper);
    }
    document.getElementById('feedback-form-step1').style.display = 'none';
    document.getElementById('feedback-form-step2').style.display = '';
  });
};
window.copilotBackToStep1 = () => {
  document.getElementById('feedback-form-step1').style.display = '';
  document.getElementById('feedback-form-step2').style.display = 'none';
};
window.copilotSubmitFeedbackForm = () => {
  const title = document.getElementById('fb-title').value.trim();
  const description = document.getElementById('fb-desc').value.trim();
  const url = document.getElementById('fb-url').value.trim();
  const questions = window._fbFormQuestions || [];
  const payload = { title, description, url };
  for (const [idx, q] of questions.entries()) {
    payload['question_' + (idx + 1)] = q;
    const ta = document.getElementById('fb-answer-' + idx);
    payload['a' + (idx + 1)] = ta ? ta.value : '';
  }
  view_post(safeViewName, 'submit_feedback_with_answers', payload, (resp) => {
    if (resp && !resp.error) {
      document.getElementById('feedback-form-area').style.display = 'none';
      refreshFeedbackViews();
    }
  });
};
`)
  );

  return div({ class: "mt-2" }, topSection, table ? feedbackFormHtml() : "", clientScript);
};

// AJAX route — returns the views content HTML for in-place refresh
const feedback_views_html = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const html = await feedbackViewsContent();
  return { json: { html } };
};

const start_approve_feedback = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const id = parseInt(body.id);
  const table = Table.findOne({ name: FEEDBACK_TABLE });
  const rows = await table.getRows({ id });
  const row = rows[0];
  if (!row) return { json: { error: "Not found" } };

  const mdName = `approving_feedback_${id}`;
  await MetaData.create({
    type: "CopilotConstructMgr",
    name: mdName,
    body: { id },
  });

  const researchMd = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: `feedback_research_${id}`,
  });
  let research_context = null;
  if (researchMd) {
    const questions = researchMd.body.questions || [];
    const answers = researchMd.body.answers || {};
    const pairs = questions
      .map((q, idx) => {
        const a = answers[`q${idx + 1}`];
        return `Q: ${q}\nA: ${a && a.trim() ? a.trim() : "(no answer)"}`;
      });
    if (pairs.length) research_context = pairs.join("\n\n");
  }

  feedbackAction
    .run({
      row,
      table,
      user: req.user,
      mode: "table",
      req,
      configuration: {
        title_field: "title",
        description_field: "description",
        url_field: "url",
        research_context,
      },
    })
    .then(async () => {
      const md = await MetaData.findOne({
        type: "CopilotConstructMgr",
        name: mdName,
      });
      if (md) await md.delete();
      await table.deleteRows({ id });
      const rmd = await MetaData.findOne({
        type: "CopilotConstructMgr",
        name: `feedback_research_${id}`,
      });
      if (rmd) await rmd.delete();
    })
    .catch(async (e) => {
      console.error("approve_feedback error", e);
      const md = await MetaData.findOne({
        type: "CopilotConstructMgr",
        name: mdName,
      });
      if (md) await md.delete();
    });

  return { json: { success: true } };
};

const approval_status = async (table_id, vn, config, body, { req, res }) => {
  const id = parseInt(body.id);
  const md = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: `approving_feedback_${id}`,
  });
  return { json: { approving: !!md } };
};

const delete_feedback_row = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const id = parseInt(body.id);
  const table = Table.findOne({ name: FEEDBACK_TABLE });
  await table.deleteRows({ id });
  const rmd = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: `feedback_research_${id}`,
  });
  if (rmd) await rmd.delete();
  return { json: { success: true } };
};

const setup_feedback_system = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const table = await Table.create(FEEDBACK_TABLE);

  await Field.create({
    table_id: table.id,
    name: "title",
    label: "Title",
    type: "String",
    required: true,
  });
  await Field.create({
    table_id: table.id,
    name: "description",
    label: "Description",
    type: "String",
  });
  await Field.create({
    table_id: table.id,
    name: "url",
    label: "URL",
    type: "String",
  });
  await Field.create({
    table_id: table.id,
    name: "status",
    label: "Status",
    type: "String",
    attributes: { options: "Pending,Approved,Rejected" },
  });

  const labelFieldRow = (labelText, fieldName, fieldview = "edit") => ({
    style: { "margin-bottom": "1.5rem" },
    aligns: ["end", "start"],
    widths: [2, 10],
    breakpoints: ["md", "md"],
    mobileAligns: ["start"],
    setting_col_n: 0,
    besides: [
      {
        type: "blank",
        block: false,
        inline: false,
        font: "",
        style: {},
        textStyle: "",
        customClass: "",
        isFormula: {},
        contents: labelText,
        labelFor: fieldName,
      },
      {
        type: "field",
        block: false,
        fieldview,
        textStyle: "",
        field_name: fieldName,
        configuration: {},
      },
    ],
  });

  const saveButtonRow = (label = "") => ({
    style: { "margin-bottom": "1.5rem" },
    aligns: ["end", "start"],
    widths: [2, 10],
    breakpoints: ["", ""],
    setting_col_n: 0,
    besides: [
      null,
      {
        type: "action",
        block: false,
        rndid: "a1b2c3",
        nsteps: "",
        minRole: 100,
        isFormula: {},
        run_async: false,
        action_icon: "",
        action_name: "Save",
        action_size: "",
        action_bgcol: "",
        action_class: "",
        action_label: label,
        action_style: "btn-primary",
        action_title: "",
        configuration: {},
        step_only_ifs: "",
        action_textcol: "",
        action_bordercol: "",
        step_action_names: "",
      },
    ],
  });

  // User-facing feedback submission page (two-step: generate questions then save)
  await Page.create({
    name: "app_constructor_feedback_form",
    title: "Submit feedback",
    description: "",
    min_role: 80,
    layout: {
      above: [
        {
          type: "blank",
          contents: feedbackStandalonePageContent(),
          block: false,
        },
      ],
    },
    fixed_states: {},
  });

  // Admin edit view — opened as popup from the feedback tab
  await View.create({
    name: "app_constructor_feedback_edit",
    viewtemplate: "Edit",
    table_id: table.id,
    min_role: 1,
    configuration: {
      layout: {
        above: [
          labelFieldRow("Title", "title"),
          labelFieldRow("Description", "description", "textarea"),
          labelFieldRow("URL", "url"),
          labelFieldRow("Status", "status"),
          saveButtonRow(),
        ],
      },
      columns: [
        {
          type: "Field",
          block: false,
          fieldview: "edit",
          textStyle: "",
          field_name: "title",
          configuration: {},
        },
        {
          type: "Field",
          block: false,
          fieldview: "textarea",
          textStyle: "",
          field_name: "description",
          configuration: {},
        },
        {
          type: "Field",
          block: false,
          fieldview: "edit",
          textStyle: "",
          field_name: "url",
          configuration: {},
        },
        {
          type: "Field",
          block: false,
          fieldview: "edit",
          textStyle: "",
          field_name: "status",
          configuration: {},
        },
      ],
    },
  });

  return { json: { success: true, notify_success: "Feedback system created" } };
};

const del_feedback = async (table_id, vn, config, body, { req, res }) => {
  const r = await MetaData.findOne({ id: body.id });
  if (!r) throw new Error("Feedback not found");
  await r.delete();
  return { json: { success: true } };
};

const del_all_feedback = async (table_id, vn, config, body, { req, res }) => {
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "feedback",
  });
  for (const r of rs) await r.delete();
  return { json: { success: true } };
};

const gen_questions_for_form = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const { title, description } = body;
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  const answer = await getState().functions.llm_generate.run(
    `${
      spec?.body?.specification
        ? `The following application is being built:\n\n${spec.body.specification}\n\n`
        : ""
    }A user wants to submit the following feedback:

Title: ${title}
${description ? `Description: ${description}\n` : ""}
Generate clarifying questions about this feedback that would help understand
what specific changes or additions are needed.
Ask only about genuinely ambiguous or underspecified aspects.
Keep questions clear and concise. 5 is a hard maximum — ask fewer if the feedback is already clear.

Now call the ask_questions tool with your questions.`,
    {
      tools: [questions_tool],
      ...tool_choice("ask_questions"),
      systemPrompt:
        "You are a requirements analyst helping to clarify user feedback. " +
        "Ask only what is truly needed to understand the feedback — fewer is better.",
    }
  );
  const tc = answer.getToolCalls()[0];
  return { json: { questions: tc.input.questions } };
};

const submit_feedback_with_answers = async (
  table_id,
  vn,
  config,
  body,
  { req, res }
) => {
  const { _csrf, title, description, url, ...rest } = body;
  const table = Table.findOne({ name: FEEDBACK_TABLE });
  if (!table) return { json: { error: "Feedback table not found" } };

  const rowId = await table.insertRow({
    title,
    description: description || null,
    url: url || null,
    status: "Pending",
  });

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
      type: "CopilotConstructMgr",
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
  setup_feedback_system,
  feedback_views_html,
  start_approve_feedback,
  approval_status,
  delete_feedback_row,
  gen_questions_for_form,
  submit_feedback_with_answers,
};

module.exports = { feedbackList, feedback_routes };
