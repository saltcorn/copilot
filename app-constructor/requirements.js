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
const { viewname, tool_choice } = require("./common");
const { requirements_tool } = require("./tools");
const { PromptGenerator } = require("./prompt-generator");

const requirementsStaticScript = `<script>
const _reqsVn = ${JSON.stringify(viewname)};

window.copilotRefreshReqs = () => {
  view_post(_reqsVn, 'req_list_html', {}, (r) => {
    const a = document.getElementById('req-list-area');
    if (r && r.html && a) {
      a.innerHTML = r.html;
      if (typeof copilotInitReqsState === 'function') copilotInitReqsState();
    }
  });
};

window.copilotGenReqs = function() {
  const area = document.getElementById('req-gen-area');
  if (area) area.innerHTML =
    '<p><i class="fas fa-spinner fa-spin me-2"></i>Generating requirements, please wait...</p>';
  view_post(_reqsVn, 'gen_reqs', {}, () => {});
  if (!window.dynamic_updates_cfg?.enabled) {
    const poll = () => {
      view_post(_reqsVn, 'req_status', {}, (resp) => {
        if (resp && !resp.generating) {
          if (typeof copilotRefreshReqs === 'function') copilotRefreshReqs();
        } else setTimeout(poll, 3000);
      });
    };
    setTimeout(poll, 3000);
  }
};

function copilotInitReqsState() {
  const isGenerating = !!document.getElementById('reqs-generating-state');
  if (isGenerating) {
    const poll = () => {
      view_post(_reqsVn, 'req_status', {}, (resp) => {
        if (resp && !resp.generating) {
          if (typeof copilotRefreshReqs === 'function') copilotRefreshReqs();
        } else setTimeout(poll, 3000);
      });
    };
    if (!window.dynamic_updates_cfg?.enabled) setTimeout(poll, 3000);
  }
}
window.copilotInitReqsState = copilotInitReqsState;

(function () {
  if (document.readyState !== 'loading') copilotInitReqsState();
  else document.addEventListener('DOMContentLoaded', copilotInitReqsState);
})();
</script>`;

const requirementsList = async (req) => {
  const rs = await MetaData.find(
    {
      type: "CopilotConstructMgr",
      name: "requirement",
    },
    { orderBy: "written_at" }
  );
  const starFieldview = getState().types.Integer.fieldviews.show_star_rating;

  if (rs.length) {
    return div(
      { class: "mt-2" },
      mkTable(
        [
          {
            label: "Requirement",
            key: (m) =>
              m.body.requirement +
              (m.body.source === "feedback"
                ? span(
                    {
                      class: "badge bg-warning text-dark ms-2 fw-normal",
                      title: `From feedback: ${m.body.feedback_title || ""}`,
                    },
                    i({ class: "fas fa-comment-alt me-1" }),
                    "feedback"
                  )
                : ""),
          },
          {
            label: "Priority",
            key: (m) =>
              starFieldview.run(m.body.priority, req, { min: 1, max: 5 }),
          },
          {
            label: "Delete",
            key: (r) =>
              button(
                {
                  class: "btn btn-outline-danger btn-sm",
                  onclick: `view_post("${viewname}", "del_req", {id:${r.id}})`,
                },
                i({ class: "fas fa-trash-alt" })
              ),
          },
        ],
        rs
      ),
      button(
        {
          class: "btn btn-outline-danger mb-4",
          onclick: `view_post("${viewname}", "del_all_reqs")`,
        },
        "Delete all"
      )
    );
  }

  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_requirements",
  });
  if (generating) {
    return div(
      { class: "mt-2" },
      p(
        { id: "reqs-generating-state" },
        i({ class: "fas fa-spinner fa-spin me-2" }),
        "Generating requirements, please wait..."
      )
    );
  }

  return div(
    { class: "mt-2", id: "req-gen-area" },
    p("No requirements found"),
    button(
      { class: "btn btn-primary", onclick: `copilotGenReqs()` },
      "Generate requirements"
    )
  );
};

const doGenReqs = async (userId) => {
  const generatingMd = await MetaData.create({
    type: "CopilotConstructMgr",
    name: "generating_requirements",
    body: {},
    user_id: userId,
  });
  try {
    const generator = await PromptGenerator.createInstance();
    if (!generator.spec) throw new Error("Specification not found");
    const answer = await getState().functions.llm_generate.run(
      generator.requirementsPlanPrompt(),
      {
        tools: [requirements_tool],
        ...tool_choice("make_requirements"),
        systemPrompt:
          "You are a project manager extracting requirements from a written specification.\n" +
          "Only include what is explicitly stated — do not infer or add plausible extras.",
      }
    );
    const tc = answer.getToolCalls()[0];
    for (const reqm of tc.input.requirements)
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: "requirement",
        body: reqm,
        user_id: userId,
      });
  } finally {
    await generatingMd.delete();
    try {
      getState().emitDynamicUpdate(db.getTenantSchema(), {
        eval_js:
          "if(typeof copilotRefreshReqs==='function')copilotRefreshReqs();",
      });
    } catch (_) {}
  }
};

const gen_reqs = async (table_id, viewname, config, body, { req, res }) => {
  doGenReqs(req.user?.id).catch((e) => console.error("gen_reqs error", e));
  return { json: { success: true } };
};

const req_status = async (table_id, viewname, config, body, { req, res }) => {
  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_requirements",
  });
  return { json: { generating: !!generating } };
};

const del_req = async (table_id, viewname, config, body, { req, res }) => {
  const r = await MetaData.findOne({
    id: body.id,
  });

  if (!r) throw new Error("Requirement not found");
  await r.delete();
  return {
    json: {
      eval_js:
        "if(typeof copilotRefreshReqs==='function')copilotRefreshReqs();",
    },
  };
};
const del_all_reqs = async (table_id, viewname, config, body, { req, res }) => {
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "requirement",
  });
  for (const r of rs) await r.delete();
  return {
    json: {
      eval_js:
        "if(typeof copilotRefreshReqs==='function')copilotRefreshReqs();",
    },
  };
};

/** Route: returns the rendered requirements list HTML for AJAX refresh. */
const req_list_html = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const html = await requirementsList(req);
  return { json: { html } };
};

const req_routes = {
  gen_reqs,
  req_status,
  del_req,
  del_all_reqs,
  req_list_html,
};

module.exports = { requirementsList, requirementsStaticScript, req_routes };
