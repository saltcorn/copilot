const Table = require("@saltcorn/data/models/table");
const View = require("@saltcorn/data/models/view");
const { fieldProperties } = require("../common");
const {
  initial_config_all_fields,
  build_schema_data,
} = require("@saltcorn/data/plugin-helper");
const { getState } = require("@saltcorn/data/db/state");
const {
  div,
  pre,
  code,
  a,
  text,
  escape,
  iframe,
  text_attr,
} = require("@saltcorn/markup/tags");
const builderGen = require("../builder-gen");
const {
  RELATION_PATH_DOC,
  GET_RELATION_PATHS_FUNCTION,
  getRelationPathsForPairs,
} = require("../relation-paths");

const collectLayoutFieldNames = (segment, out = new Set()) => {
  if (!segment || typeof segment !== "object") return out;
  if (Array.isArray(segment)) {
    segment.forEach((s) => collectLayoutFieldNames(s, out));
    return out;
  }
  if (segment.type === "field" && segment.field_name)
    out.add(segment.field_name);
  if (segment.above) collectLayoutFieldNames(segment.above, out);
  if (segment.besides) collectLayoutFieldNames(segment.besides, out);
  if (segment.contents) collectLayoutFieldNames(segment.contents, out);
  if (Array.isArray(segment.tabs))
    segment.tabs.forEach((t) => collectLayoutFieldNames(t?.contents, out));
  return out;
};

const findFilterFieldSegment = (segment) => {
  if (!segment || typeof segment !== "object") return null;
  if (segment.type === "field") return segment;
  if (segment.type === "dropdown_filter" || segment.type === "toggle_filter") {
    return { field_name: segment.field_name, fieldview: "edit" };
  }
  if (Array.isArray(segment.above)) {
    for (const item of segment.above) {
      const found = findFilterFieldSegment(item);
      if (found) return found;
    }
  }
  if (Array.isArray(segment.besides)) {
    for (const item of segment.besides) {
      const found = findFilterFieldSegment(item);
      if (found) return found;
    }
  }
  if (segment.contents) {
    if (Array.isArray(segment.contents)) {
      for (const item of segment.contents) {
        const found = findFilterFieldSegment(item);
        if (found) return found;
      }
    } else {
      const found = findFilterFieldSegment(segment.contents);
      if (found) return found;
    }
  }
  if (Array.isArray(segment.tabs)) {
    for (const tab of segment.tabs) {
      if (tab?.contents) {
        const found = findFilterFieldSegment(tab.contents);
        if (found) return found;
      }
    }
  }
  if (Array.isArray(segment.contents) && Array.isArray(segment.contents[0])) {
    for (const row of segment.contents) {
      if (Array.isArray(row)) {
        for (const cell of row) {
          const found = findFilterFieldSegment(cell);
          if (found) return found;
        }
      }
    }
  }
  return null;
};

const normalizeFilterField = (segment) => ({
  type: "field",
  field_name: segment.field_name,
  fieldview: segment.fieldview || "edit",
  textStyle: segment.textStyle || "",
  block: segment.block ?? false,
  configuration: segment.configuration || {},
});

const toFilterColumn = (segment) => ({
  type: "Field",
  field_name: segment.field_name,
  fieldview: segment.fieldview || "edit",
  textStyle: segment.textStyle || "",
  block: segment.block ?? false,
  configuration: segment.configuration || {},
});

class GenerateViewSkill {
  static skill_name = "Generate View";

  get skill_label() {
    return "Generate View";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt() {
    return (
      `If the user asks to generate a view, use the generate_view tool — but ONLY if the view does not already exist. ` +
      `If a view with that name already exists, do NOT call generate_view — doing so will create a duplicate. Instead follow the modification sequence below.\n` +
      `The Edit viewtemplate serves both create (no id in state) and edit (id in state) — one view covers both.\n\n` +
      `**Modifying an existing view — required sequence:**\n` +
      `(1) Call get_view_config to fetch the current configuration.\n` +
      `(2) Only if you are adding view_link columns or embedded view (type "view") segments: call get_relation_paths once with all the source_table/target_view pairs you need. For changes that don't involve linking or embedding views (e.g. adding a field, changing a label), skip this step.\n` +
      `(3) Write out the complete updated configuration JSON in full — every key from the existing config must be present, with only your targeted changes merged in.\n` +
      `(4) Call apply_view_config with that complete object. NEVER call apply_view_config before step (3) is finished. NEVER call it with only the name or a partial object — the configuration field is mandatory and must be the full merged result from step (3). Calling apply_view_config without a complete configuration is an error.\n\n` +
      `**Generating a new view that contains view_links or embedded views:**\n` +
      `Call get_relation_paths once with all source_table/target_view pairs you need before constructing the layout.\n\n` +
      `**Embedded view segment format (for Show layouts):**\n` +
      `  { "type": "view", "view": "<viewName>", "name": "<viewName>", "relation": "<from get_relation_paths>" }\n` +
      `Do NOT use blank text segments as placeholders — always use a real view segment with a relation string from get_relation_paths.\n\n` +
      RELATION_PATH_DOC
    );
  }

  get userActions() {
    return {
      async build_copilot_view_update({ name, configuration }) {
        const existingView = View.findOne({ name });
        if (!existingView) return { error: `View "${name}" not found` };
        await View.update({ configuration }, existingView.id);
        setTimeout(() => getState().refresh_views(), 200);
        return {
          notify: `View updated: <a target="_blank" href="/view/${name}">${name}</a>`,
        };
      },
      async build_copilot_view_gen({
        wfctx,
        name,
        viewpattern,
        table,
        min_role,
      }) {
        const existing = View.findOne({ name });
        if (existing)
          return {
            error: `View "${name}" already exists. Use get_view_config and apply_view_config to update it.`,
          };
        const tableRow = table ? Table.findOne({ name: table }) : null;
        const roleName = typeof min_role === "number" ? null : (min_role || "public");
        const resolvedRole =
          typeof min_role === "number"
            ? min_role
            : ((getState().roles || []).find((r) => r.role === roleName) || { id: 100 }).id;
        await View.create({
          name,
          viewtemplate: viewpattern,
          table_id: tableRow?.id,
          table: tableRow,
          min_role: resolvedRole,
          configuration: wfctx,
        });
        const vt = getState().viewtemplates[viewpattern];
        if (vt?.copilot_post_create) {
          await vt.copilot_post_create({ name, configuration: wfctx });
        }
        setTimeout(() => getState().refresh_views(), 200);
        return {
          notify: `View saved: <a target="_blank" href="/view/${name}">${name}</a>`,
        };
      },
    };
  }

  provideTools = () => {
    const state = getState();
    const vts = state.viewtemplates;
    const tables = state.tables;
    const all_vt_names = Object.keys(vts);
    const enabled_vt_names = all_vt_names.filter(
      (vtnm) =>
        vts[vtnm].enable_copilot_viewgen ||
        vts[vtnm].copilot_generate_view_prompt
    );
    if (!enabled_vt_names.includes("Show")) enabled_vt_names.push("Show");
    if (!enabled_vt_names.includes("Edit")) enabled_vt_names.push("Edit");
    if (!enabled_vt_names.includes("List")) enabled_vt_names.push("List");
    if (!enabled_vt_names.includes("Filter")) enabled_vt_names.push("Filter");
    //const roles = await User.get_roles();
    const tableless = enabled_vt_names.filter(
      (vtnm) => vts[vtnm].tableless === true
    );
    const roles = state.roles;
    const parameters = {
      type: "object",
      required: ["name", "viewpattern"],
      properties: {
        name: {
          description: `The name of the view, this should be a short name which is part of the url. `,
          type: "string",
        },
        viewpattern: {
          description: `The type of view to generate. Some of the view descriptions: ${enabled_vt_names
            .map((vtnm) => `${vtnm}: ${vts[vtnm].description}.`)
            .join(" ")}`,
          type: "string",
          enum: enabled_vt_names,
        },
        table: {
          description:
            "Which table is this a view on. These viewpatterns are tablesless, do not supply a tablename: " +
            tableless.join(", "),
          type: "string",
          enum: tables.map((t) => t.name),
        },
        min_role: {
          description:
            "The minimum role needed to access the view. For views accessible only by admin, use 'admin', pages with min_role 'public' is publicly accessible and also available to all users",
          type: "string",
          enum: roles ? roles.map((r) => r.role) : ["admin", "user", "public"],
        },
      },
    };

    const generateViewTool = {
      type: "function",
      function: {
        name: "generate_view",
        description:
          "Generate a NEW view by supplying high-level details. Only call this for views that do not yet exist — if the view already exists, use get_view_config + apply_view_config instead.",
        parameters,
      },
      process: async (input) => {
        return "Metadata received";
      },
      postProcess: async ({ tool_call, req, generate, chat }) => {
        const state = getState();
        const vt = state.viewtemplates[tool_call.input.viewpattern];
        const table =
          vt.tableless === true
            ? null
            : Table.findOne({ name: tool_call.input.table });

        const wfctx = { viewname: tool_call.input.name, table_id: table?.id };
        const viewpattern = tool_call.input.viewpattern;
        const builderModeByPattern = {
          Show: "show",
          Edit: "edit",
          List: "listcolumns",
          Filter: "filter",
        };
        const builderMode = builderModeByPattern[viewpattern];
        if (builderMode) {
          const extractText = (c) => {
            if (typeof c === "string") return c;
            if (Array.isArray(c)) {
              const textPart = c.find(
                (p) => p?.type === "text" || typeof p === "string"
              );
              return (
                textPart?.text || (typeof textPart === "string" ? textPart : "")
              );
            }
            return "";
          };
          const isToolResultMessage = (item) => {
            if (!Array.isArray(item?.content)) return false;
            return item.content.every((p) => p?.type === "tool_result");
          };
          const promptFromChat = Array.isArray(chat)
            ? (() => {
                const userMsgs = chat.filter(
                  (item) =>
                    item?.role === "user" &&
                    item?.content &&
                    !isToolResultMessage(item)
                );
                return userMsgs.length ? extractText(userMsgs[0].content) : "";
              })()
            : "";
          const layoutPrompt = promptFromChat || tool_call.input.name || "";
          wfctx.layout = await builderGen.run(
            layoutPrompt,
            builderMode,
            table?.name,
            null,
            chat
          );
          if (table && viewpattern !== "Filter") {
            // isEdit=true: FK fields get Field+select columns; false gives JoinField (display-only)
            const isEditView = viewpattern === "Edit";
            const baseCfg = await initial_config_all_fields(isEditView)({
              table_id: table.id,
            });
            if (baseCfg?.columns) wfctx.columns = baseCfg.columns;
          }
          if (viewpattern === "Edit" && table) {
            const layoutFieldNames = collectLayoutFieldNames(wfctx.layout);
            const fields = table.fields || [];
            const fixed = {};
            const usersFkColumnsToAdd = [];
            for (const f of fields) {
              if (f.primary_key || f.calculated) continue;
              if (f.type === "Key" && f.reftable_name === "users") {
                if (layoutFieldNames.has(f.name)) {
                  // Explicitly placed in layout — add a select column so getForm renders it
                  usersFkColumnsToAdd.push({
                    field_name: f.name,
                    type: "Field",
                    fieldview: "select",
                    state_field: true,
                  });
                } else {
                  fixed[`preset_${f.name}`] = "LoggedIn";
                  fixed[`_block_${f.name}`] = true;
                }
              }
            }
            if (usersFkColumnsToAdd.length > 0)
              wfctx.columns = [...(wfctx.columns || []), ...usersFkColumnsToAdd];
            if (Object.keys(fixed).length > 0) wfctx.fixed = fixed;
            wfctx.destination_type = "Back to referer";
          }
          if (viewpattern === "Filter") {
            const filterFieldSegment = findFilterFieldSegment(wfctx.layout);
            if (filterFieldSegment) {
              const normalized = normalizeFilterField(filterFieldSegment);
              wfctx.layout = normalized;
              wfctx.columns = [toFilterColumn(normalized)];
            }
          }
        }

        if (
          viewpattern === "Show" ||
          viewpattern === "Edit" ||
          viewpattern === "Filter"
        ) {
          // No extra configuration steps for these modes.
        } else {
          const flow = vt.configuration_workflow(req);
          let vt_prompt = "";
          if (vt.copilot_generate_view_prompt) {
            if (typeof vt.copilot_generate_view_prompt === "string")
              vt_prompt = vt.copilot_generate_view_prompt;
            else if (typeof vt.copilot_generate_view_prompt === "function")
              vt_prompt = await vt.copilot_generate_view_prompt(
                tool_call.input
              );
          }

          const prefilledFields = new Set();
          if (wfctx.layout !== undefined) prefilledFields.add("layout");
          if (wfctx.columns !== undefined) prefilledFields.add("columns");

          // For List views: pre-fill view_to_create with the best Edit view for the table
          if (viewpattern === "List" && table) {
            const candidateViews = await View.find_table_views_where(
              table.id,
              ({ state_fields, viewrow }) =>
                viewrow.name !== tool_call.input.name &&
                state_fields.every((sf) => !sf.required)
            );
            if (candidateViews.length > 0) {
              const editView =
                candidateViews.find((v) =>
                  v.name.toLowerCase().includes("edit")
                ) || candidateViews[0];
              wfctx.view_to_create =
                editView.select_option?.name || editView.name;
              wfctx.create_view_display = "Popup";
              wfctx.create_view_location = "Top right";
              prefilledFields.add("view_to_create");
              prefilledFields.add("create_view_display");
              prefilledFields.add("create_view_location");
            }
          }

          for (const step of flow.steps) {
            if (typeof step.form !== "function") continue;
            const form = await step.form(wfctx);
            const properties = {};
            //TODO onlyWhen
            for (const field of form.fields) {
              if (prefilledFields.has(field.name)) continue;
              //TODO showIf
              properties[field.name] = {
                description:
                  field.copilot_description ||
                  `${field.label}.${
                    field.sublabel ? ` ${field.sublabel}` : ""
                  }`,
                ...fieldProperties(field),
              };
              if (!properties[field.name].type) {
                properties[field.name].type = "string";
              }
            }

            if (!Object.keys(properties).length) continue;

            const answer = await generate(
              `${vt_prompt ? vt_prompt + "\n\n" : ""}Now generate the ${
                step.name
              } details of the view by calling the generate_view_details tool`,
              {
                tools: [
                  {
                    type: "function",
                    function: {
                      name: "generate_view_details",
                      description: "Provide view details",
                      parameters: {
                        type: "object",
                        properties,
                      },
                    },
                  },
                ],
                tool_choice: {
                  type: "function",
                  function: {
                    name: "generate_view_details",
                  },
                },
              }
            );
            const tc =
              typeof answer?.getToolCalls === "function"
                ? answer.getToolCalls()[0]
                : null;
            if (tc) {
              await getState().functions.llm_add_message.run(
                "tool_response",
                { type: "text", value: "Details provided" },
                { chat, tool_call: tc }
              );
              Object.assign(wfctx, tc.input);
            }
          }
        }
        const roleName = tool_call.input.min_role || "public";
        const rolesState = getState().roles;
        const min_role = rolesState
          ? (rolesState.find((r) => r.role === roleName) || { id: 100 }).id
          : { admin: 1, public: 100, user: 80 }[roleName] ?? 100;
        const existingView = View.findOne({ name: tool_call.input.name });
        if (existingView) {
          return {
            stop: true,
            add_response: `Error: view "${tool_call.input.name}" already exists. Do NOT call generate_view again — use get_view_config to inspect the current configuration and apply_view_config to update it.`,
          };
        }
        const view = new View({
          name: tool_call.input.name,
          viewtemplate: tool_call.input.viewpattern,
          table,
          table_id: table?.id,
          min_role,
          configuration: wfctx,
        });
        if (this.yoloMode) {
          await this.userActions.build_copilot_view_gen({
            wfctx,
            name: tool_call.input.name,
            viewpattern: tool_call.input.viewpattern,
            table: tool_call.input.table,
            min_role: tool_call.input.min_role,
          });
          return {
            stop: true,
            add_response: `View ${tool_call.input.name} created.`,
          };
        }
        const runres = await view.run({}, { req });
        return {
          stop: true,
          add_response:
            pre(JSON.stringify(wfctx, null, 2)) +
            div(
              { style: { maxHeight: 800, maxWidth: 500, overflow: "scroll" } },
              runres
            ),
          add_user_action: {
            name: "build_copilot_view_gen",
            type: "button",
            label: "Save view " + tool_call.input.name,
            input: { wfctx, ...tool_call.input },
          },
        };
      },
    };

    const getViewConfigTool = {
      type: "function",
      function: {
        name: "get_view_config",
        description:
          "Retrieve the current configuration of an existing view. " +
          "Call this first to inspect the layout before calling apply_view_config to save changes. " +
          "Returns the full configuration JSON and the viewtemplate name.",
        parameters: {
          type: "object",
          required: ["name"],
          properties: {
            name: {
              description: "The name of the existing view to inspect.",
              type: "string",
            },
          },
        },
      },
      process: async ({ name }) => {
        const existingView = View.findOne({ name });
        if (!existingView)
          return `View "${name}" not found. Use generate_view to create a new view instead.`;
        return (
          `Current configuration of view "${name}" (viewtemplate: ${existingView.viewtemplate}):\n` +
          JSON.stringify(existingView.configuration, null, 2)
        );
      },
    };

    const applyViewConfigTool = {
      type: "function",
      function: {
        name: "apply_view_config",
        description:
          "Save an updated configuration to an existing view. " +
          "STRICT PRECONDITION: you must have already called get_view_config AND written out the complete merged configuration JSON before calling this tool. " +
          "Do NOT call this tool as a placeholder or before the configuration is fully constructed. " +
          "Calling this tool without a complete configuration object is always wrong and will fail.",
        parameters: {
          type: "object",
          required: ["name", "configuration"],
          properties: {
            name: {
              description: "The name of the existing view to update.",
              type: "string",
            },
            configuration: {
              type: "object",
              description:
                "REQUIRED. The complete updated configuration object — every key from the existing config preserved, with only your changes merged in. " +
                "You MUST have the full object written out before calling this tool. " +
                "Passing null, an empty object, or a partial object (e.g. only the name) is always wrong and will return an error.",
            },
          },
        },
      },
      process: async ({ name, configuration }) => {
        const existingView = View.findOne({ name });
        if (!existingView) return `View "${name}" not found.`;
        if (!configuration || typeof configuration !== "object")
          return (
            `ERROR: configuration is missing. ` +
            `You must call get_view_config first, merge your changes into the full existing configuration, then call apply_view_config again with the complete configuration object.`
          );
        return { name, configuration, view_id: existingView.id };
      },
      postProcess: async ({ tool_call, req }) => {
        const { name, configuration } = tool_call.input;
        const existingView = View.findOne({ name });
        if (!existingView)
          return { stop: true, add_response: `View "${name}" not found.` };
        if (!configuration || typeof configuration !== "object")
          return {
            stop: true,
            add_response:
              `apply_view_config called for "${name}" without a configuration object. ` +
              `Call get_view_config first, merge your changes into the full existing configuration, then call apply_view_config again with the complete configuration.`,
          };
        const cfg = configuration;

        if (this.yoloMode) {
          await View.update({ configuration: cfg }, existingView.id);
          setTimeout(() => getState().refresh_views(), 200);
          return { stop: true, add_response: `View ${name} updated.` };
        }
        return {
          stop: true,
          add_response: pre(JSON.stringify(cfg, null, 2)),
          add_user_action: {
            name: "build_copilot_view_update",
            type: "button",
            label: "Save updated view " + name,
            input: { name, configuration: cfg },
          },
        };
      },
    };

    const getRelationPathsTool = {
      type: "function",
      function: GET_RELATION_PATHS_FUNCTION,
      process: async ({ pairs }) => {
        const schemaData = await build_schema_data();
        const sections = getRelationPathsForPairs(pairs || [], schemaData);
        return (
          sections.join("\n\n") +
          `\n\nFor each pair, set the "relation" property to one of the strings listed above.\n` +
          `Pick by type: ChildList = multiple child rows, ParentShow = single parent, OneToOneShow = unique child. ` +
          `If multiple paths of the same type exist, choose the one whose FK field name best matches the task. Prefer shorter paths.`
        );
      },
    };

    return [
      generateViewTool,
      getViewConfigTool,
      applyViewConfigTool,
      getRelationPathsTool,
    ];
  };
}

module.exports = GenerateViewSkill;
