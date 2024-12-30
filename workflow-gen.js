const { getState } = require("@saltcorn/data/db/state");

module.exports = {
  run: async (description, trigger_id) => {
    const gen = getState().functions.llm_generate.run(description, {
      systemPrompt: `You are a helpful code assistant.`,
    });
    return [];
  },
  isAsync: true,
  description: "Generate a workflow",
  arguments: [
    { name: "description", type: "String" },
    { name: "trigger_id", type: "Integer" },
  ],
};
