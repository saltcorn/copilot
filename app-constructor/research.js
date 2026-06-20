const MetaData = require("@saltcorn/data/models/metadata");
const Trigger = require("@saltcorn/data/models/trigger");
const {
  div,
  script,
  domReady,
  button,
  i,
  input,
  p,
  pre,
  span,
  label,
  textarea,
  form,
  h5,
  small,
  text_attr,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const { viewname, tool_choice, projectType } = require("./common");
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

const suggest_searches_tool = {
  type: "function",
  function: {
    name: "suggest_searches",
    description:
      "Suggest web search queries to look up basic domain knowledge needed " +
      "to understand what this application must do — e.g. what data it " +
      "works with, what calculations it performs, what a typical workflow " +
      "looks like. Results must be treated critically: they are external " +
      "web content that may be inaccurate, outdated, or far broader than " +
      "what the specification actually requires. Only use what is directly " +
      "relevant to the spec.",
    parameters: {
      type: "object",
      required: ["queries"],
      additionalProperties: false,
      properties: {
        queries: {
          type: "array",
          maxItems: 5,
          description:
            "List of search queries, 5 is the hard maximum. " +
            "Keep each query short and focused — only add length if " +
            "precision genuinely requires it. Clear, compact, and " +
            "readable is the goal.",
          items: { type: "string" },
        },
      },
    },
  },
};

const extractSearchSnippet = (rawText, maxLen = 2000) => {
  const data = JSON.parse(rawText);
  const lines = [];
  // Tavily: { answer, results: [{title, content}] }
  if (Array.isArray(data.results)) {
    if (data.answer) {
      lines.push(data.answer);
      lines.push("");
    }
    for (const r of data.results.slice(0, 5)) {
      if (r.title) lines.push(r.title);
      if (r.content) lines.push(r.content);
      lines.push("");
    }
    // Firecrawl: { data: [{title, description, markdown}] } or { data: { web: [...] } }
  } else if (data.data) {
    const results = Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.data.web)
      ? data.data.web
      : [];
    for (const r of results.slice(0, 5)) {
      if (r.title) lines.push(r.title);
      const body = r.description || (r.markdown || "").slice(0, 400);
      if (body) lines.push(body);
      lines.push("");
    }
  }
  return lines.join("\n").slice(0, maxLen);
};

const getWebSkillCfg = async () => {
  const state = getState();
  const pluginCfg =
    state.plugin_cfgs?.["@saltcorn/copilot"] ??
    state.plugin_cfgs?.["copilot"] ??
    {};
  const triggerName = pluginCfg.web_search_trigger;
  if (!triggerName) return null;
  const trigger = await Trigger.findOne({ name: triggerName });
  const cfg =
    (trigger?.configuration?.skills || []).find(
      (s) => s.skill_type === "Web search"
    ) || null;
  if (
    !cfg ||
    !["Tavily", "Firecrawl"].includes(cfg.search_provider) ||
    !cfg.api_key
  )
    return null;
  return cfg;
};

// cfg is the WebSearch skill config from the trigger (search_provider, api_key, url_template, header)
const doWebSearch = async (query, cfg) => {
  if (cfg.search_provider === "Tavily") {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
    });
    return await resp.text();
  }
  if (cfg.search_provider === "Firecrawl") {
    const resp = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, limit: 5 }),
    });
    return await resp.text();
  }
  // By URL template (GET)
  const url = (cfg.url_template || "").replace(
    "{{q}}",
    encodeURIComponent(query)
  );
  const fOpts = { method: "GET" };
  if (cfg.header) {
    const colonIdx = cfg.header.indexOf(":");
    if (colonIdx !== -1) {
      const myHeaders = new Headers();
      myHeaders.append(
        cfg.header.slice(0, colonIdx).trim(),
        cfg.header.slice(colonIdx + 1).trim()
      );
      fOpts.headers = myHeaders;
    }
  }
  const resp = await fetch(url, fOpts);
  return await resp.text();
};

const renderWebFindings = (findings) => {
  const findingCards =
    findings.length === 0
      ? div({ class: "text-muted small mb-2" }, "No findings yet.")
      : findings.map(({ query, snippet }) =>
          div(
            { class: "card mb-4" },
            div(
              {
                class:
                  "card-header py-1 px-3 d-flex justify-content-between " +
                  "align-items-center",
                style: "background:none",
              },
              small(
                { class: "fw-semibold text-muted flex-grow-1" },
                i({ class: "fas fa-search me-2" }),
                query
              ),
              button(
                {
                  type: "button",
                  class: "btn btn-sm btn-link text-danger p-0 ms-2 lh-1",
                  title: "Dismiss this finding",
                  onclick: text_attr(
                    `copilotDismissFinding(${JSON.stringify(query)})`
                  ),
                },
                i({ class: "fas fa-times" })
              )
            ),
            div(
              { class: "card-body py-2 px-3" },
              pre(
                {
                  class: "mb-0",
                  style:
                    "white-space:pre-wrap;max-height:150px;" +
                    "overflow:auto;font-size:0.78em",
                },
                snippet
              )
            )
          )
        );

  const customSearchForm = div(
    { class: "mt-3 d-flex gap-2" },
    input({
      type: "text",
      id: "wf-custom-query",
      class: "form-control form-control-sm",
      placeholder: "Add your own search query…",
      onkeydown:
        "if(event.key==='Enter'){copilotAddCustomFinding(this.value);}",
    }),
    button(
      {
        type: "button",
        class: "btn btn-sm btn-outline-primary text-nowrap",
        onclick:
          "copilotAddCustomFinding(" +
          "document.getElementById('wf-custom-query').value)",
      },
      i({ class: "fas fa-search me-1" }),
      "Search"
    )
  );

  return div({ class: "mt-2" }, findingCards, customSearchForm);
};

const sectionSpinnerHtml =
  '<div class="py-3 px-1 text-muted">' +
  i({ class: "fas fa-spinner fa-spin me-2" }) +
  "Please wait…</div>";

const renderWebResearchNotConfigured = () => {
  const sectionId = "research-web-section-collapse";
  return div(
    { class: "mb-4 border rounded", id: "web-research-section" },
    div(
      { class: "d-flex align-items-center justify-content-between p-3 pb-0" },
      button(
        {
          type: "button",
          class:
            "btn btn-sm btn-link text-start p-0 fw-semibold text-body " +
            "d-flex align-items-center",
          "data-bs-toggle": "collapse",
          "data-bs-target": `#${sectionId}`,
          "aria-expanded": "false",
          "aria-controls": sectionId,
        },
        i({ class: "fas fa-chevron-down me-2 sc-collapse-chevron" }),
        "Web Research",
        span({ class: "ms-2 text-muted fw-normal small" }, "— not configured")
      )
    ),
    div(
      { class: "collapse", id: sectionId },
      div(
        { class: "text-muted p-3 pt-2" },
        "Web research is not configured. To enable it, go to ",
        "Admin → Plugins → @saltcorn/copilot → Configure ",
        "and select an Agent trigger with a Tavily or Firecrawl web search skill."
      )
    )
  );
};

const renderWebResearchSection = (findings) => {
  const sectionId = "research-web-section-collapse";
  return div(
    { class: "mb-4 border rounded p-3", id: "web-research-section" },
    div(
      { class: "d-flex align-items-center justify-content-between mb-1" },
      button(
        {
          type: "button",
          class:
            "btn btn-sm btn-link text-start p-0 fw-semibold text-body " +
            "d-flex align-items-center",
          "data-bs-toggle": "collapse",
          "data-bs-target": `#${sectionId}`,
          "aria-expanded": "false",
          "aria-controls": sectionId,
        },
        i({ class: "fas fa-chevron-down me-2 sc-collapse-chevron" }),
        "Web Research"
      ),
      button(
        {
          type: "button",
          class: "btn btn-sm btn-outline-secondary",
          onclick: "copilotRegenWebOnly()",
        },
        i({ class: "fas fa-sync-alt me-1" }),
        "Regenerate"
      )
    ),
    small(
      { class: "text-muted d-block mb-2" },
      "Background information gathered from the web based on your specification. " +
        "Treat these results critically — they may be incomplete or broader than " +
        "what your application actually needs. " +
        "You can dismiss individual findings or add your own search queries below."
    ),
    div({ class: "collapse", id: sectionId }, renderWebFindings(findings))
  );
};

const spinnerHtml =
  "<p>" +
  i({ class: "fas fa-spinner fa-spin me-2" }) +
  "Generating questions, please wait...</p>";

// Pure HTML for each state — no embedded scripts
const researchPanelHtml = async (req, pt) => {
  const generating = await MetaData.findOne({
    type: pt,
    name: "generating_research",
  });
  if (generating) return spinnerHtml;

  const questions_md = await MetaData.findOne({
    type: pt,
    name: "research_questions",
  });

  if (questions_md) {
    const answers_md = await MetaData.findOne({
      type: pt,
      name: "research_answers",
    });
    const findings_md = await MetaData.findOne({
      type: pt,
      name: "research_web_findings",
    });
    const questions = questions_md.body.questions || [];
    const saved = answers_md?.body || {};

    const fieldRows = questions
      .map((q, idx) => {
        const fname = `question${idx + 1}`;
        return div(
          { class: "mb-4" },
          label(
            {
              class: "form-label fw-semibold d-flex align-items-start gap-2",
              for: fname,
            },
            span(
              {
                class: "flex-shrink-0 badge bg-secondary rounded-pill me-1",
                style: "font-size:0.72em;line-height:1.8",
              },
              idx + 1
            ),
            q
          ),
          textarea(
            { class: "form-control", id: fname, name: fname, rows: 3 },
            saved[fname] || ""
          )
        );
      })
      .join("");

    const webSearchConfigured = !!(await getWebSkillCfg());
    const findingsHtml = findings_md
      ? renderWebResearchSection(findings_md.body?.findings || [])
      : webSearchConfigured
      ? renderWebResearchSection([])
      : renderWebResearchNotConfigured();

    const questionsSectionId = "research-questions-section-collapse";
    return (
      findingsHtml +
      div(
        { class: "mb-4 border rounded p-3", id: "questions-section" },
        div(
          { class: "d-flex align-items-center justify-content-between mb-1" },
          button(
            {
              type: "button",
              class:
                "btn btn-sm btn-link text-start p-0 fw-semibold text-body " +
                "d-flex align-items-center",
              "data-bs-toggle": "collapse",
              "data-bs-target": `#${questionsSectionId}`,
              "aria-expanded": "true",
              "aria-controls": questionsSectionId,
            },
            i({ class: "fas fa-chevron-down me-2 sc-collapse-chevron" }),
            "Specification Questions"
          ),
          button(
            {
              type: "button",
              class: "btn btn-sm btn-outline-secondary",
              onclick: "copilotGenQuestionsOnly()",
            },
            i({ class: "fas fa-sync-alt me-1" }),
            "Regenerate"
          )
        ),
        small(
          { class: "text-muted d-block mb-2" },
          "Answer these questions to help generate more accurate requirements " +
            "and tasks. You can skip any question."
        ),
        div(
          { class: "collapse show", id: questionsSectionId },
          form(
            { id: "research-form" },
            fieldRows,
            div(
              { class: "mt-3" },
              button(
                {
                  type: "button",
                  class: "btn btn-primary",
                  onclick: "copilotSubmitResearch()",
                },
                "Save answers"
              )
            )
          )
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
const researchPanel = async (req, pt) => {
  const generating = await MetaData.findOne({
    type: pt,
    name: "generating_research",
  });
  const innerHtml = await researchPanelHtml(req, pt);

  return div(
    { class: "mt-2" },
    `<style>.sc-collapse-chevron{transition:transform .2s}.btn[aria-expanded="true"] .sc-collapse-chevron{transform:rotate(180deg)}</style>`,
    div({ id: "research-panel" }, innerHtml),
    script(
      domReady(`
const _vn = ${JSON.stringify(viewname)};
const _webRegenToastMsg = "Web research updated — consider regenerating the specification questions to reflect the new findings.";
function researchOpenSection(id) {
  const el = document.getElementById(id);
  if (el) new bootstrap.Collapse(el, { toggle: false }).show();
}
function researchStartPoll() {
  const poll = () => {
    view_post(_vn, 'research_status', {}, (resp) => {
      if (resp && !resp.generating) {
        const showWebToast = !!window._copilotWebRegenPending;
        const openId = window._copilotOpenSection;
        window._copilotWebRegenPending = false;
        window._copilotOpenSection = null;
        view_post(_vn, 'research_html', {}, (r) => {
          if (r && r.html) document.getElementById('research-panel').innerHTML = r.html;
          if (openId) researchOpenSection(openId);
          if (showWebToast) notifyAlert({ type: 'info', text: _webRegenToastMsg });
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
window.copilotWebRegenDone = () => {
  view_post(_vn, 'research_html', {}, (r) => {
    const a = document.getElementById('research-panel');
    if (r && r.html && a) {
      a.innerHTML = r.html;
      researchOpenSection('research-web-section-collapse');
      notifyAlert({ type: 'info', text: _webRegenToastMsg });
    }
  });
};
window.copilotGenResearch = window.copilotRegenResearch = () => {
  document.getElementById('research-panel').innerHTML = ${JSON.stringify(
    spinnerHtml
  )};
  view_post(_vn, 'gen_research', {}, () => {});
  if (!window.dynamic_updates_cfg?.enabled) researchStartPoll();
};
window.copilotRegenWebOnly = () => {
  const el = document.getElementById('web-research-section');
  if (el) el.innerHTML = ${JSON.stringify(sectionSpinnerHtml)};
  window._copilotWebRegenPending = true;
  window._copilotOpenSection = 'research-web-section-collapse';
  view_post(_vn, 'gen_web_only', {}, () => {});
  if (!window.dynamic_updates_cfg?.enabled) researchStartPoll();
};
window.copilotGenQuestionsOnly = () => {
  const el = document.getElementById('questions-section');
  if (el) el.innerHTML = ${JSON.stringify(sectionSpinnerHtml)};
  window._copilotOpenSection = 'research-questions-section-collapse';
  view_post(_vn, 'gen_questions_only', {}, () => {});
  if (!window.dynamic_updates_cfg?.enabled) researchStartPoll();
};
window.copilotDismissFinding = (query) => {
  if (!confirm('Remove this finding from the research context?')) return;
  view_post(_vn, 'dismiss_finding', { query }, (r) => {
    if (r && r.html) document.getElementById('research-panel').innerHTML = r.html;
  });
};
window.copilotAddCustomFinding = (query) => {
  if (!query || !query.trim()) return;
  const panel = document.getElementById('research-panel');
  const prev = panel.innerHTML;
  panel.innerHTML = ${JSON.stringify(spinnerHtml)};
  view_post(_vn, 'add_custom_finding', { query: query.trim() }, (r) => {
    if (r && r.html) panel.innerHTML = r.html;
    else panel.innerHTML = prev;
  });
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

const doGenResearch = async (userId, pt) => {
  const generatingMd = await MetaData.create({
    type: pt,
    name: "generating_research",
    body: {},
    user_id: userId,
  });
  try {
    const generator = await PromptGenerator.createInstance({ pt });
    if (!generator.spec) throw new Error("Specification not found");

    let webFindings = [];
    const webSkillCfg = await getWebSkillCfg();
    const webSearchEnabled = !!webSkillCfg;

    if (webSearchEnabled) {
      // Phase 1: ask the LLM which searches to run
      const queryAnswer = await getState().functions.llm_generate.run(
        generator.webSearchQueriesPrompt(),
        {
          tools: [suggest_searches_tool],
          ...tool_choice("suggest_searches"),
          systemPrompt:
            "You are a research assistant. Your job is to identify the parts of " +
            "the specification that require external knowledge to implement correctly — " +
            "for example a specific tax calculation, a pricing formula, an industry " +
            "process, or a regulatory rule that is named but not explained. " +
            "For each such gap, suggest one focused web search query. " +
            "Before suggesting a query, ask yourself: " +
            "'Is this explicitly needed to implement what the spec describes, " +
            "or am I adding complexity that was never asked for?' " +
            "Only suggest a query if the answer is clearly the former. " +
            "Do not search for integration standards, compliance frameworks, " +
            "or third-party systems unless the spec explicitly mentions them. " +
            "Do not suggest searches about Saltcorn itself. " +
            "Up to 3 queries is usually enough — 5 is a hard maximum.",
        }
      );
      const queriesCall = queryAnswer.getToolCalls()[0];
      const queries = queriesCall?.input?.queries || [];

      // Phase 2: execute the searches
      for (const query of queries.slice(0, 5)) {
        try {
          const raw = await doWebSearch(query, webSkillCfg);
          const snippet = extractSearchSnippet(raw);
          if (snippet) webFindings.push({ query, snippet });
        } catch (e) {
          console.warn("web search failed for:", query, e.message);
        }
      }

      const existingFindings = await MetaData.findOne({
        type: pt,
        name: "research_web_findings",
      });
      if (webFindings.length) {
        if (existingFindings) {
          await existingFindings.update({ body: { findings: webFindings } });
        } else {
          await MetaData.create({
            type: pt,
            name: "research_web_findings",
            body: { findings: webFindings },
            user_id: userId,
          });
        }
      } else if (existingFindings) {
        await existingFindings.delete();
      }
    }

    // Phase 3: generate clarifying questions (with web findings in context)
    const answer = await getState().functions.llm_generate.run(
      generator.researchQuestionsPrompt(webFindings),
      {
        tools: [questions_tool],
        ...tool_choice("ask_questions"),
        systemPrompt:
          "You are a requirements analyst. Ask only questions that are genuinely needed to build the spec — " +
          "fewer is better, 10 is a hard maximum not a target.\n" +
          "Rules:\n" +
          "- Plain language only: no abbreviations (GDPR, SCIM, I-9, COBRA, etc.) without first spelling them out, no technical jargon.\n" +
          "- One idea per question. Short and direct.\n" +
          "- Only ask if the answer would change what gets built. Skip nice-to-know.\n" +
          "- If web research already answered something, do not ask the user about it.",
      }
    );
    const tc = answer.getToolCalls()[0];
    const existing = await MetaData.findOne({
      type: pt,
      name: "research_questions",
    });
    if (existing) {
      await existing.update({ body: { questions: tc.input.questions } });
    } else {
      await MetaData.create({
        type: pt,
        name: "research_questions",
        body: { questions: tc.input.questions },
        user_id: userId,
      });
    }
    const oldAnswers = await MetaData.findOne({
      type: pt,
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

const doGenQuestionsOnly = async (userId, pt) => {
  const generatingMd = await MetaData.create({
    type: pt,
    name: "generating_research",
    body: {},
    user_id: userId,
  });
  try {
    const generator = await PromptGenerator.createInstance({ pt });
    if (!generator.spec) throw new Error("Specification not found");

    const findingsMd = await MetaData.findOne({
      type: pt,
      name: "research_web_findings",
    });
    const webFindings = findingsMd?.body?.findings || [];

    const answer = await getState().functions.llm_generate.run(
      generator.researchQuestionsPrompt(webFindings),
      {
        tools: [questions_tool],
        ...tool_choice("ask_questions"),
        systemPrompt:
          "You are a requirements analyst. Ask only questions that are genuinely needed to build the spec — " +
          "fewer is better, 10 is a hard maximum not a target.\n" +
          "Rules:\n" +
          "- Plain language only: no abbreviations (GDPR, SCIM, I-9, COBRA, etc.) without first spelling them out, no technical jargon.\n" +
          "- One idea per question. Short and direct.\n" +
          "- Only ask if the answer would change what gets built. Skip nice-to-know.\n" +
          "- If web research already answered something, do not ask the user about it.",
      }
    );
    const tc = answer.getToolCalls()[0];
    const existing = await MetaData.findOne({
      type: pt,
      name: "research_questions",
    });
    if (existing) {
      await existing.update({ body: { questions: tc.input.questions } });
    } else {
      await MetaData.create({
        type: pt,
        name: "research_questions",
        body: { questions: tc.input.questions },
        user_id: userId,
      });
    }
    const oldAnswers = await MetaData.findOne({
      type: pt,
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

const doGenWebOnly = async (userId, pt) => {
  const webSkillCfg = await getWebSkillCfg();
  if (!webSkillCfg) return;

  const generatingMd = await MetaData.create({
    type: pt,
    name: "generating_research",
    body: {},
    user_id: userId,
  });
  try {
    const generator = await PromptGenerator.createInstance({ pt });
    if (!generator.spec) throw new Error("Specification not found");

    const queryAnswer = await getState().functions.llm_generate.run(
      generator.webSearchQueriesPrompt(),
      {
        tools: [suggest_searches_tool],
        ...tool_choice("suggest_searches"),
        systemPrompt:
          "You are a research assistant. Your job is to identify the parts of " +
          "the specification that require external knowledge to implement correctly. " +
          "For each such gap, suggest one focused web search query. " +
          "Only suggest a query if it is directly needed to implement what the spec describes. " +
          "Up to 3 queries is usually enough — 5 is a hard maximum.",
      }
    );
    const queriesCall = queryAnswer.getToolCalls()[0];
    const queries = queriesCall?.input?.queries || [];

    const webFindings = [];
    for (const query of queries.slice(0, 5)) {
      try {
        const raw = await doWebSearch(query, webSkillCfg);
        const snippet = extractSearchSnippet(raw);
        if (snippet) webFindings.push({ query, snippet });
      } catch (e) {
        console.warn("web search failed for:", query, e.message);
      }
    }

    const existingFindings = await MetaData.findOne({
      type: pt,
      name: "research_web_findings",
    });
    if (webFindings.length) {
      if (existingFindings) {
        await existingFindings.update({ body: { findings: webFindings } });
      } else {
        await MetaData.create({
          type: pt,
          name: "research_web_findings",
          body: { findings: webFindings },
          user_id: userId,
        });
      }
    } else if (existingFindings) {
      await existingFindings.delete();
    }
  } finally {
    await generatingMd.delete();
    try {
      getState().emitDynamicUpdate(db.getTenantSchema(), {
        eval_js:
          "if(typeof copilotWebRegenDone==='function')copilotWebRegenDone();",
      });
    } catch (_) {}
  }
};

const gen_research = async (table_id, viewname, config, body, { req, res }) => {
  const pt = projectType(body.project_id);
  doGenResearch(req.user?.id, pt).catch((e) =>
    console.error("gen_research error", e)
  );
  return { json: { success: true } };
};

const gen_web_only = async (table_id, viewname, config, body, { req, res }) => {
  const pt = projectType(body.project_id);
  doGenWebOnly(req.user?.id, pt).catch((e) =>
    console.error("gen_web_only error", e)
  );
  return { json: { success: true } };
};

const gen_questions_only = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const pt = projectType(body.project_id);
  doGenQuestionsOnly(req.user?.id, pt).catch((e) =>
    console.error("gen_questions_only error", e)
  );
  return { json: { success: true } };
};

const dismiss_finding = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const pt = projectType(body.project_id);
  const { query } = body;
  const md = await MetaData.findOne({
    type: pt,
    name: "research_web_findings",
  });
  if (md) {
    const findings = (md.body?.findings || []).filter((f) => f.query !== query);
    await md.update({ body: { findings } });
  }
  const html = await researchPanelHtml(req, pt);
  return { json: { html } };
};

const add_custom_finding = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const pt = projectType(body.project_id);
  const { query } = body;
  if (!query || !query.trim()) return { json: { error: "No query provided" } };

  const webSkillCfg = await getWebSkillCfg();
  if (!webSkillCfg) return { json: { error: "Web search not configured" } };

  let snippet = null;
  try {
    const raw = await doWebSearch(query.trim(), webSkillCfg);
    snippet = extractSearchSnippet(raw);
  } catch (e) {
    console.warn("add_custom_finding search failed:", e.message);
    return { json: { error: "Search failed: " + e.message } };
  }

  if (snippet) {
    const md = await MetaData.findOne({
      type: pt,
      name: "research_web_findings",
    });
    if (md) {
      const findings = md.body?.findings || [];
      findings.push({ query: query.trim(), snippet });
      await md.update({ body: { findings } });
    } else {
      await MetaData.create({
        type: pt,
        name: "research_web_findings",
        body: { findings: [{ query: query.trim(), snippet }] },
        user_id: req.user?.id,
      });
    }
  }

  const html = await researchPanelHtml(req, pt);
  return { json: { html } };
};

const research_status = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const pt = projectType(body.project_id);
  const generating = await MetaData.findOne({
    type: pt,
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
  const pt = projectType(body.project_id);
  const html = await researchPanelHtml(req, pt);
  return { json: { html } };
};

const submit_research = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const pt = projectType(body.project_id);
  const { _csrf, project_id, ...answers } = body;
  const existing = await MetaData.findOne({
    type: pt,
    name: "research_answers",
  });
  if (existing) {
    await existing.update({ body: answers });
  } else {
    await MetaData.create({
      type: pt,
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
  const pt = projectType(body.project_id);
  for (const name of [
    "research_questions",
    "research_answers",
    "research_web_findings",
  ]) {
    const md = await MetaData.findOne({ type: pt, name });
    if (md) await md.delete();
  }
  return { json: { success: true } };
};

const getResearchAnswersText = async (pt) => {
  const questions_md = await MetaData.findOne({
    type: pt,
    name: "research_questions",
  });
  const answers_md = await MetaData.findOne({
    type: pt,
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
  gen_web_only,
  gen_questions_only,
  dismiss_finding,
  add_custom_finding,
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
