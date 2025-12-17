const { eval_expression } = require("@saltcorn/data/models/expression");
const { interpolate } = require("@saltcorn/data/utils");
const { getState } = require("@saltcorn/data/db/state");
const GeneratePage = require("./actions/generate-page");

module.exports = {
  description: "Generate page with AI copilot",
  configFields: ({ table, mode }) => {
    if (mode === "workflow") {
      return [
        {
          name: "page_name",
          label: "Page name",
          sublabel:
            "Leave blank to not save a Saltcorn page. Use interpolations {{ }} to access variables in the context",
          type: "String",
        },
        {
          name: "prompt_template",
          label: "Prompt",
          sublabel:
            "Prompt text. Use interpolations {{ }} to access variables in the context",
          type: "String",
          fieldview: "textarea",
          required: true,
        },
        {
          name: "answer_field",
          label: "Answer variable",
          sublabel: "Optional. Set the generated HTML to this context variable",
          type: "String",
          required: true,
        },
        //   ...override_fields,
        {
          name: "model",
          label: "Model",
          sublabel: "Override default model name",
          type: "String",
        },
      ];
    } else if (table) {
      const textFields = table.fields
        .filter((f) => f.type?.sql_name === "text")
        .map((f) => f.name);

      return [
        {
          name: "prompt_field",
          label: "Prompt field",
          sublabel: "Field with the text of the prompt",
          type: "String",
          required: true,
          attributes: { options: [...textFields, "Formula"] },
        },
        {
          name: "prompt_formula",
          label: "Prompt formula",
          type: "String",
          showIf: { prompt_field: "Formula" },
        },
        {
          name: "answer_field",
          label: "Answer field",
          sublabel: "Output field will be set to the generated answer",
          type: "String",
          required: true,
          attributes: { options: textFields },
        },
        //  ...override_fields,
      ];
    }
  },
  run: async ({
    row,
    table,
    user,
    mode,
    configuration: {
      prompt_field,
      prompt_formula,
      prompt_template,
      answer_field,
      chat_history_field,
      model,
    },
  }) => {
    let prompt;
    if (mode === "workflow") prompt = interpolate(prompt_template, row, user);
    else if (prompt_field === "Formula" || mode === "workflow")
      prompt = eval_expression(
        prompt_formula,
        row,
        user,
        "llm_generate prompt formula"
      );
    else prompt = row[prompt_field];
    const opts = {};

    if (model) opts.model = model;
    const tools = [];
    const systemPrompt = await GeneratePage.system_prompt();
    tools.push({
      type: "function",
      function: {
        name: GeneratePage.function_name,
        description: GeneratePage.description,
        parameters: await GeneratePage.json_schema(),
      },
    });
    const { llm_generate } = getState().functions;

    const ans = await llm_generate(prompt, {
      tools,
      systemPrompt,
    });
    const upd = { [answer_field]: ans };
    if (mode === "workflow") return upd;
    else await table.updateRow(upd, row[table.pk_name]);
  },
};
