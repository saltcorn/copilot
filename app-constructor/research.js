const MetaData = require("@saltcorn/data/models/metadata");
const Form = require("@saltcorn/data/models/form");
const { renderForm, mkTable } = require("@saltcorn/markup");
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
  input,
  h5,
  small,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const { viewname, tool_choice } = require("./common");

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

const researchPanel = async (req) => {
  const answers_md = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "research_answers",
  });
  const questions_md = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "research_questions",
  });

  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_research",
  });

  if (generating) {
    return div(
      { class: "mt-2" },
      p(
        i({ class: "fas fa-spinner fa-spin me-2" }),
        "Generating questions, please wait..."
      ),
      script(
        domReady(`
(function() {
  const poll = () => {
    view_post(${JSON.stringify(viewname)}, 'research_status', {}, (resp) => {
      if (resp && !resp.generating) location.reload();
      else setTimeout(poll, 3000);
    });
  };
  setTimeout(poll, 3000);
})();
`)
      )
    );
  }

  if (questions_md) {
    const questions = questions_md.body.questions || [];
    const saved = answers_md?.body || {};

    const fieldRows = questions
      .map((q, idx) => {
        const fname = `question${idx + 1}`;
        return div(
          { class: "mb-3" },
          label({ class: "form-label fw-semibold", for: fname }, q),
          textarea(
            {
              class: "form-control",
              id: fname,
              name: fname,
              rows: 3,
            },
            saved[fname] || ""
          )
        );
      })
      .join("");

    return div(
      { class: "mt-2", id: "research-panel" },
      h5("Clarifying questions"),
      small(
        { class: "text-muted d-block mb-3" },
        "Answer these questions to help generate more accurate requirements and tasks. You can skip any question."
      ),
      form(
        { id: "research-form" },
        fieldRows,
        button(
          {
            type: "button",
            class: "btn btn-primary me-2",
            onclick: `copilotSubmitResearch()`,
          },
          "Save answers"
        ),
        button(
          {
            type: "button",
            class: "btn btn-outline-secondary",
            onclick: `copilotRegenResearch()`,
          },
          "Regenerate questions"
        )
      ),
      script(
        domReady(`
window.copilotSubmitResearch = () => {
  const data = {};
  const form = document.getElementById('research-form');
  for (const el of form.querySelectorAll('textarea')) data[el.name] = el.value;
  view_post(${JSON.stringify(viewname)}, 'submit_research', data);
};
window.copilotRegenResearch = () => {
  const area = document.getElementById('research-panel');
  if (area) area.innerHTML = '<p><i class="fas fa-spinner fa-spin me-2"></i>Generating questions, please wait...</p>';
  view_post(${JSON.stringify(viewname)}, 'gen_research', {}, () => {});
  const poll = () => {
    view_post(${JSON.stringify(viewname)}, 'research_status', {}, (resp) => {
      if (resp && !resp.generating) location.reload();
      else setTimeout(poll, 3000);
    });
  };
  setTimeout(poll, 3000);
};
`)
      )
    );
  }

  return div(
    { class: "mt-2", id: "research-panel" },
    p("Generate clarifying questions based on your specification."),
    button(
      {
        class: "btn btn-primary",
        onclick: `copilotGenResearch()`,
      },
      "Generate questions"
    ),
    script(
      domReady(`
window.copilotGenResearch = () => {
  document.getElementById('research-panel').innerHTML =
    '<p><i class="fas fa-spinner fa-spin me-2"></i>Generating questions, please wait...</p>';
  view_post(${JSON.stringify(viewname)}, 'gen_research', {}, () => {});
  const poll = () => {
    view_post(${JSON.stringify(viewname)}, 'research_status', {}, (resp) => {
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

const doGenResearch = async (spec, userId) => {
  const generatingMd = await MetaData.create({
    type: "CopilotConstructMgr",
    name: "generating_research",
    body: {},
    user_id: userId,
  });
  try {
    const answer = await getState().functions.llm_generate.run(
      `Based on the following application specification, generate clarifying questions
that would help better understand what the user wants to build.
Ask only about genuinely ambiguous or underspecified aspects.
Do not ask about things that are already clear from the specification.
Only ask questions that are truly necessary — if 2 or 3 questions cover everything unclear, stop there.
Do not pad the list. 10 is a hard maximum, not a target.

Specification:
${spec.body.specification}

Now call the ask_questions tool with your questions.`,
      {
        tools: [questions_tool],
        ...tool_choice("ask_questions"),
        systemPrompt:
          "You are a requirements analyst. Ask only the clarifying questions that are " +
          "genuinely needed — fewer is better. 10 is a hard maximum, not a target. " +
          "Each question must be short, clear, and easy to understand — " +
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
  }
};

const gen_research = async (table_id, viewname, config, body, { req, res }) => {
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  if (!spec) return { json: { error: "Specification not found" } };
  doGenResearch(spec, req.user?.id).catch((e) =>
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
  return { json: { success: true, notify: "Answers saved" } };
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
  submit_research,
};

module.exports = { researchPanel, research_routes, getResearchAnswersText };
