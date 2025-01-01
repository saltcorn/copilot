const { getState } = require("@saltcorn/data/db/state");

module.exports = {
  run: async (description, trigger_id) => {
    /*const gen = getState().functions.llm_generate.run(description, {
      systemPrompt: `You are a helpful code assistant.`,
    });*/
    const rnd = Math.round(100 * Math.random());
    return [
      {
        name: "step1",
        trigger_id,
        next_step: "",
        only_if: "",
        action_name: "SetContext",
        initial_step: true,
        configuration: {
          ctx_values: `{x: ${rnd}}`,
        },
      },
    ];
  },
  isAsync: true,
  description: "Generate a workflow",
  arguments: [
    { name: "description", type: "String" },
    { name: "trigger_id", type: "Integer" },
  ],
};
