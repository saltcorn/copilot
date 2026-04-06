const { getState } = require("@saltcorn/data/db/state");
const { getPromptFromTemplate } = require("./common");
const Table = require("@saltcorn/data/models/table");

const stripCodeFences = (text) => {
  let s = String(text || "").trim();
  s = s.replace(/^```(?:javascript|js|ts|typescript)?\s*\n?/i, "");
  s = s.replace(/\n?```\s*$/i, "");
  return s.trim();
};

const getTableContext = (table_name) => {
  if (!table_name) return null;
  const table = Table.findOne({ name: table_name });
  if (!table) return null;
  const fields = table.getFields ? table.getFields() : table.fields || [];
  return { table, fieldNames: fields.map((f) => f.name) };
};

module.exports = {
  run: async (description, existing_code, table_name) => {
    const systemPrompt = await getPromptFromTemplate(
      "action-builder.txt",
      description
    );

    const tableCtx = getTableContext(table_name);
    let contextInfo;
    if (tableCtx) {
      contextInfo =
        `\n\nThis action runs in the context of the "${table_name}" table. ` +
        `Available variables: row (with fields: ${tableCtx.fieldNames.join(", ")}), ` +
        `user, table, console, Actions, Table, File, User.`;
    } else {
      contextInfo =
        "\n\nAvailable variables: user, console, Actions, Table, File, User.";
    }

    let prompt;
    if (existing_code && existing_code.trim()) {
      prompt =
        `Modify the following JavaScript code based on this instruction: ${description}\n\n` +
        `Existing code:\n${existing_code}` +
        `${contextInfo}\n\n` +
        `Return only the modified JavaScript code. Do not include any explanation or markdown code fences.`;
    } else {
      prompt =
        `Generate JavaScript code for the following task: ${description}` +
        `${contextInfo}\n\n` +
        `Only return the JavaScript code. Do not include any explanation or markdown code fences.`;
    }

    const result = await getState().functions.llm_generate.run(prompt, {
      systemPrompt,
    });
    return stripCodeFences(result);
  },
  isAsync: true,
  description: "Generate JavaScript code for an action",
  arguments: [
    { name: "description", type: "String" },
    { name: "existing_code", type: "String" },
    { name: "table_name", type: "String" },
  ],
};
