const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const MetaData = require("@saltcorn/data/models/metadata");
const View = require("@saltcorn/data/models/view");
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
} = require("@saltcorn/markup/tags");
const { viewname } = require("./common");

const FEEDBACK_TABLE = "app_constructor_feedback";

// Pure HTML for both pending and processed sections — no scripts, safe for innerHTML injection
const feedbackViewsContent = async () => {
  const _vn = JSON.stringify(viewname);
  const table = Table.findOne({ name: FEEDBACK_TABLE });

  let pendingSection = "";
  if (table) {
    const rows = await table.getRows({}, { orderBy: "id" });

    const addButton = button(
      {
        class: "btn btn-outline-primary btn-sm mt-1",
        title: "Submit feedback",
        onclick: "copilotOpenFeedbackForm();return false;",
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
                      onclick: `view_post(${_vn}, "del_feedback", {id:${r.id}}, refreshFeedbackViews)`,
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
              onclick: `view_post(${_vn}, "del_all_feedback", {}, refreshFeedbackViews)`,
            },
            "Delete all"
          )
        )
      : p({ class: "text-muted" }, "No processed feedback yet.")
  );

  return pendingSection + processedSection;
};

const feedbackList = async (req, res) => {
  const table = Table.findOne({ name: FEEDBACK_TABLE });
  const _vn = JSON.stringify(viewname);

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
const _vn = ${_vn};
window.refreshFeedbackViews = () => {
  view_post(_vn, 'feedback_views_html', {}, (r) => {
    if (r && r.html) document.getElementById('feedback-views-area').innerHTML = r.html;
  });
};
window.copilotSetupFeedback = () => {
  const area = document.getElementById('feedback-views-area');
  area.innerHTML = '<p><i class="fas fa-spinner fa-spin me-2"></i>Setting up...</p>';
  view_post(_vn, 'setup_feedback_system', {}, (resp) => {
    if (resp && !resp.error) refreshFeedbackViews();
    else area.innerHTML = '<button class="btn btn-primary" onclick="copilotSetupFeedback()">' +
      '<i class="fas fa-cog me-2"></i>Setup feedback system</button>';
  });
};
window.copilotApprove = (id) => {
  const btn = document.getElementById('approve-btn-' + id);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  view_post(_vn, 'start_approve_feedback', { id }, () => {
    const poll = () => {
      view_post(_vn, 'approval_status', { id }, (resp) => {
        if (resp && !resp.approving) refreshFeedbackViews();
        else setTimeout(poll, 3000);
      });
    };
    setTimeout(poll, 3000);
  });
};
window.copilotDeleteFeedback = (id) => {
  view_post(_vn, 'delete_feedback_row', { id }, (resp) => {
    if (resp && !resp.error) refreshFeedbackViews();
  });
};
let _feedbackModalPending = false;
window.copilotOpenFeedbackForm = () => {
  _feedbackModalPending = true;
  ajax_modal('/view/app_constructor_feedback_form');
};
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
`)
  );

  return div({ class: "mt-2" }, topSection, clientScript);
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

  const feedbackAction = require("./feedback-action.js");
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
      },
    })
    .then(async () => {
      const md = await MetaData.findOne({
        type: "CopilotConstructMgr",
        name: mdName,
      });
      if (md) await md.delete();
      await table.deleteRows({ id });
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

  // User-facing feedback submission form
  await View.create({
    name: "app_constructor_feedback_form",
    viewtemplate: "Edit",
    table_id: table.id,
    min_role: 80,
    configuration: {
      layout: {
        above: [
          labelFieldRow("Title", "title"),
          labelFieldRow("Description", "description", "textarea"),
          labelFieldRow("URL", "url"),
          saveButtonRow("Submit feedback"),
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
          type: "Action",
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
          action_label: "Submit feedback",
          action_style: "btn-primary",
          action_title: "",
          configuration: {},
          step_only_ifs: "",
          action_textcol: "",
          action_bordercol: "",
          step_action_names: "",
        },
      ],
    },
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

const feedback_routes = {
  del_feedback,
  del_all_feedback,
  setup_feedback_system,
  feedback_views_html,
  start_approve_feedback,
  approval_status,
  delete_feedback_row,
};

module.exports = { feedbackList, feedback_routes };
