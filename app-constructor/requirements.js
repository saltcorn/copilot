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
const { getResearchAnswersText } = require("./research");
const { research_answers_section } = require("./prompts");

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
        i({ class: "fas fa-spinner fa-spin me-2" }),
        "Generating requirements, please wait..."
      ),
      script(
        domReady(`
const poll = () => {
  view_post(${JSON.stringify(viewname)}, 'req_status', {}, (resp) => {
    if (resp && !resp.generating) location.reload();
    else setTimeout(poll, 3000);
  });
};
setTimeout(poll, 3000);
`)
      )
    );
  }

  return div(
    { class: "mt-2", id: "req-gen-area" },
    p("No requirements found"),
    button(
      { class: "btn btn-primary", onclick: `copilotGenReqs()` },
      "Generate requirements"
    ),
    script(
      domReady(`
window.copilotGenReqs = () => {
  document.getElementById('req-gen-area').innerHTML =
    '<p><i class="fas fa-spinner fa-spin me-2"></i>Generating requirements, please wait...</p>';
  view_post(${JSON.stringify(viewname)}, 'gen_reqs', {}, () => {});
  const poll = () => {
    view_post(${JSON.stringify(viewname)}, 'req_status', {}, (resp) => {
      if (resp && !resp.generating) location.reload();
      else setTimeout(poll, 3000);
    });
  };
  setTimeout(poll, 3000);
};
`)
    )
  );
};

const doGenReqs = async (spec, userId) => {
  const generatingMd = await MetaData.create({
    type: "CopilotConstructMgr",
    name: "generating_requirements",
    body: {},
    user_id: userId,
  });
  try {
    const researchText = await getResearchAnswersText();
    const answer = await getState().functions.llm_generate.run(
      `Generate the requirements for this application:

${spec.body.specification}
${research_answers_section(researchText)}
Important rules for generating requirements:
* Every requirement must be directly traceable to something stated in the description, audience, or core features above. Do not infer, invent, or add features that are not explicitly mentioned — even if they seem like an obvious addition.
* Do not generate any requirement that falls under the Out of scope section above.
* Only generate requirements for core functionality. Do not generate requirements for features described as optional, "nice to have", "could support", or "can be added later" — omit them entirely.
* Do NOT generate a requirement for integration with any external third-party system (e.g. QuickBooks, Xero, Stripe, Slack, external APIs, webhooks) unless the specification explicitly names the system AND describes exactly what must be exchanged. A vague mention like "integration with accounting systems" is not sufficient — skip it.
* Do not generate requirements that are already handled by the platform (e.g. user registration, login, password management — these are built-in).
* Priority reflects how central the feature is to the core purpose of the application. Assign 5 to features without which the application cannot function at all, 3-4 to features that are important but not blocking, 1-2 to minor convenience features. Do not assign 5 to everything.

Now use the make_requirements tool to list the requirements for this software application
`,
      {
        tools: [requirements_tool],
        ...tool_choice("make_requirements"),
        systemPrompt:
          "You are a project manager extracting requirements from a written specification. Only include what is explicitly stated — do not infer or add plausible extras.",
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
  }
};

const gen_reqs = async (table_id, viewname, config, body, { req, res }) => {
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  if (!spec) throw new Error("Specification not found");
  doGenReqs(spec, req.user?.id).catch((e) =>
    console.error("gen_reqs error", e)
  );
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
  return { json: { reload_page: true } };
};
const del_all_reqs = async (table_id, viewname, config, body, { req, res }) => {
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "requirement",
  });
  for (const r of rs) await r.delete();
  return { json: { reload_page: true } };
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

module.exports = { requirementsList, req_routes };
