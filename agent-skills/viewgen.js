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
  a,
  text,
  escape,
  iframe,
  text_attr,
} = require("@saltcorn/markup/tags");
const builderGen = require("../builder-gen");
const { SHOW_LAYOUT_GUIDANCE } = require("../view-layout-guidance");
const {
  renderGeneratedViewConfiguration,
} = require("./generated-view-preview");
const {
  GET_RELATION_PATHS_FUNCTION,
  getRelationPathsForPairs,
} = require("../relation-paths");

// Single walk of a layout tree that collects view_link/action segments and field names at once.
const collectLayoutSegments = (
  segment,
  out = { viewLinks: [], actions: [], fieldNames: new Set() }
) => {
  if (!segment || typeof segment !== "object") return out;
  if (Array.isArray(segment)) {
    segment.forEach((s) => collectLayoutSegments(s, out));
    return out;
  }
  if (segment.type === "view_link" && segment.view) out.viewLinks.push(segment);
  if (segment.type === "action" && segment.action_name)
    out.actions.push(segment);
  if (segment.type === "field" && segment.field_name)
    out.fieldNames.add(segment.field_name);
  if (segment.above) collectLayoutSegments(segment.above, out);
  if (segment.besides) collectLayoutSegments(segment.besides, out);
  if (segment.contents) collectLayoutSegments(segment.contents, out);
  if (Array.isArray(segment.tabs))
    segment.tabs.forEach((t) => collectLayoutSegments(t?.contents, out));
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

// Guards against tool_call.input arriving as a raw string instead of parsed JSON.
const asPlainObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed;
    } catch (_) {
      // fall through
    }
  }
  return null;
};

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
      `If the user asks to generate a view, use the generate_view tool — but ` +
      `ONLY if the view does not already exist. If a view with that name ` +
      `already exists, do NOT call generate_view — doing so will create a ` +
      `duplicate. Instead follow the modification sequence below.\n` +
      `The Edit viewtemplate serves both create (no id in state) and edit ` +
      `(id in state) — one view covers both.\n\n` +
      `**Modifying an existing view — required sequence:**\n` +
      `(1) Call get_view_config to fetch the current configuration.\n` +
      `(2) Only if you are adding view_link columns or embedded view (type ` +
      `"view") segments: call get_relation_paths once with all the ` +
      `source_table/target_view pairs you need. For changes that don't ` +
      `involve linking or embedding views (e.g. adding a field, changing a ` +
      `label), skip this step.\n` +
      `(3) Write out the complete updated configuration JSON in full — every ` +
      `key from the existing config must be present, with only your ` +
      `targeted changes merged in.\n` +
      `(4) Call apply_view_config with that complete object. NEVER call ` +
      `apply_view_config before step (3) is finished. NEVER call it with ` +
      `only the name or a partial object — the configuration field is ` +
      `mandatory and must be the full merged result from step (3). Calling ` +
      `apply_view_config without a complete configuration is an error.\n\n` +
      SHOW_LAYOUT_GUIDANCE +
      `\n\n**Generating a new view that contains view_links or embedded views:**\n` +
      `If the task or prompt mentions a viewlink, a link to another view, or ` +
      `a button that opens another view from a list row, that view_link ` +
      `column is REQUIRED — do not omit it. You MUST call get_relation_paths ` +
      `with all source_table/target_view pairs before constructing the ` +
      `layout. Never skip this step when view_links are needed.\n\n` +
      `**Embedded view segment format (for Show layouts):**\n` +
      `  { "type": "view", "view": "<viewName>", "name": "<viewName>", ` +
      `"relation": "<from get_relation_paths>" }\n` +
      `Do NOT use blank text segments as placeholders — always use a real ` +
      `view segment with a relation string from get_relation_paths.\n\n` +
      `Relation strings always use the dot-separated path format (e.g. ` +
      `".trips.packing_items$trip_id") returned by get_relation_paths — use ` +
      `them verbatim, never construct your own. If an existing configuration ` +
      `you are editing contains an old colon-based relation format (e.g. ` +
      `"ChildList:view.table.field"), that is legacy — call get_relation_paths ` +
      `and rewrite it in the new format rather than preserving it.`
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
        const roleName =
          typeof min_role === "number" ? null : min_role || "public";
        const resolvedRole =
          typeof min_role === "number"
            ? min_role
            : (
                (getState().roles || []).find((r) => r.role === roleName) || {
                  id: 100,
                }
              ).id;
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
        const roleName = tool_call.input.min_role || "public";
        const rolesState = getState().roles;
        const min_role = rolesState
          ? (rolesState.find((r) => r.role === roleName) || { id: 100 }).id
          : { admin: 1, public: 100, user: 80 }[roleName] ?? 100;

        // Lets a viewtemplate's own step.form(context) tell an AI-driven call apart from a
        // real user filling in the wizard (e.g. to offer a blank option only for the former).
        const wfctx = {
          viewname: tool_call.input.name,
          table_id: table?.id,
          copilot_call: true,
        };
        const viewpattern = tool_call.input.viewpattern;
        const builderModeByPattern = {
          Show: "show",
          Edit: "edit",
          List: "listcolumns",
          Filter: "filter",
        };
        const builderMode = builderModeByPattern[viewpattern];
        // Hoisted so the wizard-step loop below can restate the task instead of relying on chat recall.
        const layoutPrompt = builderGen.extractLayoutPromptFromChat(
          chat,
          tool_call.input.name || ""
        );
        if (builderMode) {
          // Lets a viewtemplate require specific layout content (e.g. List needs a
          // viewlink/delete segment) without hardcoding that knowledge in the constructor.
          const layoutRule =
            typeof vt.copilot_layout_rule === "function"
              ? await vt.copilot_layout_rule(tool_call.input)
              : vt.copilot_layout_rule;
          wfctx.layout = await builderGen.run(
            layoutRule ? `${layoutRule}\n\n${layoutPrompt}` : layoutPrompt,
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
          if (viewpattern === "List" && wfctx.layout) {
            // initial_config_all_fields never generates ViewLink columns — inject them from layout
            const { viewLinks, actions } = collectLayoutSegments(wfctx.layout);
            const viewLinkColumns = viewLinks.map((seg) => ({
              type: "ViewLink",
              view: seg.view,
              block: seg.block || false,
              label: seg.view_label || "",
              // Never more permissive than the list itself by default - a missing minRole
              // on the segment must not silently make it public.
              minRole: seg.minRole || min_role,
              ...(seg.relation ? { relation: seg.relation } : {}),
              isFormula: seg.isFormula || {},
            }));
            if (viewLinkColumns.length > 0)
              wfctx.columns = [...(wfctx.columns || []), ...viewLinkColumns];
            // Same as above for Action columns - without this, buttons render but crash on click.
            const actionColumns = actions.map((seg) => ({
              type: "Action",
              action_name: seg.action_name,
              action_label: seg.action_label || "",
              action_style: seg.action_style || "btn-primary",
              rndid: seg.rndid,
              minRole: seg.minRole || min_role,
              nsteps: seg.nsteps || 1,
              isFormula: seg.isFormula || {},
              configuration: seg.configuration || {},
              ...(seg.confirm ? { confirm: seg.confirm } : {}),
            }));
            if (actionColumns.length > 0)
              wfctx.columns = [...(wfctx.columns || []), ...actionColumns];
          }
          if (viewpattern === "Edit" && table) {
            const { fieldNames: layoutFieldNames } = collectLayoutSegments(
              wfctx.layout
            );
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
              wfctx.columns = [
                ...(wfctx.columns || []),
                ...usersFkColumnsToAdd,
              ];
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

          // For List views: pre-fill view_to_create with the best Edit view for the table -
          // only one at least as accessible as this List, or a user could see the "Create
          // new row" link/button but be denied when they open it.
          if (viewpattern === "List" && table) {
            const candidateViews = await View.find_table_views_where(
              table.id,
              ({ state_fields, viewrow }) =>
                viewrow.name !== tool_call.input.name &&
                viewrow.min_role >= min_role &&
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

          // One LLM round-trip for all steps, not one per step.
          const stepNames = [];
          const properties = {};
          // Maps a field's answer back to its step.contextField.
          const fieldContextField = {};
          for (const step of flow.steps) {
            if (typeof step.form !== "function") continue;
            const form = await step.form(wfctx);
            let stepHadFields = false;
            //TODO onlyWhen
            for (const field of form.fields) {
              if (prefilledFields.has(field.name)) continue;
              //TODO showIf
              const isShowif = field.name.endsWith("_showif");
              const fieldSchema = {
                description:
                  field.copilot_description ||
                  (isShowif
                    ? `${field.label}. The correct default is an empty string — leave it blank to always show this element. Only provide a JavaScript expression if the task description explicitly states that this element should be conditionally hidden based on a URL state variable or the current user. Never invent field names or copy examples.`
                    : `${field.label}.${
                        field.sublabel ? ` ${field.sublabel}` : ""
                      }`),
                ...fieldProperties(field),
              };
              if (!fieldSchema.type) fieldSchema.type = "string";
              properties[field.name] = fieldSchema;
              fieldContextField[field.name] = step.contextField;
              stepHadFields = true;
            }
            if (stepHadFields) stepNames.push(step.name);
          }

          if (Object.keys(properties).length) {
            // Caught, not thrown: an uncaught error here would abort before the view is created, and common.js's postProcess catch swallows it into a silent "Done".
            let answer;
            let tc;
            try {
              answer = await generate(
                `${vt_prompt ? vt_prompt + "\n\n" : ""}${
                  layoutPrompt ? `Task: ${layoutPrompt}\n\n` : ""
                }Now generate the ${stepNames.join(
                  ", "
                )} details of the view by calling the generate_view_details tool`,
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
              tc =
                typeof answer?.getToolCalls === "function"
                  ? answer.getToolCalls()[0]
                  : null;
              if (!tc)
                getState().log(
                  2,
                  `generate() returned no tool call for view config steps ` +
                    `[${stepNames.join(", ")}] - skipping these details.`
                );
            } catch (e) {
              getState().log(
                2,
                `generate() failed for view config steps [${stepNames.join(
                  ", "
                )}] - skipping these details.`,
                e
              );
            }
            if (tc) {
              await getState().functions.llm_add_message.run(
                "tool_response",
                { type: "text", value: "Details provided" },
                { chat, tool_call: tc }
              );
              const details = asPlainObject(tc.input);
              if (details) {
                for (const [key, value] of Object.entries(details)) {
                  const ctxField = fieldContextField[key];
                  if (ctxField) {
                    wfctx[ctxField] = { ...(wfctx[ctxField] || {}), [key]: value };
                  } else {
                    wfctx[key] = value;
                  }
                }
              } else {
                getState().log(
                  2,
                  `generate_view_details tool call for steps [${stepNames.join(
                    ", "
                  )}] returned unparseable input - skipping these details.`,
                  tc.input
                );
              }
            }
          }
        }
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
            renderGeneratedViewConfiguration(wfctx) +
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
          "Calling this tool without a complete configuration object is always wrong and will fail. " +
          "For Show views, use blank segments for literal labels, field/Field pairs for direct fields, and join_field/JoinField pairs for related fields.",
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
                "Passing null, an empty object, or a partial object (e.g. only the name) is always wrong and will return an error. " +
                "For Show views, keep layout segments and configuration.columns synchronized: field with Field, and join_field with JoinField.",
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
          add_response: renderGeneratedViewConfiguration(cfg),
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
      process: async ({ pairs, max_depth }) => {
        const schemaData = await build_schema_data();
        const depth = Math.min(
          6,
          Math.max(1, Math.trunc(Number(max_depth) || 2)),
        );
        const sections = getRelationPathsForPairs(
          pairs || [],
          schemaData,
          depth,
        );
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
