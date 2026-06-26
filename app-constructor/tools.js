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
            ],
            additionalProperties: false,
            properties: {
              name: {
                type: "string",
                description:
                  "A short unique name for the task (snake_case). Every other task that depends on this task must use exactly this name in their depends_on array.",
              },
              description: {
                type: "string",
                description: "A full description of the task",
              },
              priority: {
                type: "number",
                description:
                  "Priority 1-5. 5: Most important, 1: Least important",
              },
              depends_on: {
                type: "array",
                description:
                  "Names of tasks in THIS plan that must complete before this task starts. Every name listed here MUST exactly match the name of another task in this same plan_tasks call. Never reference a task name that is not present in the tasks array.",
                items: {
                  type: "string",
                },
              },
              task_type: {
                type: "string",
                enum: ["plugin", "data_model", "feature"],
                description:
                  "plugin: specialized — installs a plugin from the Saltcorn plugin store. data_model: specialized — creates or modifies database tables/fields only. feature: broad catch-all — creates views, pages, triggers, workflows, or anything else not covered by the specialized types. Order: plugin tasks first, then data_model, then feature.",
              },
              modifies_existing_table: {
                type: "boolean",
                description:
                  "Set to true when this task adds fields to or modifies an existing table that has no phase association (listed under 'Tables with no phase association'). Omit or set to false for tasks that only create brand-new tables.",
              },
            },
          },
        },
      },
    },
  },
};

module.exports = { requirements_tool, task_tool };
