const MetaData = require("@saltcorn/data/models/metadata");
const {
  div,
  script,
  domReady,
  button,
  i,
  p,
  label,
  textarea,
  form,
  h5,
  small,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const { viewname, tool_choice } = require("./common");
const { PromptGenerator } = require("./prompt-generator");

const questions_tool = {
  type: "function",
  function: {
    name: "ask_questions",
    description: "Ask the user clarifying questions about the application",
    parameters: {
      type: "object",
      required: ["questions"],
      additionalProperties: false,
      properties: {
        questions: {
          type: "array",
          maxItems: 10,
          description: "List of clarifying questions, maximum 10",
          items: { type: "string" },
        },
      },
    },
  },
};

const spinnerHtml =
  "<p>" +
  i({ class: "fas fa-spinner fa-spin me-2" }) +
  "Generating questions, please wait...</p>";

// Pure HTML for each state — no embedded scripts
const researchPanelHtml = async (req) => {
  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_research",
  });
  if (generating) return spinnerHtml;

  const questions_md = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "research_questions",
  });

  if (questions_md) {
    const answers_md = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "research_answers",
    });
    const questions = questions_md.body.questions || [];
    const saved = answers_md?.body || {};

    const fieldRows = questions
      .map((q, idx) => {
        const fname = `question${idx + 1}`;
        return div(
          { class: "mb-3" },
          label({ class: "form-label fw-semibold", for: fname }, q),
          textarea(
            { class: "form-control", id: fname, name: fname, rows: 3 },
            saved[fname] || ""
          )
        );
      })
      .join("");

    return (
      h5({ class: "mb-2" }, "Specification questions") +
      small(
        { class: "text-muted d-block mb-3" },
        "Answer these questions to help generate more accurate requirements and tasks. " +
          "You can skip any question."
      ) +
      form(
        { id: "research-form" },
        fieldRows,
        button(
          {
            type: "button",
            class: "btn btn-primary me-2",
            onclick: "copilotSubmitResearch()",
          },
          "Save answers"
        ),
        button(
          {
            type: "button",
            class: "btn btn-outline-secondary",
            onclick: "copilotRegenResearch()",
          },
          "Regenerate questions"
        ),
        button(
          {
            type: "button",
            class: "btn btn-outline-danger ms-2",
            onclick: "copilotDelAllResearch()",
          },
          "Delete all"
        )
      )
    );
  }

  return (
    p("Generate clarifying questions based on your specification.") +
    button(
      { class: "btn btn-primary", onclick: "copilotGenResearch()" },
      "Generate questions"
    )
  );
};

// Outer wrapper rendered once on page load — includes the single script block
const researchPanel = async (req) => {
  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_research",
  });
  const innerHtml = await researchPanelHtml(req);

  return div(
    { class: "mt-2" },
    div({ id: "research-panel" }, innerHtml),
    script(
      domReady(`
const _vn = ${JSON.stringify(viewname)};
function researchStartPoll() {
  const poll = () => {
    view_post(_vn, 'research_status', {}, (resp) => {
      if (resp && !resp.generating) {
        view_post(_vn, 'research_html', {}, (r) => {
          if (r && r.html) document.getElementById('research-panel').innerHTML = r.html;
        });
      } else setTimeout(poll, 3000);
    });
  };
  setTimeout(poll, 3000);
}
window.copilotRefreshResearch = () => {
  view_post(_vn, 'research_html', {}, (r) => {
    const a = document.getElementById('research-panel');
    if (r && r.html && a) a.innerHTML = r.html;
  });
};
window.copilotGenResearch = window.copilotRegenResearch = () => {
  document.getElementById('research-panel').innerHTML = ${JSON.stringify(
    spinnerHtml
  )};
  view_post(_vn, 'gen_research', {}, () => {});
  if (!window.dynamic_updates_cfg?.enabled) researchStartPoll();
};
window.copilotDelAllResearch = () => {
  view_post(_vn, 'del_all_research', {}, () => {
    view_post(_vn, 'research_html', {}, (r) => {
      if (r && r.html) document.getElementById('research-panel').innerHTML = r.html;
    });
  });
};
window.copilotSubmitResearch = () => {
  const data = {};
  const f = document.getElementById('research-form');
  for (const el of f.querySelectorAll('textarea')) data[el.name] = el.value;
  view_post(_vn, 'submit_research', data);
};
${
  generating
    ? "if (!window.dynamic_updates_cfg?.enabled) researchStartPoll();"
    : ""
}
`)
    )
  );
};

const doGenResearch = async (userId) => {
  const generatingMd = await MetaData.create({
    type: "CopilotConstructMgr",
    name: "generating_research",
    body: {},
    user_id: userId,
  });
  try {
    const generator = await PromptGenerator.createInstance();
    if (!generator.spec) throw new Error("Specification not found");
    const answer = await getState().functions.llm_generate.run(
      generator.researchQuestionsPrompt(),
      {
        tools: [questions_tool],
        ...tool_choice("ask_questions"),
        systemPrompt:
          "You are a requirements analyst. Ask only the clarifying questions that are\n" +
          "genuinely needed — fewer is better. 10 is a hard maximum, not a target.\n" +
          "Each question must be short, clear, and easy to understand —\n" +
          "avoid technical jargon where possible and keep sentences simple.",
      }
    );
    const tc = answer.getToolCalls()[0];
    const existing = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "research_questions",
    });
    if (existing) {
      await existing.update({ body: { questions: tc.input.questions } });
    } else {
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: "research_questions",
        body: { questions: tc.input.questions },
        user_id: userId,
      });
    }
    const oldAnswers = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "research_answers",
    });
    if (oldAnswers) await oldAnswers.delete();
  } finally {
    await generatingMd.delete();
    try {
      getState().emitDynamicUpdate(db.getTenantSchema(), {
        eval_js:
          "if(typeof copilotRefreshResearch==='function')copilotRefreshResearch();",
      });
    } catch (_) {}
  }
};

const gen_research = async (table_id, viewname, config, body, { req, res }) => {
  doGenResearch(req.user?.id).catch((e) =>
    console.error("gen_research error", e)
  );
  return { json: { success: true } };
};

const research_status = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_research",
  });
  return { json: { generating: !!generating } };
};

const research_html = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const html = await researchPanelHtml(req);
  return { json: { html } };
};

const submit_research = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const { _csrf, ...answers } = body;
  const existing = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "research_answers",
  });
  if (existing) {
    await existing.update({ body: answers });
  } else {
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "research_answers",
      body: answers,
      user_id: req.user?.id,
    });
  }
  return { json: { success: true, notify_success: "Answers saved" } };
};

const del_all_research = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  for (const name of ["research_questions", "research_answers"]) {
    const md = await MetaData.findOne({ type: "CopilotConstructMgr", name });
    if (md) await md.delete();
  }
  return { json: { success: true } };
};

const getResearchAnswersText = async () => {
  const questions_md = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "research_questions",
  });
  const answers_md = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "research_answers",
  });
  if (!questions_md || !answers_md) return null;
  const questions = questions_md.body.questions || [];
  const answers = answers_md.body || {};
  const pairs = questions
    .map((q, idx) => {
      const a = answers[`question${idx + 1}`];
      if (!a || !a.trim()) return null;
      return `Question: ${q}\nAnswer: ${a.trim()}`;
    })
    .filter(Boolean);
  if (!pairs.length) return null;
  return pairs.join("\n\n");
};

const research_routes = {
  gen_research,
  research_status,
  research_html,
  submit_research,
  del_all_research,
};

module.exports = {
  researchPanel,
  research_routes,
  getResearchAnswersText,
  questions_tool,
};
