const Trigger = require("@saltcorn/data/models/trigger");
const Page = require("@saltcorn/data/models/page");
const View = require("@saltcorn/data/models/view");
const Table = require("@saltcorn/data/models/table");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");

class RegistryEditorSkill {
  static skill_name = "Registry editor";

  get skill_label() {
    return "Registry editor";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt() {
    return `
All saltcorn application entities (tables, views, pages and triggers) are defined by JSON
objects. There are separate namespaces for each entity type, so it could be that there are
entities with the same name in different entity types.
    
If you need to find entities in the application, you can use the list_entities
tool which will enumerate all the entities of the specified type with some high level 
details about them but not the full configuration details.

If you need to retrieve the JSON definition of an entity, use the get_entity tool. This will
return the JSON definition. It must be called with both the entity type and name as arguments.

If you need to set the JSON definition of an entity, use the set_entity tool It must be called 
with both the entity type and name, and the new JSON definition as a string as arguments.
`;
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
                enum: ["view", "table", "page", "trigger"],
              },
            },
          },
        },
        process: async (input) => {
          const tables = await Table.find({}, { cached: true });
          const tableNames = {};
          for (const table of tables) tableNames[table.id] = table.name;
          switch (input.entity_type) {
            case "view":
              const allViews = await View.find();
              return allViews.map((v) => ({
                name: v.name,
                viewtemplate: v.viewtemplate,
                description: v.description,
                table: v.table_id ? tableNames[v.table_id] : undefined,
              }));
            case "table":
              return tables.map((v) => ({
                name: v.name,
                description: v.description,
              }));
            case "page":
              const allPages = await Page.find({}, { cached: true });
              return allPages.map((p) => ({
                name: p.name,
                description: p.description,
              }));
            case "trigger":
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
      {
        type: "function",
        function: {
          name: "get_entity",
          description:
            "Get the full JSON definition of an entity by name and entity type",
          parameters: {
            type: "object",
            required: ["entity_type", "entity_name"],
            properties: {
              entity_type: {
                type: "string",
                description: "The type of the entity to retrieve",
                enum: ["view", "table", "page", "trigger"],
              },
              entity_name: {
                type: "string",
                description: "The name of the entity to retrieve",
              },
            },
          },
        },
        process: async (input) => {
          const tables = await Table.find({}, { cached: true });
          const tableNames = {};
          for (const table of tables) tableNames[table.id] = table.name;
          switch (input.entity_type) {
            case "view":
              const view = await View.findOne({ name: input.entity_name });
              if (!view) return `view not found`;
              return {
                name: view.name,
                description: view.description,
                viewtemplate: view.viewtemplate,
                configuration: view.configuration,
                min_role: view.min_role,
                ...(view.table_id ? { table: tableNames[view.table_id] } : {}),
                menu_label: view.menu_label,
                slug: view.slug,
                attributes: view.attributes,
                default_render_page: view.default_render_page,
                exttable_name: view.exttable_name,
              };
            case "table":
              const table = Table.findOne({ name: input.entity_name });
              if (!table) return `table not found`;
              return table.to_json;
            case "page":
              const page = Page.findOne({ name: input.entity_name });
              if (!page) return `page not found`;
              const root_page_for_roles = await page.is_root_page_for_roles();
              return {
                name: page.name,
                title: page.title,
                description: page.description,
                min_role: page.min_role,
                layout: page.layout,
                fixed_states: page.fixed_states,
                menu_label: page.menu_label,
                attributes: page.attributes,
                root_page_for_roles,
              };
            case "trigger":
              const trigger = Trigger.findOne({ name: input.entity_name });
              if (!trigger) return `trigger not found`;
              return trigger.toJson;
          }
        },
      },
      {
        type: "function",
        function: {
          name: "set_entity",
          description:
            "Save a new JSON definition for an entity. Creates a new entity or overwrites an existing entity, depending on whether an entity with this name and type already exists",
          parameters: {
            type: "object",
            required: ["entity_type", "entity_name"],
            properties: {
              entity_type: {
                type: "string",
                description: "The type of the entity to retrieve",
                enum: ["view", "table", "page", "trigger"],
              },
              entity_name: {
                type: "string",
                description: "The name of the entity to retrieve",
              },
              entity_definition: {
                type: "string",
                description:
                  "The new entity definition JSON object, stringified",
              },
            },
          },
        },
        process: async (input) => {
          console.log("set entity", input);
          //return "Done";
          const entityValue = JSON.parse(input.entity_definition);
          const tables = await Table.find({}, { cached: true });
          const tableNames = {};
          for (const table of tables) tableNames[table.id] = table.name;
          switch (input.entity_type) {
            case "view": {
              const {
                table,
                on_menu,
                menu_label,
                on_root_page,
                ...viewNoTable
              } = entityValue;
              if (table && !entityValue.table_id) {
                const thetable = Table.findOne(table);
                entityValue.table_id = thetable.id;
              }
              const existing = await View.findOne({ name: input.entity_name });
              if (existing?.id) {
                await View.update(viewNoTable, existing.id);
              } else {
                await View.create(viewNoTable);
              }
              break;

              // cache
            }

            case "page":
              const { root_page_for_roles, menu_label, ...pageSpec } =
                entityValue;
              const existing = Page.findOne({ name: input.entity_name });
              if (existing?.id) await Page.update(existing.id, pageSpec);
              else await Page.create(pageSpec);

            case "trigger": {
              const existing = await Trigger.findOne({
                name: entityValue.name,
              });
              const { table, table_name, steps, ...tsNoTableName } =
                entityValue;
              if (table || table_name)
                tsNoTableName.table_id = Table.findOne(table || table_name)?.id;
              if (existing) {
                await Trigger.update(existing.id, tsNoTableName);
                id = existing.id;
              } else {
                const newTrigger = await Trigger.create(tsNoTableName);
                id = newTrigger.id;
              }
              if (entityValue.action === "Workflow" && entityValue.steps) {
                await WorkflowStep.deleteForTrigger(id);
                for (const step of entityValue.steps) {
                  await WorkflowStep.create({ ...step, trigger_id: id });
                }
              }
            }

            case "table": {
              const table = Table.findOne({ name: input.entity_name });
              if (!table) return `table not found`;
              return table.to_json;
            }
          }
        },
      },
    ];
  };
}

module.exports = RegistryEditorSkill;
