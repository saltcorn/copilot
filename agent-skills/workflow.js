const Trigger = require("@saltcorn/data/models/trigger");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const { getState } = require("@saltcorn/data/db/state");
const GenerateWorkflow = require("../actions/generate-workflow");

const table_triggers = ["Insert", "Update", "Delete", "Validate"];

const TABLE_TRIGGER_WHEN = new Set(
  Trigger.when_options.filter((opt) => table_triggers.includes(opt)),
);
const ALLOWED_WHEN = new Set(Trigger.when_options);

const FALLBACK_ACTION_CATALOG = { namespaces: [], byName: {} };
const ACTION_SUMMARY_LIMIT = 5;
const ACTION_HTML_LIMIT = 12;
const RANDOM_STEP_COUNT = { min: 2, max: 3 };
const SIMPLE_FIELD_TYPES = new Set(["string", "number", "integer", "boolean"]);

let workflowSchemaCache = null;
let workflowSchemaLoading = null;
let actionCatalogCache = null;

const ensureWorkflowParameters = () => {
  if (!workflowSchemaCache && !workflowSchemaLoading) {
    workflowSchemaLoading = GenerateWorkflow.json_schema()
      .then((schema) => {
        workflowSchemaCache = schema;
      })
      .catch((error) => {
        console.error("GenerateWorkflowSkill: failed to load schema", error);
      })
      .finally(() => {
        workflowSchemaLoading = null;
      });
  }
  //console.log({ workflowSchemaCache }, "Workflow schema load");
  return workflowSchemaCache;
};

const defaultWorkflowPayload = () => ({
  workflow_steps: [],
  workflow_name: "",
  when_trigger: "",
  trigger_table: "",
});

const randomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const randomChoice = (items) =>
  items.length ? items[randomInt(0, items.length - 1)] : undefined;

const randomBool = () => Math.random() < 0.5;

const generateWorkflowName = () =>
  `Workflow ${Math.floor(Math.random() * 9000) + 1000}`;

const sanitizeString = (value) =>
  typeof value === "string" ? value.trim() : "";

const buildActionCatalog = () => {
  try {
    const byName = {};
    const namespaceMap = new Map();
    const register = (name, namespace, description, origin) => {
      const cleanName = sanitizeString(name);
      if (!cleanName) return;
      const cleanNamespace = sanitizeString(namespace) || "Other";
      const entry = {
        name: cleanName,
        namespace: cleanNamespace,
        description: sanitizeString(description),
        origin: origin || "core",
      };
      if (byName[cleanName]) return;
      byName[cleanName] = entry;
      if (!namespaceMap.has(cleanNamespace))
        namespaceMap.set(cleanNamespace, []);
      namespaceMap.get(cleanNamespace).push(entry);
    };

    try {
      const builtInExplain = WorkflowStep.builtInActionExplainers({
        api_call: true,
      });
      Object.entries(builtInExplain).forEach(([name, description]) =>
        register(name, "Workflow Actions", description, "built-in"),
      );
    } catch (error) {
      console.error("GenerateWorkflowSkill: built-in actions failed", error);
    }

    try {
      const state = getState?.();
      const stateActions = state?.actions || {};
      Object.entries(stateActions)
        .filter(([_, action]) => !action.disableInWorkflow)
        .forEach(([name, action]) =>
          register(
            name,
            action.namespace || action.plugin_name || "Other",
            action.description,
            action.plugin_name || "core",
          ),
        );
    } catch (error) {
      console.error(
        "GenerateWorkflowSkill: failed to read state actions",
        error,
      );
    }

    try {
      const triggers = Trigger.find({
        when_trigger: { or: ["API call", "Never"] },
      });
      triggers.forEach((tr) => {
        const namespace = tr.action === "Workflow" ? "Workflows" : "Triggers";
        register(tr.name, namespace, tr.description, "trigger");
      });
    } catch (error) {
      console.error("GenerateWorkflowSkill: trigger lookup failed", error);
    }

    const namespaces = Array.from(namespaceMap.entries())
      .map(([namespace, actions]) => ({
        namespace,
        label: namespace,
        actions: actions.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return { byName, namespaces };
  } catch (error) {
    console.error("GenerateWorkflowSkill: action catalog failed", error);
    return { namespaces: [], byName: {} };
  }
};

const ensureActionCatalog = () => {
  if (!actionCatalogCache) actionCatalogCache = buildActionCatalog();
  return actionCatalogCache || FALLBACK_ACTION_CATALOG;
};

const summarizeActionCatalog = (limit = ACTION_SUMMARY_LIMIT) => {
  const catalog = ensureActionCatalog();
  if (!catalog.namespaces.length) return "";
  return catalog.namespaces
    .map(({ label, actions }) => {
      const names = actions
        .slice(0, limit)
        .map((a) => a.name)
        .join(", ");
      const suffix = actions.length > limit ? " ..." : "";
      return `${label}: ${names}${suffix}`;
    })
    .join("\n");
};

const toPlainObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};

const mergeStepConfiguration = (step) => {
  const config = toPlainObject(step.step_configuration);
  if (typeof config.step_type === "string")
    config.step_type = sanitizeString(config.step_type);
  else if (config.step_type != null)
    config.step_type = sanitizeString(String(config.step_type));
  else {
    const fallbackType = sanitizeString(step.step_type);
    if (fallbackType) config.step_type = fallbackType;
  }
  const reserved = new Set([
    "step_name",
    "only_if",
    "next_step",
    "step_configuration",
    "step_type",
  ]);
  Object.entries(step || {}).forEach(([key, value]) => {
    if (reserved.has(key)) return;
    if (config[key] === undefined) config[key] = value;
  });
  return config;
};

const normalizeWorkflowPayload = (rawPayload) => {
  if (!rawPayload) return defaultWorkflowPayload();
  let payload = rawPayload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      console.error("GenerateWorkflowSkill: failed to parse payload", error);
      return defaultWorkflowPayload();
    }
  }
  if (typeof payload !== "object" || Array.isArray(payload))
    return defaultWorkflowPayload();
  const normalizedSteps = Array.isArray(payload.workflow_steps)
    ? payload.workflow_steps.filter(Boolean).map((step) => {
        const plain = toPlainObject(step);
        const step_configuration = mergeStepConfiguration(plain);
        return {
          step_name: sanitizeString(plain.step_name || plain.name),
          only_if: sanitizeString(plain.only_if),
          next_step: sanitizeString(plain.next_step),
          step_configuration,
        };
      })
    : [];
  const normalized = {
    workflow_steps: normalizedSteps,
    workflow_name: sanitizeString(payload.workflow_name),
    trigger_table: sanitizeString(payload.trigger_table),
    when_trigger: ALLOWED_WHEN.has(payload.when_trigger)
      ? payload.when_trigger
      : "",
  };
  if (!normalized.when_trigger) normalized.when_trigger = "Never";
  if (
    normalized.when_trigger !== "Never" &&
    !ALLOWED_WHEN.has(normalized.when_trigger)
  )
    normalized.when_trigger = "Never";
  return normalized;
};

const analyzeWorkflowPayload = (payload) => {
  const warnings = [];
  const blocking = [];
  const actionCatalog = ensureActionCatalog();
  if (!payload.workflow_name) blocking.push("Workflow name is required.");
  if (!payload.workflow_steps.length)
    blocking.push("At least one workflow step is required.");
  const seenNames = new Set();
  const identifierStyle = /^[A-Za-z_][0-9A-Za-z_]*$/;
  const knownTargets = new Set(
    payload.workflow_steps.map((s) => s.step_name).filter(Boolean),
  );
  payload.workflow_steps.forEach((step, idx) => {
    const label = step.step_name || `Step #${idx + 1}`;
    if (!step.step_name) blocking.push(`${label} is missing step_name.`);
    else if (seenNames.has(step.step_name))
      blocking.push(`Duplicate step_name "${step.step_name}".`);
    else seenNames.add(step.step_name);
    const cfg = step.step_configuration;
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg))
      blocking.push(`${label} is missing step_configuration.`);
    else {
      const stepType = sanitizeString(cfg.step_type);
      if (!stepType)
        blocking.push(`${label} must specify step_configuration.step_type.`);
      else if (!actionCatalog.byName[stepType])
        warnings.push(`${label} uses unknown action "${stepType}".`);
    }
    const next = sanitizeString(step.next_step);
    if (next && identifierStyle.test(next) && !knownTargets.has(next))
      warnings.push(`${label} references unknown next_step "${next}".`);
  });
  if (TABLE_TRIGGER_WHEN.has(payload.when_trigger) && !payload.trigger_table)
    blocking.push(`${payload.when_trigger} triggers require a trigger_table.`);
  if (!TABLE_TRIGGER_WHEN.has(payload.when_trigger) && payload.trigger_table)
    warnings.push(
      `Trigger table "${payload.trigger_table}" will be ignored unless when_trigger is ${Array.from(TABLE_TRIGGER_WHEN).join("/")}.`,
    );
  return { warnings, blocking };
};

const describeWorkflow = (payload) => {
  const title = payload.workflow_name || "Unnamed workflow";
  const triggerDescription = TABLE_TRIGGER_WHEN.has(payload.when_trigger)
    ? payload.trigger_table
      ? `${payload.when_trigger} on ${payload.trigger_table}`
      : `${payload.when_trigger} (table not set)`
    : payload.when_trigger === "Never" || !payload.when_trigger
      ? "Manual run (Never)"
      : payload.when_trigger;
  const stepLines = payload.workflow_steps.length
    ? payload.workflow_steps.map((step, idx) =>
        formatStepDescription(step, idx),
      )
    : ["(no steps provided)"];
  return [
    `${title} – trigger: ${triggerDescription}`,
    "Steps:",
    ...stepLines,
  ].join("\n");
};

const escapeHtml = (str) =>
  String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildIssuesHtml = ({ warnings, blocking }) => {
  const chunks = [];
  if (blocking.length) {
    const items = blocking
      .map((issue) => `<li>${escapeHtml(issue)}</li>`)
      .join("");
    chunks.push(
      `<div class="alert alert-danger"><strong>Blocking issues</strong><ul class="mb-0">${items}</ul></div>`,
    );
  }
  if (warnings.length) {
    const items = warnings
      .map((issue) => `<li>${escapeHtml(issue)}</li>`)
      .join("");
    chunks.push(
      `<div class="alert alert-warning"><strong>Warnings</strong><ul class="mb-0">${items}</ul></div>`,
    );
  }
  return chunks.join("");
};

const renderWorkflowPreview = (payload) => {
  if (!payload.workflow_steps.length) return "";
  try {
    return GenerateWorkflow.render_html(payload);
  } catch (error) {
    console.error("GenerateWorkflowSkill: preview failed", error);
    return `<pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
  }
};

const formatIssueSection = (label, issues) =>
  issues.length
    ? [label, ...issues.map((issue) => `- ${issue}`)].join("\n")
    : `${label}: none`;

const payloadFromToolCall = (tool_call) => {
  if (!tool_call) return normalizeWorkflowPayload();
  if (Object.prototype.hasOwnProperty.call(tool_call, "input"))
    return normalizeWorkflowPayload(tool_call.input);
  if (
    tool_call.function &&
    Object.prototype.hasOwnProperty.call(tool_call.function, "arguments")
  )
    return normalizeWorkflowPayload(tool_call.function.arguments);
  return normalizeWorkflowPayload();
};

const buildEmptyStateText = () =>
  [
    "No workflow steps were generated yet.",
    "Describe what the workflow should do (even at a high level) and run the tool again—I'll turn that into concrete steps automatically.",
  ].join("\n\n");

const buildEmptyStateHtml = () =>
  '<div class="alert alert-info">No steps yet. Tell me what should happen in the workflow (simple or detailed) and rerun the generate_workflow tool—I will draft the steps for you.</div>';

const getStepConfigurationSchemas = () => {
  ensureWorkflowParameters();
  const schema = workflowSchemaCache;
  const stepConfig =
    schema?.properties?.workflow_steps?.items?.properties?.step_configuration;
  return Array.isArray(stepConfig?.anyOf) ? stepConfig.anyOf : [];
};

const isSimpleDescriptor = (descriptor) => {
  if (!descriptor) return false;
  if (Array.isArray(descriptor.enum) && descriptor.enum.length) return true;
  const type = descriptor.type;
  return SIMPLE_FIELD_TYPES.has(type);
};

const isSupportedActionSchema = (actionSchema) => {
  if (!actionSchema || typeof actionSchema !== "object") return false;
  const props = actionSchema.properties || {};
  const typeField = props.step_type;
  if (!typeField || !Array.isArray(typeField.enum) || !typeField.enum.length)
    return false;
  const requiredFields = (actionSchema.required || []).filter(
    (field) => field !== "step_type",
  );
  return requiredFields.every((field) => isSimpleDescriptor(props[field]));
};

const buildValueForDescriptor = (name, descriptor, idx) => {
  if (!descriptor) return undefined;
  if (Array.isArray(descriptor.enum) && descriptor.enum.length)
    return randomChoice(descriptor.enum);
  switch (descriptor.type) {
    case "string":
      return descriptor.default || `${name}_${idx + 1}`;
    case "integer":
    case "number":
      if (typeof descriptor.default === "number") return descriptor.default;
      return randomInt(1, 10);
    case "boolean":
      return randomBool();
    default:
      return undefined;
  }
};

const generateConfigFromSchema = (actionSchema, idx) => {
  const props = actionSchema?.properties || {};
  const stepTypeEnum = props.step_type?.enum;
  if (!Array.isArray(stepTypeEnum) || !stepTypeEnum.length) return null;
  const config = { step_type: stepTypeEnum[0] };
  const requiredFields = (actionSchema.required || []).filter(
    (field) => field !== "step_type",
  );
  for (const field of requiredFields) {
    const descriptor = props[field];
    const value = buildValueForDescriptor(field, descriptor, idx);
    if (value === undefined) return null;
    config[field] = value;
  }
  return config;
};

const buildRunJsFallbackSteps = (count = 2) => {
  const catalog = ensureActionCatalog();
  const hasRunJs = Boolean(catalog.byName["run_js_code"]);
  const actionName = hasRunJs
    ? "run_js_code"
    : Object.keys(catalog.byName)[0] || "run_js_code";
  const steps = [];
  for (let i = 0; i < count; i += 1) {
    const stepName = `step_${i + 1}`;
    const config = { step_type: actionName };
    if (actionName === "run_js_code") {
      config.run_where = "Server";
      config.code = `return { auto_message_${i + 1}: "Step ${i + 1} executed" };`;
    }
    steps.push({
      step_name: stepName,
      only_if: "",
      next_step: "",
      step_configuration: config,
    });
  }
  steps.forEach((step, idx) => {
    step.next_step = idx < steps.length - 1 ? steps[idx + 1].step_name : "";
  });
  return steps;
};

const buildRandomWorkflowSteps = () => {
  const availableSchemas = getStepConfigurationSchemas().filter((schema) =>
    isSupportedActionSchema(schema),
  );
  const desiredSteps = randomInt(RANDOM_STEP_COUNT.min, RANDOM_STEP_COUNT.max);
  const steps = [];
  let guard = desiredSteps * 3;
  while (steps.length < desiredSteps && guard > 0) {
    guard -= 1;
    const schema = randomChoice(availableSchemas);
    if (!schema) break;
    const config = generateConfigFromSchema(schema, steps.length);
    if (!config) continue;
    steps.push({
      step_name: `step_${steps.length + 1}`,
      only_if: "",
      next_step: "",
      step_configuration: config,
    });
  }
  if (!steps.length) return buildRunJsFallbackSteps(desiredSteps);
  steps.forEach((step, idx) => {
    step.next_step = idx < steps.length - 1 ? steps[idx + 1].step_name : "";
  });
  return steps;
};

const ensureWorkflowHasSteps = (payload) => {
  if (payload.workflow_steps.length) return payload;
  const seeded = {
    ...payload,
    workflow_steps: buildRandomWorkflowSteps(),
    workflow_name: payload.workflow_name || generateWorkflowName(),
    when_trigger: payload.when_trigger || "Never",
  };
  return seeded.workflow_steps.length
    ? normalizeWorkflowPayload(seeded)
    : payload;
};

const summarizeConfigValue = (value) => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return '""';
    return trimmed.length > 70 ? `${trimmed.slice(0, 67)}...` : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    const json = JSON.stringify(value);
    return json.length > 70 ? `${json.slice(0, 67)}...` : json;
  } catch (error) {
    console.error("GenerateWorkflowSkill: config summary failed", error);
    return "[complex value]";
  }
};

const describeStepSettings = (step) => {
  const items = [];
  if (step.only_if) items.push(`only_if=${step.only_if}`);
  if (step.next_step) items.push(`next=${step.next_step}`);
  return items.length ? items.join("; ") : "defaults";
};

const describeActionSettings = (config) => {
  if (!config) return "defaults";
  const pairs = Object.entries(config).filter(([key]) => key !== "step_type");
  if (!pairs.length) return "defaults";
  return pairs
    .map(([key, value]) => `${key}=${summarizeConfigValue(value)}`)
    .join("; ");
};

const formatStepDescription = (step, idx) => {
  const actionCatalog = ensureActionCatalog();
  const stepName = step.step_name || `Step ${idx + 1}`;
  const actionName = sanitizeString(step.step_configuration?.step_type) || "?";
  const actionMeta = actionCatalog.byName[actionName];
  const namespaceLabel = actionMeta?.namespace || "Unknown group";
  const extraInfo = actionMeta?.description
    ? ` – ${actionMeta.description}`
    : "";
  const settings = describeStepSettings(step);
  const actionSettings = describeActionSettings(step.step_configuration);
  return [
    `${idx + 1}. ${stepName}`,
    `   Step settings: ${settings}`,
    `   Action: ${actionName} (${namespaceLabel})${extraInfo}`,
    `   Action settings: ${actionSettings}`,
  ].join("\n");
};

class GenerateWorkflowSkill {
  static skill_name = "Generate Workflow";

  get skill_label() {
    return "Generate Workflow";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
    ensureWorkflowParameters();
    ensureActionCatalog();
  }

  static async configFields() {
    return [
      {
        name: "context_vars",
        label: "Initial context variables",
        input_type: "code",
        attributes: { mode: "application/json" },
        sublabel:
          'JSON object of key-value pairs pre-loaded into the workflow context at startup (e.g. {"ELEVENLABS_API_KEY": "sk-..."}). Keys are available by name in every run_js_code step.',
      },
    ];
  }

  _parseContextVars() {
    if (!this.context_vars) return null;
    try {
      const vars =
        typeof this.context_vars === "string"
          ? JSON.parse(this.context_vars)
          : this.context_vars;
      return Object.keys(vars).length ? vars : null;
    } catch {
      return null;
    }
  }

  async systemPrompt() {
    const base = await GenerateWorkflow.system_prompt();
    const vars = this._parseContextVars();
    if (!vars) return base;
    const keyList = Object.keys(vars).join(", ");
    return (
      base +
      `\n\nThe following values are pre-loaded into the workflow context before the first step runs: ${keyList}. ` +
      `Use them directly by name in run_js_code steps (e.g. \`${
        Object.keys(vars)[0]
      }\`) ` +
      `or via the context object (e.g. \`context.${Object.keys(vars)[0]}\`). ` +
      `Do not ask the user to supply these values — they are already available.`
    );
  }

  get userActions() {
    const context_vars = this._parseContextVars();
    return {
      async apply_copilot_workflow({ user, ...raw }) {
        const payload = ensureWorkflowHasSteps(normalizeWorkflowPayload(raw));
        const analysis = analyzeWorkflowPayload(payload);
        if (analysis.blocking.length)
          return {
            notify: `Cannot create workflow: ${analysis.blocking.join("; ")}`,
          };
        const result = await GenerateWorkflow.execute(
          payload,
          { user },
          context_vars
        );
        return {
          notify:
            result?.postExec ||
            `Workflow created: ${payload.workflow_name || "(unnamed)"}`,
        };
      },
    };
  }

  provideTools = () => {
    const parameters = ensureWorkflowParameters();
    return {
      type: "function",
      process: async (input) => {
        const payload = normalizeWorkflowPayload(input);
        const preparedPayload = ensureWorkflowHasSteps(payload);
        const hasSteps = preparedPayload.workflow_steps.length > 0;
        if (!hasSteps) return buildEmptyStateText();
        const analysis = analyzeWorkflowPayload(preparedPayload);
        const summary = describeWorkflow(preparedPayload);
        const actionSummary = summarizeActionCatalog();
        const sections = [
          summary,
          formatIssueSection("Blocking issues", analysis.blocking),
          formatIssueSection("Warnings", analysis.warnings),
        ];
        if (actionSummary) sections.push(`Action palette:\n${actionSummary}`);
        return sections.join("\n\n");
      },
      postProcess: async ({ tool_call }) => {
        const payload = payloadFromToolCall(tool_call);
        const preparedPayload = ensureWorkflowHasSteps(payload);
        const hasSteps = preparedPayload.workflow_steps.length > 0;
        if (!hasSteps)
          return {
            stop: true,
            add_response: buildEmptyStateHtml(),
          };
        const analysis = analyzeWorkflowPayload(preparedPayload);
        const issuesHtml = buildIssuesHtml(analysis);
        const previewHtml = renderWorkflowPreview(preparedPayload);
        const canCreate =
          analysis.blocking.length === 0 &&
          preparedPayload.workflow_steps.length > 0;
        return {
          stop: true,
          add_response: `${issuesHtml}${previewHtml}`,
          add_user_action: canCreate
            ? {
                name: "apply_copilot_workflow",
                type: "button",
                label: `Create workflow ${
                  preparedPayload.workflow_name || "(unnamed)"
                }`,
                input: preparedPayload,
              }
            : undefined,
        };
      },
      function: {
        name: GenerateWorkflow.function_name,
        description: GenerateWorkflow.description,
        parameters,
      },
    };
  };
}

ensureWorkflowParameters();
ensureActionCatalog();

module.exports = GenerateWorkflowSkill;
