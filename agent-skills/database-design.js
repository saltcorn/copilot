const GenerateTables = require("../actions/generate-tables");
const Table = require("@saltcorn/data/models/table");
const Field = require("@saltcorn/data/models/field");

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
          `${tableLabel}.${fieldLabel} must include type_and_configuration.data_type.`,
        );

      if ((field?.name || "").toLowerCase() === "id")
        warnings.push(
          `${tableLabel}.${fieldLabel} should be omitted because every table already has an auto-increment id.`,
        );
    });
  });
  return warnings;
};

const fetchExistingFieldNamesForTable = async (tableName) => {
  const table = Table.findOne({ name: tableName });
  if (!table) return null;
  const names = new Set();
  (table.fields || []).forEach((f) => {
    if (f?.name) names.add(f.name.toLowerCase());
  });
  return names;
};

const partitionFieldsByValidity = (fields = []) => {
  const validFields = [];
  const skippedMissingNames = [];
  const seenNames = new Set();
  const skippedDuplicates = [];
  fields.forEach((field, idx) => {
    const rawName =
      typeof field?.name === "string" ? field.name.trim() : "";
    const fallbackLabel = rawName || `Field #${idx + 1}`;
    if (!rawName) {
      skippedMissingNames.push(fallbackLabel);
      return;
    }
    if (seenNames.has(rawName.toLowerCase())) {
      skippedDuplicates.push(rawName);
      return;
    }
    seenNames.add(rawName.toLowerCase());
    validFields.push(field);
  });
  return { validFields, skippedMissingNames, skippedDuplicates };
};

const fetchExistingTableNameSet = async () => {
  const existingTables = await Table.find({});
  const names = new Set();
  existingTables.forEach((table) => {
    if (table?.name) names.add(table.name.toLowerCase());
  });
  return names;
};

const partitionTablesByExistence = async (tables = []) => {
  const existingNames = await fetchExistingTableNameSet();
  const seenNewNames = new Set();
  const newTables = [];
  const skippedExisting = [];
  const skippedDuplicates = [];
  tables.forEach((table) => {
    const tableName =
      typeof table?.table_name === "string" ? table.table_name.trim() : "";
    const normalized = tableName.toLowerCase();
    if (tableName && existingNames.has(normalized)) {
      skippedExisting.push(tableName);
      return;
    }
    if (tableName && seenNewNames.has(normalized)) {
      skippedDuplicates.push(tableName);
      return;
    }
    if (tableName) seenNewNames.add(normalized);
    newTables.push(table);
  });
  return { newTables, skippedExisting, skippedDuplicates };
};

const partitionTablesByValidity = (tables = []) => {
  const validTables = [];
  const skippedMissingNames = [];
  const skippedMissingFields = [];
  tables.forEach((table, idx) => {
    const rawName =
      typeof table?.table_name === "string" ? table.table_name.trim() : "";
    const fallbackLabel = rawName || `Table #${idx + 1}`;
    if (!rawName) {
      skippedMissingNames.push(fallbackLabel);
      return;
    }
    const fields = Array.isArray(table?.fields) ? table.fields : [];
    if (!fields.length) {
      skippedMissingFields.push(rawName);
      return;
    }
    validTables.push({ ...table, table_name: rawName, fields });
  });
  return { validTables, skippedMissingNames, skippedMissingFields };
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
    Object.assign(this, cfg);
  }

  async systemPrompt() {
    return await GenerateTables.system_prompt();
  }

  get userActions() {
    return {
      async apply_copilot_add_fields({ user, table_name, fields }) {
        if (!table_name || !fields?.length)
          return { notify: "Nothing to add." };
        const existingNames = await fetchExistingFieldNamesForTable(table_name);
        if (!existingNames)
          return { notify: `Table "${table_name}" not found.` };
        const newFields = fields.filter(
          (f) => f?.name && !existingNames.has(f.name.toLowerCase())
        );
        if (!newFields.length)
          return { notify: "All fields already exist in the table." };
        await GenerateTables.execute_add_fields(
          { table_name, fields: newFields },
          { user }
        );
        return {
          notify: `Added fields to ${table_name}: ${newFields
            .map((f) => f.name)
            .join(", ")}`,
        };
      },
      async apply_copilot_tables({ user, tables }) {
        if (!tables?.length) return { notify: "Nothing to create." };
        const { newTables, skippedExisting, skippedDuplicates } =
          await partitionTablesByExistence(tables);
        const { validTables, skippedMissingNames, skippedMissingFields } =
          partitionTablesByValidity(newTables);
        if (!validTables.length) {
          const skippedMessages = [];
          if (skippedExisting.length)
            skippedMessages.push(
              `Existing tables: ${skippedExisting.join(", ")}`,
            );
          if (skippedDuplicates.length)
            skippedMessages.push(
              `Duplicate definitions: ${skippedDuplicates.join(", ")}`,
            );
          if (skippedMissingNames.length)
            skippedMessages.push(
              `Missing table_name: ${skippedMissingNames.join(", ")}`,
            );
          if (skippedMissingFields.length)
            skippedMessages.push(
              `Tables without fields: ${skippedMissingFields.join(", ")}`,
            );
          return {
            notify:
              skippedMessages.length > 0
                ? `Nothing to create. Skipped ${skippedMessages.join("; ")}.`
                : "Nothing to create.",
          };
        }
        await GenerateTables.execute({ tables: validTables }, { user });
        const createdNames = validTables.map((t) => t.table_name).join(", ");
        const skippedMessages = [];
        if (skippedExisting.length)
          skippedMessages.push(
            `Skipped existing tables: ${skippedExisting.join(", ")}`,
          );
        if (skippedDuplicates.length)
          skippedMessages.push(
            `Ignored duplicate definitions: ${skippedDuplicates.join(", ")}`,
          );
        if (skippedMissingNames.length)
          skippedMessages.push(
            `Missing table_name: ${skippedMissingNames.join(", ")}`,
          );
        if (skippedMissingFields.length)
          skippedMessages.push(
            `Tables without fields: ${skippedMissingFields.join(", ")}`,
          );
        return {
          notify: [`Created tables: ${createdNames}`, ...skippedMessages].join(
            ". ",
          ),
        };
      },
    };
  }

  provideTools = () => {
    const generateTablesTool = {
      type: "function",
      process: async (input) => {
        const payload = normalizeTablesPayload(input);
        const tables = payload.tables || [];
        if (!tables.length) {
          return "No tables were provided for generate_tables.";
        }
        const { newTables, skippedExisting, skippedDuplicates } =
          await partitionTablesByExistence(tables);
        const { validTables, skippedMissingNames, skippedMissingFields } =
          partitionTablesByValidity(newTables);
        const summaryLines = validTables.length
          ? summarizeTables(validTables).map((line) => `- ${line}`)
          : [];
        const warnings = collectTableWarnings(tables);
        if (skippedExisting.length)
          skippedExisting.forEach((name) =>
            warnings.push(
              `Table "${name}" already exists and will not be recreated by generate_tables.`,
            ),
          );
        if (skippedDuplicates.length)
          skippedDuplicates.forEach((name) =>
            warnings.push(
              `Table "${name}" was defined multiple times in this request; only the first definition will be used.`,
            ),
          );
        skippedMissingNames.forEach((label) =>
          warnings.push(
            `${label} is skipped because it does not include a table_name.`,
          ),
        );
        skippedMissingFields.forEach((label) =>
          warnings.push(
            `Table "${label}" is skipped because it does not define any fields.`,
          ),
        );
        const warningLines = warnings.length
          ? ["Warnings:", ...warnings.map((w) => `- ${w}`)]
          : [];
        const summarySection = summaryLines.length
          ? [
              `Ready to create ${validTables.length} new table${
                validTables.length === 1 ? "" : "s"
              }:`,
              ...summaryLines,
            ]
          : [
              "No new tables remain after removing existing, duplicate, or invalid table definitions.",
            ];
        return [
          `Received ${tables.length} table definition${tables.length === 1 ? "" : "s"}.`,
          ...summarySection,
          ...warningLines,
        ].join("\n");
      },
      postProcess: async ({ tool_call }) => {
        const payload = payloadFromToolCall(tool_call);
        const tables = payload.tables || [];
        const { newTables, skippedExisting, skippedDuplicates } =
          await partitionTablesByExistence(tables);
        const { validTables, skippedMissingNames, skippedMissingFields } =
          partitionTablesByValidity(newTables);
        let preview = "";
        try {
          if (validTables.length) {
            preview = GenerateTables.render_html({ tables: validTables });
          } else {
            preview =
              '<div class="alert alert-info">No new tables to preview because every provided table already exists or was invalid.</div>';
          }
        } catch (e) {
          console.log("We are in postProcess but rendering failed", {
            e,
            time: new Date(),
          });
          preview = `<pre>${JSON.stringify(payload, null, 2)}</pre>`;
        }
        const warningChunks = [];
        if (skippedExisting.length)
          warningChunks.push(
            `Skipped existing tables: ${skippedExisting.join(", ")}`,
          );
        if (skippedDuplicates.length)
          warningChunks.push(
            `Ignored duplicate definitions: ${skippedDuplicates.join(", ")}`,
          );
        if (skippedMissingNames.length)
          warningChunks.push(
            `Missing table_name: ${skippedMissingNames.join(", ")}`,
          );
        if (skippedMissingFields.length)
          warningChunks.push(
            `Tables without fields: ${skippedMissingFields.join(", ")}`,
          );
        const warningHtml = warningChunks.length
          ? `<div class="alert alert-warning">${warningChunks.join("<br/>")}</div>`
          : "";
        return {
          stop: true,
          add_response: `${warningHtml}${preview}`,
          add_user_action:
            validTables.length > 0
              ? {
                  name: "apply_copilot_tables",
                  type: "button",
                  label: `Create tables (${validTables
                    .map((t) => t.table_name)
                    .join(", ")})`,
                  input: { tables: validTables },
                }
              : undefined,
        };
      },
      function: {
        name: GenerateTables.function_name,
        description: GenerateTables.description,
        parameters: GenerateTables.json_schema(),
      },
    };

    const addFieldsTool = {
      type: "function",
      process: async (input) => {
        const table_name =
          typeof input?.table_name === "string" ? input.table_name.trim() : "";
        const fields = Array.isArray(input?.fields) ? input.fields : [];
        if (!table_name) return "add_fields_to_table: table_name is required.";
        const existingNames = await fetchExistingFieldNamesForTable(table_name);
        if (!existingNames)
          return `add_fields_to_table: table "${table_name}" does not exist. Use generate_tables to create it first.`;
        const { validFields, skippedMissingNames, skippedDuplicates } =
          partitionFieldsByValidity(fields);
        const newFields = validFields.filter(
          (f) => !existingNames.has(f.name.toLowerCase())
        );
        const skippedExistingFields = validFields
          .filter((f) => existingNames.has(f.name.toLowerCase()))
          .map((f) => f.name);
        const warnings = [];
        if (skippedExistingFields.length)
          warnings.push(
            `Fields already in table: ${skippedExistingFields.join(", ")}`,
          );
        if (skippedMissingNames.length)
          warnings.push(`Fields missing name: ${skippedMissingNames.join(", ")}`);
        if (skippedDuplicates.length)
          warnings.push(`Duplicate field names: ${skippedDuplicates.join(", ")}`);
        const summarySection = newFields.length
          ? [`Ready to add ${newFields.length} field(s) to "${table_name}":`,
             ...newFields.map((f) => `- ${f.name} (${f.type_and_configuration?.data_type || "Unknown"}${f.calculated ? ", calculated" : ""})`)]
          : [`No new fields to add to "${table_name}".`];
        return [
          ...summarySection,
          ...(warnings.length ? ["Warnings:", ...warnings.map((w) => `- ${w}`)] : []),
        ].join("\n");
      },
      postProcess: async ({ tool_call }) => {
        const input = tool_call?.input || tool_call?.function?.arguments || {};
        const parsed = typeof input === "string" ? (() => { try { return JSON.parse(input); } catch { return {}; } })() : input;
        const table_name =
          typeof parsed?.table_name === "string" ? parsed.table_name.trim() : "";
        const fields = Array.isArray(parsed?.fields) ? parsed.fields : [];
        const existingNames = table_name
          ? await fetchExistingFieldNamesForTable(table_name)
          : null;
        const { validFields } = partitionFieldsByValidity(fields);
        const newFields = existingNames
          ? validFields.filter((f) => !existingNames.has(f.name.toLowerCase()))
          : validFields;
        let preview = "";
        try {
          if (table_name && newFields.length) {
            preview = GenerateTables.render_add_fields_html({
              table_name,
              fields: newFields,
            });
          } else if (!existingNames) {
            preview = `<div class="alert alert-danger">Table "${table_name}" does not exist.</div>`;
          } else {
            preview = `<div class="alert alert-info">No new fields to add to "${table_name}".</div>`;
          }
        } catch (e) {
          console.log("add_fields_to_table postProcess render failed", { e });
          preview = `<pre>${JSON.stringify(parsed, null, 2)}</pre>`;
        }
        return {
          stop: true,
          add_response: preview,
          add_user_action:
            table_name && newFields.length > 0
              ? {
                  name: "apply_copilot_add_fields",
                  type: "button",
                  label: `Add ${newFields.length} field(s) to ${table_name}`,
                  input: { table_name, fields: newFields },
                }
              : undefined,
        };
      },
      function: {
        name: "add_fields_to_table",
        description:
          "Add one or more fields to an existing database table. Use this instead of generate_tables when the table already exists.",
        parameters: GenerateTables.add_fields_json_schema(),
      },
    };

    return [generateTablesTool, addFieldsTool];
  };
}

module.exports = GenerateTablesSkill;
