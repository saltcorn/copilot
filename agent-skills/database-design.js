const GenerateTables = require("../actions/generate-tables");

const normalizeTablesPayload = (rawPayload) => {
  if (!rawPayload) return { tables: [] };
  let payload = rawPayload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      console.error("Failed to parse generate_tables payload", e);
      return { tables: [] };
    }
  }
  if (typeof payload !== "object") return { tables: [] };
  const normalized = { ...payload };
  normalized.tables = Array.isArray(normalized.tables)
    ? normalized.tables.filter(Boolean).map((table) => ({
        ...table,
        fields: Array.isArray(table?.fields)
          ? table.fields.filter(Boolean).map((field) => ({
              ...field,
              type_and_configuration: field?.type_and_configuration || {},
            }))
          : [],
      }))
    : [];
  return normalized;
};

const summarizeTables = (tables) =>
  tables.map((table, idx) => {
    const fields = (table.fields || []).slice(0, 5);
    const fieldSummary = fields
      .map((field) => {
        const fname = field?.name || "(missing name)";
        const ftype = field?.type_and_configuration?.data_type || "Unknown";
        return `${fname}:${ftype}`;
      })
      .join(", ");
    const ellipsis = table.fields.length > fields.length ? "..." : "";
    return `${idx + 1}. ${table.table_name || "(missing name)"} – ${
      table.fields.length
    } field(s)${fieldSummary ? ` (${fieldSummary}${ellipsis})` : ""}`;
  });

const collectTableWarnings = (tables) => {
  const warnings = [];
  const seenTables = new Set();
  tables.forEach((table, tableIdx) => {
    const tableLabel = table.table_name || `Table #${tableIdx + 1}`;
    if (!table.table_name)
      warnings.push(`${tableLabel} is missing a table_name.`);
    else if (seenTables.has(table.table_name))
      warnings.push(`Duplicate table name "${table.table_name}".`);
    else seenTables.add(table.table_name);

    if (!Array.isArray(table.fields) || table.fields.length === 0)
      warnings.push(`${tableLabel} does not define any fields.`);

    const fieldNames = new Set();
    (table.fields || []).forEach((field, fieldIdx) => {
      const fieldLabel = field?.name || `Field #${fieldIdx + 1}`;
      if (!field?.name)
        warnings.push(`${tableLabel} has a field without a name.`);
      else if (fieldNames.has(field.name))
        warnings.push(`${tableLabel} repeats the field name "${field.name}".`);
      else fieldNames.add(field.name);

      if (!field?.type_and_configuration?.data_type)
        warnings.push(
          `${tableLabel}.${fieldLabel} must include type_and_configuration.data_type.`
        );

      if ((field?.name || "").toLowerCase() === "id")
        warnings.push(
          `${tableLabel}.${fieldLabel} should be omitted because every table already has an auto-increment id.`
        );
    });
  });
  return warnings;
};

const payloadFromToolCall = (tool_call) => {
  if (!tool_call) return { tables: [] };
  if (tool_call.input) return normalizeTablesPayload(tool_call.input);
  if (tool_call.function?.arguments)
    return normalizeTablesPayload(tool_call.function.arguments);
  return { tables: [] };
};

class GenerateTablesSkill {
  static skill_name = "Database design";

  get skill_label() {
    return "Database Design";
  }

  constructor(cfg) {
    console.log("GenerateTablesSkill.constructor called", { cfg });
    Object.assign(this, cfg);
  }

  async systemPrompt() {
    console.log("GenerateTablesSkill.systemPrompt called");
    return await GenerateTables.system_prompt();
  }

  get userActions() {
    console.log("GenerateTablesSkill.userActions getter accessed");
    return {
      async apply_copilot_tables({ user, tables }) {
        console.log("GenerateTablesSkill.userActions.apply_copilot_tables called", {
          user_id: user?.id,
          table_count: tables?.length,
        });
        if (!tables?.length) return { notify: "Nothing to create." };
        await GenerateTables.execute({ tables }, { user });
        return {
          notify: `Created tables: ${tables.map((t) => t.table_name).join(", ")}`,
        };
      },
    };
  }

  provideTools = () => {
    console.log("GenerateTablesSkill.provideTools called");
    const parameters = GenerateTables.json_schema();
    return {
      type: "function",
      process: async (input) => {
        const payload = normalizeTablesPayload(input);
        const tables = payload.tables || [];
        console.log("GenerateTablesSkill.provideTools.process called", {
          table_count: tables.length,
        });
        if (!tables.length) return "No tables were provided for generate_tables.";
        const summaryLines = summarizeTables(tables).map((line) => `- ${line}`);
        const warnings = collectTableWarnings(tables);
        const warningLines = warnings.length
          ? ["Warnings:", ...warnings.map((w) => `- ${w}`)]
          : [];
        return [
          `Received ${tables.length} table definition${tables.length === 1 ? "" : "s"}:`,
          ...summaryLines,
          ...warningLines,
        ].join("\n");
      },
      postProcess: async ({ tool_call }) => {
        console.log("GenerateTablesSkill.provideTools.postProcess called", {
          has_input: !!tool_call?.input,
        });
        const payload = payloadFromToolCall(tool_call);
        const tables = payload.tables || [];
        let preview = "";
        try {
          preview = GenerateTables.render_html({ tables });
        } catch (e) {
          preview = `<pre>${JSON.stringify(payload, null, 2)}</pre>`;
        }
        return {
          stop: true,
          add_response: preview,
          add_user_action:
            tables.length > 0
              ? {
                  name: "apply_copilot_tables",
                  type: "button",
                  label: `Create tables (${tables
                    .map((t) => t.table_name)
                    .join(", ")})`,
                  input: { tables },
                }
              : undefined,
        };
      },
      function: {
        name: GenerateTables.function_name,
        description: GenerateTables.description,
        parameters,
      },
    };
  };
}

module.exports = GenerateTablesSkill;
