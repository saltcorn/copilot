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
            required: ["requirement", "priority"],
            additionalProperties: false,
            properties: {
              name: {
                type: "string",
                description: "A short name for the task",
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
                  "The names of the tasks that must be completed before this tasks can be started",
                items: {
                  type: "string",
                },
              },
            },
          },
        },
      },
    },
  },
};

module.exports = { requirements_tool,task_tool };
