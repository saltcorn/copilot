const { TASK_TOPICS } = require("./common");

const requirements_tool = {
  type: "function",
  function: {
    name: "make_requirements",
    description: "Provide a list of requirements for the application",
    parameters: {
      type: "object",
      required: ["requirements"],
      additionalProperties: false,
      properties: {
        requirements: {
          type: "array",
          items: {
            type: "object",
            required: ["requirement", "priority"],
            additionalProperties: false,
            properties: {
              requirement: {
                type: "string",
                description: "A statement of the requirement",
              },
              priority: {
                type: "number",
                description:
                  "Priority 1-5. 5: Most important, 1: Least important",
              },
            },
          },
        },
      },
    },
  },
};

const task_tool = {
  type: "function",
  function: {
    name: "plan_tasks",
    description: "Provide a series of tasks for building the application",
    parameters: {
      type: "object",
      required: ["tasks"],
      additionalProperties: false,
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            required: [
              "name",
              "description",
              "priority",
              "depends_on",
              "task_type",
              "modifies_existing_table",
              "topics",
            ],
            additionalProperties: false,
            properties: {
              name: {
                type: "string",
                description:
                  "A short unique name for the task (snake_case). Every other task " +
                  "that depends on this task must use exactly this name in their " +
                  "depends_on array.",
              },
              description: {
                type: "string",
                description:
                  "A full description of the task. Name every entity it creates or " +
                  "references by its exact snake_case name — depends_on below is checked " +
                  "against these names.",
              },
              priority: {
                type: "number",
                description:
                  "Priority 1-5. 5: Most important, 1: Least important",
              },
              depends_on: {
                type: "array",
                description:
                  "Names of tasks in THIS plan that must complete before this task " +
                  "starts. Re-read the description you just wrote: every view/page/entity " +
                  "it names that doesn't already exist (a viewlink target, an embed, a " +
                  "link) belongs here — don't skip this check just because it's rare for " +
                  "this task. Every name listed MUST exactly match another task's name in " +
                  "this same plan_tasks call; never a name absent from the tasks array.",
                items: {
                  type: "string",
                },
              },
              task_type: {
                type: "string",
                enum: ["plugin", "data_model", "feature"],
                description:
                  "plugin: specialized — installs a plugin from the Saltcorn " +
                  "plugin store. data_model: specialized — creates or modifies " +
                  "database tables/fields only. feature: broad catch-all — " +
                  "creates views, pages, triggers, workflows, or anything else " +
                  "not covered by the specialized types. Order: plugin tasks " +
                  "first, then data_model, then feature.",
              },
              modifies_existing_table: {
                type: "boolean",
                description:
                  "true only when this task adds fields to or otherwise modifies an existing " +
                  "table listed under 'Tables with no phase association'; false otherwise, " +
                  "including for tasks that create new tables.",
              },
              topics: {
                type: "array",
                description:
                  "For task_type 'plugin' or 'data_model', this must be []. " +
                  "For task_type 'feature', include every topic from the fixed list below " +
                  "that applies to any work performed by this task. Topics determine which " +
                  "implementation guidance the executor receives, so do not omit an " +
                  "applicable topic. When applicability is uncertain, prefer including the " +
                  "topic. Use [] only when no listed topic applies.\n" +
                  "- view_embedding: embeds, links, or references another view/page " +
                  "(dashboards, viewlinks, embedded lists/shows)\n" +
                  "- workflow: creates or updates a workflow (TableQuery, PDF " +
                  "export, loops, row inserts, etc.)\n" +
                  "- custom_code: uses a JsCode view or a run_js_code workflow step\n" +
                  "- trigger_action: creates a trigger or an action button " +
                  "(modify_row, single-step actions)\n" +
                  "- auth_pages: a landing, login, or signup page\n" +
                  "- list_view: creates or updates a List view\n" +
                  "- show_view: creates or updates a Show view\n" +
                  "- edit_view: creates or updates an Edit view\n" +
                  "- navigation_links: adds a Link column or cross-page navigation\n" +
                  "- system_config: sets home_page_by_role, 2FA, or other " +
                  "system-configuration-value entities",
                items: {
                  type: "string",
                  enum: TASK_TOPICS,
                },
              },
            },
          },
        },
      },
    },
  },
};

// LLM tool schema for phase planning - pure data, used by PhaseHelper.generatePhases.
const phases_tool = {
  type: "function",
  function: {
    name: "set_phases",
    description:
      "Set the development phases for the application. Each phase groups " +
      "a set of requirements that belong together and should be built in " +
      "the same iteration.",
    parameters: {
      type: "object",
      required: ["phases"],
      additionalProperties: false,
      properties: {
        phases: {
          type: "array",
          minItems: 1,
          description: "Ordered list of development phases",
          items: {
            type: "object",
            required: ["name", "description", "requirements"],
            additionalProperties: false,
            properties: {
              name: {
                type: "string",
                description:
                  "Short phase name, e.g. 'Phase 1: Core data entry'",
              },
              description: {
                type: "string",
                description:
                  "1–3 sentences describing what this phase delivers and why it " +
                  "forms a coherent milestone",
              },
              requirements: {
                type: "array",
                description:
                  "The requirements that belong to this phase, in the same format " +
                  "as make_requirements",
                items: {
                  type: "object",
                  required: ["requirement", "priority"],
                  additionalProperties: false,
                  properties: {
                    requirement: {
                      type: "string",
                      description: "A statement of the requirement",
                    },
                    priority: {
                      type: "number",
                      description:
                        "Priority 1-5. 5: Must-have for this phase, 1: Nice-to-have",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

module.exports = { requirements_tool, task_tool, phases_tool };
