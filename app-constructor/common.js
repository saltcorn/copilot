const { getState } = require("@saltcorn/data/db/state");

const viewname = "Saltcorn AppConstructor";

const TaskType = Object.freeze({
  PLUGIN: "plugin",
  DATA_MODEL: "data_model",
  FEATURE: "feature",
});

// Order in which task types are generated/run by the phase "Generate & Run" chain.
const TASK_TYPE_ORDER = [
  TaskType.PLUGIN,
  TaskType.DATA_MODEL,
  TaskType.FEATURE,
];

// Topics a "feature" task can be tagged with, selecting which fixed-prompts.js rules it gets.
const TASK_TOPICS = [
  "view_embedding", // embedding/linking/viewlinks, dashboards, extra_state_fml
  "workflow", // workflow steps: TableQuery, PDF export, TerminateWorkflow, row inserts
  "custom_code", // JsCode views and run_js_code workflow steps
  "trigger_action", // triggers, action buttons, modify_row
  "auth_pages", // landing/login/signup pages
  "list_view", // List view specifics
  "show_view", // Show view specifics
  "edit_view", // Edit view specifics
  "navigation_links", // Link columns, page vs view URL prefixes
  "system_config", // set_entity for home_page_by_role, 2FA, etc.
];

const tool_choice = (tool_name) => ({
  tool_choice: {
    type: "function",
    function: {
      name: tool_name,
    },
  },
});

// Namespaced MetaData type for a specific project.
// All per-project records use this type so projects are fully isolated.
const projectType = (projectId) => `CopilotConstructMgr:${projectId}`;

// Top-level type used only for project list records themselves.
const BASE_TYPE = "CopilotConstructMgr";

// The MetaData type for a route call, from the POST body or the query string.
const getPt = (body, req) =>
  projectType(body.project_id ?? req.query?.project_id);

// Short, user-facing message for a failed LLM/tool call - e.g. an upstream
// API outage (HTTP 5xx) should read as that, not as a raw stack trace.
const genErrorToastMsg = (err, label) => {
  const statusCode =
    err?.statusCode ||
    err?.lastError?.statusCode ||
    (err?.errors || [])[0]?.statusCode;
  return statusCode
    ? `${label} failed: API error (HTTP ${statusCode})`
    : `${label} failed: ${String(err?.message || err)
        .replace(/\s+/g, " ")
        .slice(0, 120)}`;
};

// Diagnoses an LLM answer with no tool call - usually Anthropic running out
// of output tokens while thinking, checked against the plugin's config.
const missingToolCallError = () => {
  const plugin_cfgs = getState().plugin_cfgs || {};
  const cfg =
    plugin_cfgs["large-language-model"] ||
    plugin_cfgs["@saltcorn/large-language-model"];
  const isAnthropic =
    cfg?.backend === "AI SDK" && cfg?.ai_sdk_provider === "Anthropic";
  if (isAnthropic && !(cfg?.max_tokens >= 8000)) {
    return (
      "The model returned no tool call - it likely ran out of output tokens " +
      "while thinking before it could respond. Increase the large-language-model " +
      `plugin's max output tokens (currently ${cfg?.max_tokens || "not set"}).`
    );
  }
  return "The model returned no tool call (empty response).";
};

module.exports = {
  viewname,
  tool_choice,
  TaskType,
  TASK_TYPE_ORDER,
  TASK_TOPICS,
  projectType,
  BASE_TYPE,
  genErrorToastMsg,
  getPt,
  missingToolCallError,
};
