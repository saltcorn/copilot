const Trigger = require("@saltcorn/data/models/trigger");
const Page = require("@saltcorn/data/models/page");
const View = require("@saltcorn/data/models/view");
const Table = require("@saltcorn/data/models/table");

class RegistryEditorSkill {
  static skill_name = "Registry editor";

  get skill_label() {
    return "Registry editor";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt() {
    return ``;
  }

  provideTools = () => {
    return [
      {
        type: "function",
        function: {
          name: "list_entities",
          description: "List entities in the app of a specified type",
          parameters: {
            type: "object",
            required: ["entity_type"],
            properties: {
              entity_type: {
                type: "string",
                description: "The entity type of which to list all entities",
                enum: ["views", "tables", "pages", "triggers"],
              },
            },
          },
        },
        process: async (input) => {
          const tables = await Table.find({}, { cached: true });
          const tableNames = {};
          for (const table of tables) tableNames[table.id] = table.name;
          switch (input.entity_type) {
            case "views":
              const allViews = await View.find();
              return allViews.map((v) => ({
                name: v.name,
                viewtemplate: v.viewtemplate,
                description: v.description,
                table: v.table_id ? tableNames[v.table_id] : undefined,
              }));
            case "tables":
              return tables.map((v) => ({
                name: v.name,
                description: v.description,
              }));
            case "pages":
              const allPages = await Page.find({}, { cached: true });
              return allPages.map((p) => ({
                name: p.name,
                description: p.description,
              }));
            case "triggers":
              const allTriggers = Trigger.find({});
              return allTriggers.map((tr) => ({
                name: tr.name,
                description: tr.description,
                action: tr.action,
                when_trigger: tr.when_trigger,
                table: tr.table_id ? tableNames[tr.table_id] : undefined,
              }));
          }
        },
      },
    ];
  };
}

module.exports = RegistryEditorSkill;
