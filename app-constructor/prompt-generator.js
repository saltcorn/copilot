const MetaData = require("@saltcorn/data/models/metadata");
const Table = require("@saltcorn/data/models/table");
const View = require("@saltcorn/data/models/view");
const Page = require("@saltcorn/data/models/page");
const Trigger = require("@saltcorn/data/models/trigger");
const Plugin = require("@saltcorn/data/models/plugin");
const { getState } = require("@saltcorn/data/db/state");
const {
  saltcorn_description,
  implementation_rules,
  fieldview_selection_rules,
  plugin_type_instruction,
  data_model_type_instruction,
  feature_type_instruction,
  task_planning_rules,
  task_planning_closing,
  error_fix_closing,
  feedback_task_overrides,
  feature_exec_rules,
  data_model_exec_rules,
  req_gen_rules,
  phase_gen_rules,
  phase_scope_rule,
  no_roles_table_rule,
  exec_tool_call_rule,
  exec_schema_rule_plugin,
  exec_schema_rule_data_model,
  exec_schema_rule_feature,
  feedback_analyse_decision,
  research_questions_rules,
} = require("./fixed-prompts");
const { TaskType } = require("./common");

const installed_plugins_list = (installedNames, storePlugins = []) => {
  const state = getState();
  const storeByName = Object.fromEntries(storePlugins.map((p) => [p.name, p]));
  const lines = [];
  for (const name of installedNames) {
    const resolvedName = state.plugin_module_names[name] || name;
    const mod = state.plugins[resolvedName];
    const storePlugin = storeByName[name];
    const app_constructor_rules = mod?.app_constructor_rules;
    const description = mod?.description || storePlugin?.description;
    const contents = storePlugin?.contents;
    if (!description && !contents && !app_constructor_rules) continue;
    let line = `### ${name}`;
    if (description) line += `\n${description}`;
    if (contents) line += `\n${contents}`;
    if (app_constructor_rules) line += `\n${app_constructor_rules}`;
    lines.push(line);
  }
  if (!lines.length) return "";
  return (
    `The following plugins are already installed and their viewtemplates, field types, and actions are available for use:\n\n` +
    lines.join("\n\n")
  );
};

const research_answers_section = (text) =>
  text
    ? `\nThe user was asked clarifying questions about the application. Here are the questions and their answers:\n\n${text}\n`
    : "";

const available_plugins_list = (storePlugins, installedNames) => {
  const uninstalled = storePlugins.filter((p) => !installedNames.has(p.name));
  if (!uninstalled.length) return "";
  const lines = uninstalled.map((p) => {
    let line = `### ${p.name}`;
    if (p.description) line += `\n${p.description}`;
    if (p.contents) line += `\n${p.contents}`;
    return line;
  });
  return (
    `The following plugins are available in the Saltcorn store but not yet installed. ` +
    `If a task requires functionality provided by one of these plugins (e.g. a specific view template, field type, or action), ` +
    `include an explicit "Install plugin <name>" task before it with the exact plugin name as listed here. ` +
    `The executor will use that name directly without needing to look it up.\n\n` +
    lines.join("\n\n")
  );
};
const format_table_entry = (table) => {
  const fieldLines = (table.fields || []).map((f) => {
    const attrs = [];
    if (f.required) attrs.push("NOT NULL");
    if (f.is_unique) attrs.push("unique");
    const def = f.attributes?.default;
    if (f.required && def !== undefined && def !== null && def !== "")
      attrs.push(`default: ${JSON.stringify(def)}`);
    const attrStr = attrs.length ? ` (${attrs.join(", ")})` : "";
    return `  * ${f.name} with type: ${f.pretty_type}${attrStr}.${
      f.description ? ` ${f.description}` : ""
    }`;
  });
  return `${table.name}${
    table.description ? `: ${table.description}.` : "."
  } Contains the following fields:\n${fieldLines.join("\n")}`;
};

const existing_entities_list = ({ views, triggers, pages, tableById = {} }) => {
  const sections = [];
  if (views.length)
    sections.push(
      `The following views are already implemented — do NOT plan tasks to create them. ` +
        `If you find yourself constructing a new view name that avoids a collision with an existing one ` +
        `(e.g. by prepending "my_", "user_", or "filtered_"), that is a signal you should use the existing view instead:\n` +
        views
          .map((v) => {
            const tablePart =
              v.table?.name ||
              (v.table_id && tableById[v.table_id]) ||
              v.exttable_name;
            return `- ${v.name} (${v.viewtemplate}${
              tablePart ? ` on ${tablePart}` : ""
            })`;
          })
          .join("\n")
    );
  if (triggers.length)
    sections.push(
      `The following triggers are already implemented — do NOT plan tasks to create them:\n` +
        triggers
          .map(
            (t) =>
              `- ${t.name} (${t.action}${
                t.when_trigger ? `, ${t.when_trigger}` : ""
              })`
          )
          .join("\n")
    );
  if (pages.length)
    sections.push(
      `CRITICAL — the following pages already exist and MUST NOT be recreated. ` +
        `Planning a task to create any page whose name appears in this list is a hard error. ` +
        `Before adding any page task to your plan, check this list first. ` +
        `If a requirement is served by one of these pages (even under a different name), reference the existing page by its exact name. ` +
        `If you find yourself constructing a new name that avoids a collision ` +
        `(e.g. by prepending "my_", appending "_v2", or changing a word), stop — use the existing page instead:\n` +
        pages
          .map(
            (p) => `- ${p.name}${p.description ? ` — ${p.description}` : ""}`
          )
          .join("\n")
    );
  return sections.join("\n\n");
};

const flatTablesList = (allTables) =>
  (allTables || []).map(format_table_entry).join("\n\n");

const buildGroupedTablesSection = async (allTables, currentPhaseIdx) => {
  if (!allTables.length) return "";

  const records = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "table_phase",
  });
  const tablePhaseMap = {};
  for (const r of records) tablePhaseMap[r.body.table_name] = r.body;

  const phaseGroups = {};
  const ungrouped = [];
  for (const table of allTables) {
    const assoc = tablePhaseMap[table.name];
    if (assoc !== undefined) {
      const idx = assoc.phase_idx;
      if (!phaseGroups[idx])
        phaseGroups[idx] = { phase_name: assoc.phase_name, tables: [] };
      phaseGroups[idx].tables.push(table);
    } else {
      ungrouped.push(table);
    }
  }

  const formatTables = (tables) => tables.map(format_table_entry).join("\n\n");

  const sections = [];
  const sortedIdxs = Object.keys(phaseGroups)
    .map(Number)
    .sort((a, b) => a - b);
  for (const idx of sortedIdxs) {
    const g = phaseGroups[idx];
    const label = g.phase_name
      ? `Phase ${idx + 1}: ${g.phase_name}`
      : `Phase ${idx + 1}`;
    sections.push(
      `--- Tables from ${label}${
        idx === currentPhaseIdx ? " (current phase)" : ""
      } ---\n\n${formatTables(g.tables)}`
    );
  }
  if (ungrouped.length)
    sections.push(
      `--- Tables with no phase association ---\n\n${formatTables(ungrouped)}`
    );

  return (
    "The database already contains the following tables, grouped by the phase that created them:\n\n" +
    sections.join("\n\n") +
    "\n\nAll tables listed above already exist — do NOT create or recreate any of them." +
    " Only plan tasks for tables or fields genuinely missing from the requirements of this phase."
  );
};

/**
 * Builds LLM prompts for every stage of the app-constructor pipeline.
 * Always create via `PromptGenerator.createInstance()` — the constructor is private.
 * All `*Prompt` methods return a ready-to-send string; they do not call the LLM.
 */
class PromptGenerator {
  /**
   * Factory — loads all shared context (spec, requirements, tables, plugins, research)
   * once so every prompt method can use it without extra DB calls.
   * @param {{ phase?: object|null }} [opts]
   * @returns {Promise<PromptGenerator>}
   */
  static async createInstance({ phase = null } = {}) {
    const instance = new PromptGenerator();

    instance.phase = phase;
    instance.spec = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "spec",
    });

    instance.allReqs = await MetaData.find({
      type: "CopilotConstructMgr",
      name: "requirement",
    });

    if (phase) {
      instance.reqLines = (phase.requirements || [])
        .map((r, i) => `${i + 1}. ${r.requirement} (priority ${r.priority})`)
        .join("\n");

      const allPhaseTasks = await MetaData.find({
        type: "CopilotConstructMgr",
        name: "task",
      });
      instance.existingDmNames = allPhaseTasks
        .filter(
          (t) =>
            t.body?.phase_idx === phase.idx && t.body.task_type === "data_model"
        )
        .map((t) => t.body.name)
        .filter(Boolean);
    } else {
      instance.reqLines = "";
      instance.existingDmNames = [];
    }

    instance.allTables = await Table.find({});
    instance.existingTablesSection = phase
      ? await buildGroupedTablesSection(instance.allTables, phase.idx)
      : "";

    const tableById = Object.fromEntries(
      instance.allTables.map((t) => [t.id, t.name])
    );
    const [views, triggers, pages] = await Promise.all([
      View.find({}),
      Trigger.find({}),
      Page.find({}),
    ]);
    instance.entitiesSection = existing_entities_list({
      views,
      triggers,
      pages,
      tableById,
    });

    instance.installedNames = new Set();
    instance.storePlugins = [];
    instance.installedPluginsSection = "";
    instance.pluginAvailabilitySections = [];
    try {
      const allInstalled = await Plugin.find({});
      instance.installedNames = new Set(allInstalled.map((p) => p.name));
      instance.storePlugins = (await Plugin.store_plugins_available()) || [];
      instance.installedPluginsSection = installed_plugins_list(
        instance.installedNames,
        instance.storePlugins
      );
      const availableSection = available_plugins_list(
        instance.storePlugins,
        instance.installedNames
      );
      if (availableSection)
        instance.pluginAvailabilitySections.push(availableSection);
      if (instance.installedNames.size)
        instance.pluginAvailabilitySections.push(
          "The following plugins are already installed — do NOT install them again:\n" +
            [...instance.installedNames].map((n) => `- ${n}`).join("\n")
        );
    } catch (_) {}

    const { getResearchAnswersText } = require("./research");
    instance.researchSection = research_answers_section(
      await getResearchAnswersText()
    );

    return instance;
  }

  /** Prompt for the ask_questions LLM call — generates clarifying research questions from the spec. */
  researchQuestionsPrompt() {
    return [
      research_questions_rules,
      `Specification:\n${this.spec?.body?.specification}`,
      "Now call the ask_questions tool with your questions.",
    ].join("\n\n");
  }

  /** Prompt for the make_requirements LLM call — extracts requirements from the spec. */
  requirementsPlanPrompt() {
    const parts = [
      "Generate the requirements for this application:",
      this.spec?.body?.specification,
    ];
    if (this.researchSection) parts.push(this.researchSection);
    parts.push(
      req_gen_rules.join("\n\n"),
      "Now use the make_requirements tool to list the requirements for this software application."
    );
    return parts.filter(Boolean).join("\n\n");
  }

  /** Prompt for the set_phases LLM call — groups requirements into delivery phases. */
  phasesPlanPrompt() {
    const parts = [
      "Generate the development phases for this application. Each phase groups a set of\n" +
        "requirements that belong together and form a coherent milestone.",
      this.spec?.body?.specification,
    ];
    if (this.researchSection) parts.push(this.researchSection);
    parts.push(
      phase_gen_rules.join("\n\n"),
      "Now call the set_phases tool with your phases and their grouped requirements."
    );
    return parts.filter(Boolean).join("\n\n");
  }

  /**
   * Prompt for the plan_tasks LLM call — plans implementation tasks for one phase.
   * Requires the instance to have been created with a `phase` object.
   * @param {"plugin"|"data_model"|"feature"} taskType
   */
  taskPlanPrompt(taskType) {
    const parts = [
      "You are planning the implementation tasks for a single phase of a Saltcorn application.",
      `Application specification:\n${this.spec?.body?.specification}`,
    ];
    if (this.researchSection) parts.push(this.researchSection);
    parts.push(
      `Phase: ${this.phase.name}\n${this.phase.description}`,
      `Requirements for this phase:\n${this.reqLines}`,
      phase_scope_rule,
      no_roles_table_rule
    );
    switch (taskType) {
      case "plugin":
        parts.push(plugin_type_instruction.join("\n"));
        parts.push(...this.pluginAvailabilitySections);
        break;
      case "data_model":
        parts.push(data_model_type_instruction.join("\n"));
        if (this.installedPluginsSection)
          parts.push(this.installedPluginsSection);
        break;
      case "feature":
        parts.push(feature_type_instruction.join("\n"));
        if (this.installedPluginsSection)
          parts.push(this.installedPluginsSection);
        if (this.existingDmNames.length)
          parts.push(
            `The following data model tasks already exist for this phase` +
              ` and may be referenced in depends_on:\n${this.existingDmNames.join(
                ", "
              )}`
          );
        if (this.entitiesSection) parts.push(this.entitiesSection);
        parts.push(task_planning_rules.join("\n\n"));
        break;
      default:
        throw new Error(`Unknown taskType: ${taskType}`);
    }
    if (this.existingTablesSection) parts.push(this.existingTablesSection);
    parts.push(
      task_planning_closing.join("\n\n"),
      "Now call the plan_tasks tool with your tasks for this phase."
    );
    return parts.join("\n\n");
  }

  /**
   * Prompt sent to the agent that executes a single task.
   * @param {"plugin"|"data_model"|"feature"} taskType
   * @param {string} description  Task description from the plan.
   */
  taskExecPrompt(taskType, description) {
    const parts = [
      `You are engaged in building the following application:\n\n${this.spec?.body?.specification}`,
      taskType === TaskType.PLUGIN
        ? exec_schema_rule_plugin
        : taskType === TaskType.DATA_MODEL
        ? exec_schema_rule_data_model
        : exec_schema_rule_feature,
    ];
    if (this.researchSection) parts.push(this.researchSection);
    if (taskType === TaskType.PLUGIN)
      parts.push(...this.pluginAvailabilitySections);
    if (this.installedPluginsSection) parts.push(this.installedPluginsSection);
    if (taskType === TaskType.FEATURE && this.allTables.length) {
      parts.push(
        `The database already contains the following tables:\n\n${flatTablesList(
          this.allTables
        )}`
      );
    }
    if (taskType === TaskType.FEATURE) {
      parts.push(implementation_rules.join("\n\n"));
      parts.push(feature_exec_rules.join("\n\n"));
    } else if (taskType === TaskType.DATA_MODEL) {
      parts.push(data_model_exec_rules.join("\n\n"));
    }
    parts.push(exec_tool_call_rule);
    if (description) parts.push(`Your task now is:\n${description}`);
    return parts.filter(Boolean).join("\n\n");
  }

  /**
   * Prompt for the self-healing plan_tasks / cannot_fix LLM call.
   * @param {string} errorText       JSON-stringified error object.
   * @param {string} [entityConfigSection]  Pre-built config excerpt for the affected entity.
   */
  errorPrompt(errorText, entityConfigSection = "") {
    const parts = [
      `Fix a bug in the following Saltcorn application.\n\n${this.spec?.body?.specification}`,
    ];
    if (this.researchSection) parts.push(this.researchSection);
    if (this.allReqs.length)
      parts.push(
        `The existing application requirements are:\n\n` +
          this.allReqs.map((r) => `* ${r.body.requirement}`).join("\n")
      );
    parts.push(saltcorn_description.join("\n\n"));
    parts.push(implementation_rules.join("\n\n"));
    parts.push(fieldview_selection_rules.join("\n\n"));
    parts.push(
      `The database has the following tables:\n\n${flatTablesList(
        this.allTables
      )}`
    );
    if (this.entitiesSection) parts.push(this.entitiesSection);
    if (this.installedPluginsSection) parts.push(this.installedPluginsSection);
    const availableSection = available_plugins_list(
      this.storePlugins,
      this.installedNames
    );
    if (availableSection) parts.push(availableSection);
    parts.push(task_planning_rules.join("\n\n"));
    parts.push(
      `The following error occurred in the application:\n\`\`\`\n${errorText}\n\`\`\``
    );
    if (entityConfigSection) parts.push(entityConfigSection);
    parts.push(task_planning_closing.join("\n\n"));
    parts.push(error_fix_closing.join("\n\n"));
    return parts.filter(Boolean).join("\n\n");
  }

  /**
   * Prompt for deciding whether feedback needs clarifying questions (ask_questions tool).
   * `knownContext` is derived from the feedback URL before calling this method.
   * @param {{ title: string, description: string,
   *           knownContext?: { section: string, doNotAsk: string|null }|null }} opts
   */
  feedbackAnalysePrompt({ title, description, knownContext = null }) {
    const parts = [];
    if (this.spec?.body?.specification)
      parts.push(
        `The following application is being built:\n\n${this.spec.body.specification}`
      );
    if (knownContext) parts.push(knownContext.section);
    parts.push(
      `User feedback:\n- Title: ${title}` +
        (description ? `\n- Description: ${description}` : "")
    );
    if (knownContext?.doNotAsk)
      parts.push(
        `Facts already known — do NOT ask about these:\n${knownContext.doNotAsk}`
      );
    parts.push(feedback_analyse_decision);
    return parts.filter(Boolean).join("\n\n");
  }

  /**
   * Step 1 of 2 for feedback processing.
   * Prompt for deriving new requirements from a piece of user feedback (make_requirements tool).
   * @param {{ title: string, description: string, urlSection?: string, feedbackResearchSection?: string }} opts
   */
  feedbackReqPrompt({
    title,
    description,
    urlSection = "",
    feedbackResearchSection = "",
  }) {
    const parts = [
      `The following application is being built:\n\n${this.spec?.body?.specification}`,
    ];
    if (this.researchSection) parts.push(this.researchSection);
    parts.push(
      `A new piece of feedback has come in from a user:\n\nTitle: ${title}\nDescription: ${description}`
    );
    if (urlSection) parts.push(urlSection);
    if (feedbackResearchSection) parts.push(feedbackResearchSection);
    parts.push(
      `Now use the make_requirements tool to create a single or several (a single is\n` +
        `preferred) new requirements that captures this new piece of feedback.\n\n` +
        `* Priority reflects how central the feature is to the core purpose of the\n` +
        `  application. Assign 5 to features without which the application cannot function\n` +
        `  at all, 3–4 to features that are important but not blocking, 1–2 to minor\n` +
        `  convenience features. Do not assign 5 to everything.`
    );
    return parts.filter(Boolean).join("\n\n");
  }

  /**
   * Step 2 of 2 for feedback processing.
   * Prompt for planning implementation tasks for the feedback (plan_tasks tool).
   * Call after feedbackReqPrompt — pass its output as `newRequirements`.
   * `this.allReqs` must be captured before the new requirements are saved to the DB.
   * @param {{ title: string, description: string, urlSection?: string,
   *           feedbackResearchSection?: string, newRequirements?: object[] }} opts
   */
  feedbackPrompt({
    title,
    description,
    urlSection = "",
    feedbackResearchSection = "",
    newRequirements = [],
  }) {
    const parts = [
      `Generate implementation tasks for a new piece of feedback for this application:\n\n${this.spec?.body?.specification}`,
    ];
    if (this.researchSection) parts.push(this.researchSection);
    parts.push(
      `A new piece of feedback has come in from a user:\n\nTitle: ${title}\nDescription: ${description}`
    );
    if (urlSection) parts.push(urlSection);
    if (feedbackResearchSection) parts.push(feedbackResearchSection);
    if (this.allReqs.length)
      parts.push(
        `The existing application requirements are:\n\n` +
          this.allReqs.map((r) => `* ${r.body.requirement}`).join("\n")
      );
    if (newRequirements.length)
      parts.push(
        `A product manager has determined that the following new requirements should be added to implement this feedback:\n\n` +
          newRequirements.map((r) => `  * ${r.requirement}`).join("\n")
      );
    parts.push(saltcorn_description.join("\n\n"));
    parts.push(
      `The database has already been built. The following tables are now present in the database:\n\n${flatTablesList(
        this.allTables
      )}\n\n` +
        `The plan should outline continued development of the application on top of this database.`
    );
    if (this.entitiesSection) parts.push(this.entitiesSection);
    if (this.installedPluginsSection) parts.push(this.installedPluginsSection);
    const availableSection = available_plugins_list(
      this.storePlugins,
      this.installedNames
    );
    if (availableSection) parts.push(availableSection);
    parts.push(task_planning_rules.join("\n\n"));
    parts.push(task_planning_closing.join("\n\n"));
    parts.push(
      "Important overrides for feedback tasks:\n" +
        feedback_task_overrides.map((r) => `* ${r}`).join("\n")
    );
    parts.push(
      "Now use the plan_tasks tool to create the tasks to implement this new feedback."
    );
    return parts.filter(Boolean).join("\n\n");
  }
}

module.exports = { PromptGenerator };
