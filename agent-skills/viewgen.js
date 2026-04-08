const Table = require("@saltcorn/data/models/table");
const View = require("@saltcorn/data/models/view");
const { fieldProperties } = require("../common");
const { initial_config_all_fields } = require("@saltcorn/data/plugin-helper");
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
    return `If the user asks to generate a view, use the generate_view tool to enter 
a view generation mode. The tool call only requires high-level details to start this sequence.`;
  }

  get userActions() {
    return {
      async build_copilot_view_gen({
        wfctx,
        name,
        viewpattern,
        table,
        min_role,
      }) {
        const normalizedRole = min_role || "public";
        const tableRow = table ? Table.findOne({ name: table }) : null;
        await View.create({
          name,
          viewtemplate: viewpattern,
          table_id: tableRow?.id,
          table: tableRow,
          min_role: { admin: 1, public: 100, user: 80 }[normalizedRole],
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
        vts[vtnm].copilot_generate_view_prompt,
    );
    if (!enabled_vt_names.includes("Show")) enabled_vt_names.push("Show");
    if (!enabled_vt_names.includes("Edit")) enabled_vt_names.push("Edit");
    if (!enabled_vt_names.includes("List")) enabled_vt_names.push("List");
    if (!enabled_vt_names.includes("Filter")) enabled_vt_names.push("Filter");
    //const roles = await User.get_roles();
    const tableless = enabled_vt_names.filter(
      (vtnm) => vts[vtnm].tableless === true,
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
          description: `The type of view to generate. Some of the view descriptions: ${enabled_vt_names.map((vtnm) => `${vtnm}: ${vts[vtnm].description}.`).join(" ")}`,
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

    return {
      type: "function",
      function: {
        name: "generate_view",
        description:
          "Generate a view by supplying high-level details. This will trigger a view generation sequence",
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
          const promptFromChat = Array.isArray(chat)
            ? [...chat]
                .reverse()
                .find((item) => item?.role === "user" && item?.content)?.content
            : "";
          const layoutPrompt = promptFromChat || tool_call.input.name || "";
          wfctx.layout = await builderGen.run(
            layoutPrompt,
            builderMode,
            table?.name,
            null,
            chat,
          );
          if (table && viewpattern !== "Filter") {
            const baseCfg = await initial_config_all_fields(false)({
              table_id: table.id,
            });
            if (baseCfg?.columns) wfctx.columns = baseCfg.columns;
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
                tool_call.input,
              );
          }

          const prefilledFields = new Set();
          if (wfctx.layout !== undefined) prefilledFields.add("layout");
          if (wfctx.columns !== undefined) prefilledFields.add("columns");

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
                  `${field.label}.${field.sublabel ? ` ${field.sublabel}` : ""}`,
                ...fieldProperties(field),
              };
              if (!properties[field.name].type) {
                properties[field.name].type = "string";
              }
            }

            if (!Object.keys(properties).length) continue;

            const answer = await generate(
              `${vt_prompt ? vt_prompt + "\n\n" : ""}Now generate the ${step.name} details of the view by calling the generate_view_details tool`,
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
              },
            );
            const tc = answer.getToolCalls()[0];
            await getState().functions.llm_add_message.run(
              "tool_response",
              { type: "text", value: "Details provided" },
              { chat, tool_call: tc },
            );
            Object.assign(wfctx, tc.input);
          }
        }
        const roleName = tool_call.input.min_role || "public";
        const rolesState = getState().roles;
        const min_role = rolesState
          ? (rolesState.find((r) => r.role === roleName) || { id: 100 }).id
          : { admin: 1, public: 100, user: 80 }[roleName] ?? 100;
        const view = new View({
          name: tool_call.input.name,
          viewtemplate: tool_call.input.viewpattern,
          table,
          table_id: table?.id,
          min_role,
          configuration: wfctx,
        });
        const runres = await view.run({}, { req });
        return {
          stop: true,
          add_response:
            pre(JSON.stringify(wfctx, null, 2)) +
            div(
              { style: { maxHeight: 800, maxWidth: 500, overflow: "scroll" } },
              runres,
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
  };
}

module.exports = GenerateViewSkill;
