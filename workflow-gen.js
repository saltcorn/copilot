const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");
const GenerateWorkflow = require("./actions/generate-workflow");

const workflow_function = async () => ({
  type: "function",
  function: {
    name: "generate_workflow",
    description: "Generate the steps in a workflow",
    parameters: GenerateWorkflow.json_schema(),
  },
});

module.exports = {
  run: async (description) => {
    const rnd = Math.round(100 * Math.random());
    const systemPrompt = GenerateWorkflow.system_prompt();

    const toolargs = {
      tools: [await workflow_function()],
      tool_choice: {
        type: "function",
        function: { name: "generate_workflow" },
      },
      systemPrompt,
    };
    const prompt = `Design a workflow to implement a workflow accorfing to the following specification: ${description}`;
    console.log(prompt);
    console.log(JSON.stringify(toolargs, null, 2));

    const answer = await getState().functions.llm_generate.run(
      prompt,
      toolargs
    );
    const resp = JSON.parse(answer.tool_calls[0].function.arguments);
    const scsteps = resp.workflow_steps.map(GenerateWorkflow.to_saltcorn_step);

    return scsteps;
  },
  isAsync: true,
  description: "Generate a workflow",
  arguments: [{ name: "description", type: "String" }],
};
