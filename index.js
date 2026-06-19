const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const Trigger = require("@saltcorn/data/models/trigger");
const { features } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const Plugin = require("@saltcorn/data/models/plugin");
const { viewname } = require("./app-constructor/common.js");

const configuration_workflow = (cfg) =>
  new Workflow({
    steps: [
      {
        name: "Configuration",
        form: async () => {
          const triggers = await Trigger.find({ action: "Agent" });
          const webSearchTriggers = triggers.filter((t) =>
            (t.configuration?.skills || []).some(
              (s) =>
                s.skill_type === "Web search" &&
                ["Tavily", "Firecrawl"].includes(s.search_provider)
            )
          );
          return new Form({
            fields: [
              {
                input_type: "section_header",
                label: "App Constructor",
              },
              {
                name: "web_search_trigger",
                label: "Web search trigger",
                sublabel:
                  "Agent trigger with a Tavily or Firecrawl web search skill. " +
                  "Used during the Research step to gather domain-specific facts before generating questions.",
                type: "String",
                attributes: {
                  options: ["", ...webSearchTriggers.map((t) => t.name)],
                },
              },
            ],
          });
        },
      },
    ],
  });

const headers = [
  {
    script: `/static_assets/${db.connectObj.version_tag}/mermaid.min.js`,
    onlyViews: [viewname],
  },
];

module.exports = {
  sc_plugin_api_version: 1,
  configuration_workflow,
  headers: () => headers,
  dependencies: ["@saltcorn/large-language-model", "@saltcorn/agents"],
  viewtemplates: () =>
    features.workflows
      ? [
          require("./user-copilot"),
          require("./copilot-as-agent"),
          require("./app-constructor/view.js"),
        ]
      : [require("./action-builder"), require("./database-designer")],
  functions: () =>
    features.workflows
      ? {
          copilot_standard_prompt: require("./standard-prompt.js"),
          copilot_generate_layout: require("./builder-gen.js"),
          copilot_generate_workflow: require("./workflow-gen"),
          copilot_generate_javascript: require("./js-code-gen.js"),
        }
      : {},
  actions: () => ({
    copilot_generate_page: require("./page-gen-action"),
    app_constructor_feedback: require("./app-constructor/feedback-action.js"),
  }),
  exchange: () => ({
    agent_skills: [
      require("./agent-skills/pagegen.js"),
      require("./agent-skills/database-design.js"),
      require("./agent-skills/workflow.js"),
      require("./agent-skills/viewgen.js"),
      require("./agent-skills/registry-editor.js"),
      require("./agent-skills/js-action.js"),
      require("./agent-skills/triggergen.js"),
      ...(typeof Plugin.loadAndSaveNewPlugin === "function"
        ? [require("./agent-skills/install-plugin.js")]
        : []),
    ],
  }),
};
