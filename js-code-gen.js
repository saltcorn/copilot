const { getState } = require("@saltcorn/data/db/state");
const { getPromptFromTemplate } = require("./common");

const stripCodeFences = (text) =>
  String(text || "")
    .replace(/^```(?:javascript|js)?\n?/m, "")
    .replace(/\n?```$/m, "")
    .trim();

module.exports = {
  run: async (description) => {
    const systemPrompt = await getPromptFromTemplate("action-builder.txt", description);
    const prompt = `Generate JavaScript code for the following task: ${description}\n\nOnly return the JavaScript code. Do not include any explanation or markdown code fences.`;
    const result = await getState().functions.llm_generate.run(prompt, {
      systemPrompt,
    });
    return stripCodeFences(result);
  },
  isAsync: true,
  description: "Generate JavaScript code",
  arguments: [{ name: "description", type: "String" }],
};
