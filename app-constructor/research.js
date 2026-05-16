const MetaData = require("@saltcorn/data/models/metadata");
const Table = require("@saltcorn/data/models/table");
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

const spinnerHtml =
  "<p>" +
  i({ class: "fas fa-spinner fa-spin me-2" }) +
  "Generating questions, please wait...</p>";

const FEEDBACK_TABLE = "app_constructor_feedback";

// Pure HTML for the feedback questions section — safe for innerHTML injection
const feedbackResearchHtml = async () => {
  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_feedback_research",
  });
  if (generating) {
    return div(
      { class: "mt-4 border-top pt-3" },
      p(i({ class: "fas fa-spinner fa-spin me-2" }), "Generating feedback questions...")
    );
  }

  const table = Table.findOne({ name: FEEDBACK_TABLE });
  if (!table) return "";

  const feedbackRows = await table.getRows({}, { orderBy: "id" });
  if (!feedbackRows.length) return "";

  const items = [];
  for (const row of feedbackRows) {
    const md = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: `feedback_research_${row.id}`,
    });
    if (md) items.push({ row, md });
  }
  if (!items.length) return "";

  const sections = items
    .map(({ row, md }) => {
      const questions = md.body.questions || [];
      const answers = md.body.answers || {};
      const fieldRows = questions
        .map((q, idx) => {
          const fname = `q${idx + 1}`;
          return div(
            { class: "mb-2" },
            label(
              { class: "form-label small fw-semibold", for: `fbq_${row.id}_${fname}` },
              q
            ),
            textarea(
              {
                class: "form-control form-control-sm",
                id: `fbq_${row.id}_${fname}`,
                name: fname,
                rows: 2,
              },
              answers[fname] || ""
            )
          );
        })
        .join("");
      return div(
        { class: "mb-4" },
        p({ class: "fw-semibold mb-2" }, row.title),
        form({ id: `fbr-form-${row.id}` }, fieldRows),
        button(
          {
            type: "button",
            class: "btn btn-sm btn-primary",
            onclick: `copilotSaveFeedbackResearch(${row.id})`,
          },
          "Save answers"
        )
      );
    })
    .join("");

  return div(
    { class: "mt-4 border-top pt-3" },
    h5("Feedback questions"),
    small(
      { class: "text-muted d-block mb-3" },
      "Answer these questions about each piece of feedback to provide better context for approval."
    ),
    sections
  );
};

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
      h5("Clarifying questions") +
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
  const genFeedbackResearch = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_feedback_research",
  });
  const innerHtml = await researchPanelHtml(req);
  const feedbackResearchInner = await feedbackResearchHtml();

  return div(
    { class: "mt-2" },
    div({ id: "research-panel" }, innerHtml),
    div({ id: "feedback-research-panel" }, feedbackResearchInner),
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
window.copilotGenResearch = window.copilotRegenResearch = () => {
  document.getElementById('research-panel').innerHTML = ${JSON.stringify(
    spinnerHtml
  )};
  view_post(_vn, 'gen_research', {}, () => {});
  researchStartPoll();
};
window.copilotSubmitResearch = () => {
  const data = {};
  const f = document.getElementById('research-form');
  for (const el of f.querySelectorAll('textarea')) data[el.name] = el.value;
  view_post(_vn, 'submit_research', data);
};
window.feedbackResearchStartPoll = () => {
  const poll = () => {
    view_post(_vn, 'feedback_research_status', {}, (resp) => {
      if (resp && !resp.generating) {
        view_post(_vn, 'feedback_research_html', {}, (r) => {
          if (r && r.html)
            document.getElementById('feedback-research-panel').innerHTML = r.html;
        });
      } else setTimeout(poll, 3000);
    });
  };
  setTimeout(poll, 3000);
};
window.copilotSaveFeedbackResearch = (feedbackId) => {
  const data = { feedback_id: feedbackId };
  const f = document.getElementById('fbr-form-' + feedbackId);
  for (const el of f.querySelectorAll('textarea')) data[el.name] = el.value;
  view_post(_vn, 'save_feedback_research_answers', data);
};
${generating ? "researchStartPoll();" : ""}
${genFeedbackResearch ? "feedbackResearchStartPoll();" : ""}
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

const doGenFeedbackResearch = async (rows) => {
  try {
    const spec = await MetaData.findOne({ type: "CopilotConstructMgr", name: "spec" });
    for (const row of rows) {
      const alreadyHas = await MetaData.findOne({
        type: "CopilotConstructMgr",
        name: `feedback_research_${row.id}`,
      });
      if (alreadyHas) continue;
      const answer = await getState().functions.llm_generate.run(
        `${spec?.body?.specification
          ? `The following application is being built:\n\n${spec.body.specification}\n\n`
          : ""
        }A user has submitted the following feedback:

Title: ${row.title}
${row.description ? `Description: ${row.description}\n` : ""}
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
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: `feedback_research_${row.id}`,
        body: {
          feedback_id: row.id,
          title: row.title,
          questions: tc.input.questions,
          answers: {},
        },
      });
    }
  } finally {
    const md = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "generating_feedback_research",
    });
    if (md) await md.delete();
  }
};

const gen_feedback_research = async (table_id, vn, config, body, { req, res }) => {
  // If the Insert virtual trigger already started generation, just signal the client to poll
  const alreadyRunning = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_feedback_research",
  });
  if (alreadyRunning) return { json: { generating: true } };

  const table = Table.findOne({ name: FEEDBACK_TABLE });
  if (!table) return { json: { generating: false } };

  const feedbackRows = await table.getRows({}, { orderBy: "id" });
  if (!feedbackRows.length) return { json: { generating: false } };

  const newRows = [];
  for (const row of feedbackRows) {
    const existing = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: `feedback_research_${row.id}`,
    });
    if (!existing) newRows.push(row);
  }
  if (!newRows.length) return { json: { generating: false } };

  doGenFeedbackResearch(newRows).catch((e) =>
    console.error("gen_feedback_research error", e)
  );
  return { json: { generating: true } };
};

const feedback_research_status = async (table_id, vn, config, body, { req, res }) => {
  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_feedback_research",
  });
  return { json: { generating: !!generating } };
};

const feedback_research_html = async (table_id, vn, config, body, { req, res }) => {
  const html = await feedbackResearchHtml();
  return { json: { html } };
};

const save_feedback_research_answers = async (
  table_id, vn, config, body, { req, res }
) => {
  const { _csrf, feedback_id, ...answers } = body;
  const id = parseInt(feedback_id);
  const md = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: `feedback_research_${id}`,
  });
  if (!md) return { json: { error: "Not found" } };
  await md.update({ body: { ...md.body, answers } });
  return { json: { success: true, notify_success: "Answers saved" } };
};

const research_routes = {
  gen_research,
  research_status,
  research_html,
  submit_research,
  gen_feedback_research,
  feedback_research_status,
  feedback_research_html,
  save_feedback_research_answers,
};

module.exports = {
  researchPanel,
  research_routes,
  getResearchAnswersText,
  questions_tool,
};
