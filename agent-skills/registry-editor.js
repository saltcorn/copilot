const Trigger = require("@saltcorn/data/models/trigger");
const Page = require("@saltcorn/data/models/page");
const View = require("@saltcorn/data/models/view");
const Table = require("@saltcorn/data/models/table");
const Field = require("@saltcorn/data/models/field");
const User = require("@saltcorn/data/models/user");
const Plugin = require("@saltcorn/data/models/plugin");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const { getState } = require("@saltcorn/data/db/state");

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
                enum: [
                  "view",
                  "table",
                  "page",
                  "trigger",
                  "available-plugins",
                  "installed-plugins",
                  "system-configuration-keys",
                  "roles",
                ],
              },
            },
          },
        },
        process: async (input) => {
          const tables = await Table.find({}, { cached: true });
          const tableNames = {};
          for (const table of tables) tableNames[table.id] = table.name;
          switch (input.entity_type) {
            case "roles":
              return await User.get_roles();
            case "system-configuration-keys": {
              const cfgs = getState().configs;
              return Object.keys(cfgs).map((k) => ({
                key: k,
                description: cfgs[k].description,
              }));
            }
            case "available-plugins": {
              const store_plugins = await Plugin.store_plugins_available();
              const installed_plugins = await Plugin.find({});
              const installed_names = new Set(
                installed_plugins.map((p) => p.name),
              );
              return store_plugins.map((p) => ({
                name: p.name,
                description: p.description,
                documentation_link: p.documentation_link,
                installed: installed_names.has(p.name),
              }));
            }
            case "installed-plugins":
              const installed_plugins = await Plugin.find({});
              return installed_plugins.map((p) => ({
                name: p.name,
                description: p.description,
                documentation_link: p.documentation_link,
              }));
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
                enum: [
                  "view",
                  "table",
                  "page",
                  "trigger",
                  "plugin",
                  "system-configuration-value",
                ],
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
            case "system-configuration-value":
              const v = getState().getConfig(input.entity_name);
              return v;
            case "plugin":
              const plugin = await Plugin.findOne({
                name: input.entity_name,
              });
              if (!plugin) return `plugin not found`;
              return plugin;
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
                description: "The type of the entity to set",
                enum: [
                  "view",
                  "table",
                  "page",
                  "trigger",
                  "system-configuration-value",
                ],
              },
              entity_name: {
                type: "string",
                description: "The name of the entity to set",
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
          try {
            const entityValue = JSON.parse(input.entity_definition);
            const tables = await Table.find({}, { cached: true });
            const tableNames = {};
            for (const table of tables) tableNames[table.id] = table.name;
            switch (input.entity_type) {
              case "view":
                {
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
                  const existing = await View.findOne({
                    name: input.entity_name,
                  });
                  if (existing?.id) {
                    await View.update(viewNoTable, existing.id);
                  } else {
                    await View.create(viewNoTable);
                  }

                  await getState().refresh_views();
                }
                break;
              case "system-configuration-value":
                await getState().setConfig(input.entity_name, entityValue);
                await getState().refresh_config();
                break;
              case "page":
                const { root_page_for_roles, menu_label, ...pageSpec } =
                  entityValue;
                const existing = Page.findOne({ name: input.entity_name });
                if (existing?.id) await Page.update(existing.id, pageSpec);
                else await Page.create(pageSpec);
                await getState().refresh_pages();

                break;

              case "trigger":
                {
                  const existing = await Trigger.findOne({
                    name: entityValue.name,
                  });
                  const { table, table_name, steps, ...tsNoTableName } =
                    entityValue;
                  if (table || table_name)
                    tsNoTableName.table_id = Table.findOne(
                      table || table_name,
                    )?.id;
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
                await getState().refresh_triggers();
                break;

              case "table": {
                const {
                  id,
                  ownership_field_id,
                  ownership_field_name,
                  triggers,
                  constraints,
                  fields,
                  ...updrow
                } = entityValue;
                let tbl_pk;

                const existing = Table.findOne({ name: input.entity_name });
                if (existing) {
                  tbl_pk = await existing.getField(existing.pk_name);
                  await existing.update(updrow);
                } else {
                  const table = await Table.create(
                    input.entity_name,
                    entityValue,
                  );
                  [tbl_pk] = table.getFields();
                } //set pk

                await getState().refresh_tables(true);
                const _table = Table.findOne({ name: input.entity_name });
                if (!_table)
                  throw new Error(
                    `Unable to find table '${input.entity_name}'`,
                  );

                const exfields = _table.getFields();
                if (!_table.provider_name)
                  for (const field of fields) {
                    const exfield = exfields.find((f) => f.name === field.name);
                    if (
                      !(
                        (_table.name === "users" &&
                          (field.name === "email" ||
                            field.name === "role_id")) ||
                        exfield
                      )
                    ) {
                      if (_table.name === "users" && field.required)
                        await Field.create(
                          { table: _table, ...field, required: false },
                          //bare_tables,
                        );
                      else
                        await Field.create(
                          { table: _table, ...field },
                          //bare_tables,
                        );
                    } else if (
                      exfield &&
                      !(
                        _table.name === "users" &&
                        (field.name === "email" || field.name === "role_id")
                      ) &&
                      exfield.type
                    ) {
                      const { id, table_id, ...updrow } = field;
                      await exfield.update(updrow);
                    }
                  }
                const existing_constraints = _table.constraints;
                for (const constraint of constraints || []) {
                  if (
                    !existing_constraints.find(
                      (excon) =>
                        excon.type === constraint.type &&
                        isEqual(excon.configuration, constraint.configuration),
                    )
                  )
                    await TableConstraint.create({
                      table: _table,
                      ...constraint,
                    });
                }
                if (ownership_field_name) {
                  const owner_field = await Field.findOne({
                    table_id: _table.id,
                    name: ownership_field_name,
                  });
                  await _table.update({ ownership_field_id: owner_field.id });
                }
                await getState().refresh_tables();

                break;
              }
            }
          } catch (e) {
            return `An error occurred: ${e?.message || e}`;
          }
        },
      },
    ];
  };
}

module.exports = RegistryEditorSkill;

/* todo

get_entity more entity types:

* types
* plugin to show entities provided
* view templates

get-entity should explain the json schema and perhaps have a longer explanation

set_entity

* module cfg
* role

set-entity view should run a config check, try to run and report error
set-entity for calculated fields should try to evaluate expression

install module tool


*/
