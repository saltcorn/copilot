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
  provideTools = () => {
    const state = getState();
    const vts = state.viewtemplates;
    const tables = state.tables;
    const all_vt_names = Object.keys(vts);
    const enabled_vt_names = all_vt_names.filter(
      (vtnm) => vts[vtnm].enable_copilot_viewgen,
    );
    const parameters = {
      type: "object",
      required: ["name", "viewpattern", "table"],
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
          description: "Which table is this a view on",
          type: "string",
          enum: tables.map((t) => t.name),
        },
        min_role: {
          description:
            "The minimum role needed to access the view. For vies accessible only by admin, use 'admin', pages with min_role 'public' is publicly accessible and also available to all users",
          type: "string",
          enum: roles.map((r) => r.role),
        },
      },
    };
    return {
      type: "function",
      function: {
        name: GenerateTables.function_name,
        description: GenerateTables.description,
        parameters,
      },
      process: async (input) => {
        return "Metadata received";
      },
      postProcess: async ({ tool_call, generate }) => {
        
      },
    };
  };
}
