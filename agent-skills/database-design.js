const GenerateTables = require("../actions/generate-tables");
const Table = require("@saltcorn/data/models/table");

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
    return `${idx + 1}. ${table.table_name || "(missing name)"} \u2013 ${
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
  const existingTablesData = [];
  tables.forEach((table) => {
    const tableName =
      typeof table?.table_name === "string" ? table.table_name.trim() : "";
    const normalized = tableName.toLowerCase();
    if (tableName && existingNames.has(normalized)) {
      skippedExisting.push(tableName);
      existingTablesData.push(table);
      return;
    }
    if (tableName && seenNewNames.has(normalized)) {
      skippedDuplicates.push(tableName);
      return;
    }
    if (tableName) seenNewNames.add(normalized);
    newTables.push(table);
  });
  return { newTables, skippedExisting, skippedDuplicates, existingTablesData };
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

const renderExistingTablesPreview = (existingTablesData) => {
  if (!existingTablesData.length) return "";
  return existingTablesData
    .map((table) => {
      const rows = (table.fields || [])
        .filter((f) => (f?.name || "").toLowerCase() !== "id")
        .map((f) => {
          const cfg = f.type_and_configuration || {};
          const typeParts = [
            cfg.data_type === "ForeignKey"
              ? `ForeignKey \u2192 ${cfg.reference_table || "?"}`
              : cfg.data_type || "Unknown",
          ];
          if (f.calculated) typeParts.push(f.stored ? "stored calc" : "calc");
          return `<tr><td>${f.name || ""}</td><td>${f.label || ""}</td><td>${typeParts.join(" ")}</td><td>${f.expression || ""}</td></tr>`;
        })
        .join("");
      return (
        `<div class="mt-3"><b>Add / update fields on existing table: ` +
        `<code>${table.table_name}</code></b>` +
        `<table class="table table-sm mt-1"><thead><tr>` +
        `<th>Name</th><th>Label</th><th>Type</th><th>Expression</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>`
      );
    })
    .join("");
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
      async apply_copilot_tables({ user, tables, existing_tables }) {
        const notifyParts = [];

        // Create brand-new tables
        if (tables?.length) {
          const { newTables, skippedDuplicates } =
            await partitionTablesByExistence(tables);
          const { validTables, skippedMissingNames, skippedMissingFields } =
            partitionTablesByValidity(newTables);
          if (validTables.length) {
            await GenerateTables.execute({ tables: validTables }, { user });
            notifyParts.push(
              `Created tables: ${validTables.map((t) => t.table_name).join(", ")}`,
            );
          }
          if (skippedDuplicates.length)
            notifyParts.push(
              `Ignored duplicate definitions: ${skippedDuplicates.join(", ")}`,
            );
          if (skippedMissingNames.length)
            notifyParts.push(`Missing table_name: ${skippedMissingNames.join(", ")}`);
          if (skippedMissingFields.length)
            notifyParts.push(
              `Tables without fields: ${skippedMissingFields.join(", ")}`,
            );
        }

        // Add/update fields on existing tables
        if (existing_tables?.length) {
          for (const table of existing_tables) {
            if (!table?.table_name || !Array.isArray(table.fields)) continue;
            const { added, updated } =
              await GenerateTables.execute_add_or_update_fields(
                { table_name: table.table_name, fields: table.fields },
                { user },
              );
            const parts = [];
            if (added.length) parts.push(`added: ${added.join(", ")}`);
            if (updated.length) parts.push(`updated: ${updated.join(", ")}`);
            if (parts.length)
              notifyParts.push(`${table.table_name} \u2014 ${parts.join("; ")}`);
          }
        }

        return {
          notify: notifyParts.length ? notifyParts.join(". ") : "Nothing to apply.",
        };
      },
    };
  }

  provideTools = () => {
    return {
      type: "function",
      process: async (input) => {
        const payload = normalizeTablesPayload(input);
        const tables = payload.tables || [];
        if (!tables.length) {
          return "No tables were provided for generate_tables.";
        }
        const {
          newTables,
          skippedExisting,
          skippedDuplicates,
          existingTablesData,
        } = await partitionTablesByExistence(tables);
        const { validTables, skippedMissingNames, skippedMissingFields } =
          partitionTablesByValidity(newTables);
        const summaryLines = validTables.length
          ? summarizeTables(validTables).map((line) => `- ${line}`)
          : [];
        const existingSummaryLines = existingTablesData.map(
          (t) =>
            `- "${t.table_name}" (exists) \u2014 ${(t.fields || []).length} field(s) will be added/updated`,
        );
        const warnings = collectTableWarnings(
          tables.filter((t) => !skippedExisting.includes(t.table_name)),
        );
        if (skippedDuplicates.length)
          skippedDuplicates.forEach((name) =>
            warnings.push(
              `Table "${name}" was defined multiple times; only the first definition will be used.`,
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
        const newSection = summaryLines.length
          ? [
              `Ready to create ${validTables.length} new table${validTables.length === 1 ? "" : "s"}:`,
              ...summaryLines,
            ]
          : [];
        const existingSection = existingSummaryLines.length
          ? [
              "Existing tables (fields will be added/updated):",
              ...existingSummaryLines,
            ]
          : [];
        const nothingToDo = !newSection.length && !existingSection.length;
        return [
          `Received ${tables.length} table definition${tables.length === 1 ? "" : "s"}.`,
          ...(nothingToDo
            ? ["Nothing to do after filtering."]
            : [...newSection, ...existingSection]),
          ...warningLines,
        ].join("\n");
      },
      postProcess: async ({ tool_call }) => {
        const payload = payloadFromToolCall(tool_call);
        const tables = payload.tables || [];
        const { newTables, skippedDuplicates, existingTablesData } =
          await partitionTablesByExistence(tables);
        const { validTables, skippedMissingNames, skippedMissingFields } =
          partitionTablesByValidity(newTables);
        let preview = "";
        try {
          if (validTables.length) {
            preview = GenerateTables.render_html({ tables: validTables });
          }
        } catch (e) {
          console.log("generate_tables postProcess render failed", {
            e,
            time: new Date(),
          });
          preview = `<pre>${JSON.stringify(payload, null, 2)}</pre>`;
        }
        const existingPreview = renderExistingTablesPreview(existingTablesData);
        const warningChunks = [];
        if (skippedDuplicates.length)
          warningChunks.push(
            `Ignored duplicate definitions: ${skippedDuplicates.join(", ")}`,
          );
        if (skippedMissingNames.length)
          warningChunks.push(`Missing table_name: ${skippedMissingNames.join(", ")}`);
        if (skippedMissingFields.length)
          warningChunks.push(
            `Tables without fields: ${skippedMissingFields.join(", ")}`,
          );
        const warningHtml = warningChunks.length
          ? `<div class="alert alert-warning">${warningChunks.join("<br/>")}</div>`
          : "";
        const hasAnything = validTables.length > 0 || existingTablesData.length > 0;
        const labelParts = [];
        if (validTables.length)
          labelParts.push(
            `Create ${validTables.map((t) => t.table_name).join(", ")}`,
          );
        if (existingTablesData.length)
          labelParts.push(
            `Update fields on ${existingTablesData
              .map((t) => t.table_name)
              .join(", ")}`,
          );
        return {
          stop: true,
          add_response: `${warningHtml}${preview}${existingPreview}`,
          add_user_action: hasAnything
            ? {
                name: "apply_copilot_tables",
                type: "button",
                label: labelParts.join(" + "),
                input: { tables: validTables, existing_tables: existingTablesData },
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
  };
}

module.exports = GenerateTablesSkill;
