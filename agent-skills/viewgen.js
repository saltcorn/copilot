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
    //const roles = await User.get_roles();
    const tableless = enabled_vt_names.filter(
      (vtnm) => vts[vtnm].tableless === true,
    );
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
          enum: ["admin", "user", "public"],
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
        if (tool_call.input.viewpattern === "Show") {
          const promptFromChat = Array.isArray(chat)
            ? [...chat]
                .reverse()
                .find((item) => item?.role === "user" && item?.content)?.content
            : "";
          const layoutPrompt = promptFromChat || tool_call.input.name || "";
          wfctx.layout = await builderGen.run(
            layoutPrompt,
            "show",
            table?.name,
            null,
            chat,
          );
          if (table) {
            const baseCfg = await initial_config_all_fields(false)({
              table_id: table.id,
            });
            if (baseCfg?.columns) wfctx.columns = baseCfg.columns;
          }
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

          for (const step of flow.steps) {
            const form = await step.form(wfctx);
            const properties = {};
            //TODO onlyWhen
            for (const field of form.fields) {
              //TODO showIf
              properties[field.name] = {
                description:
                  field.copilot_description ||
                  `${field.label}.${field.sublabel ? ` ${field.sublabel}` : ""}`,
                ...fieldProperties(field),
              };
            }

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
              { chat, tool_call: tc }
            );
            Object.assign(wfctx, tc.input);
          }
        }
        const view = new View({
          name: tool_call.input.name,
          viewtemplate: tool_call.input.viewpattern,
          table,
          table_id: table?.id,
          min_role: { admin: 1, public: 100, user: 80 }[
            tool_call.input.min_role || "public"
          ],
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
