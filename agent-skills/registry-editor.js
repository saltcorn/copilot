const Trigger = require("@saltcorn/data/models/trigger");
const Page = require("@saltcorn/data/models/page");
const View = require("@saltcorn/data/models/view");
const Table = require("@saltcorn/data/models/table");
const Field = require("@saltcorn/data/models/field");
const User = require("@saltcorn/data/models/user");
const Plugin = require("@saltcorn/data/models/plugin");
const Role = require("@saltcorn/data/models/role");
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
                  "viewtemplates",
                  "types",
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
            case "viewtemplates": {
              const viewtemplates = getState().viewtemplates;
              return Object.keys(viewtemplates).map((name) => ({
                name,
                description: viewtemplates[name].description,
              }));
            }
            case "types": {
              const types = getState().types;
              return Object.keys(types).map((name) => ({
                name,
                description: types[name].description,
              }));
            }
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
                  "type",
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

          const fmt = (entityType, name, value, schema) =>
            `The definition of the "${name}" ${entityType} is:\n${JSON.stringify(value, null, 2)}\n\n` +
            `JSON schema for set_entity (entity_type: "${entityType}"):\n${JSON.stringify(schema, null, 2)}`;

          switch (input.entity_type) {
            case "view": {
              const view = await View.findOne({ name: input.entity_name });
              if (!view) return `view not found`;
              const value = {
                name: view.name,
                description: view.description,
                viewtemplate: view.viewtemplate,
                configuration: view.configuration,
                min_role: view.min_role,
                ...(view.table_id ? { table: tableNames[view.table_id] } : {}),
                ...(view.exttable_name
                  ? { exttable_name: view.exttable_name }
                  : {}),
                menu_label: view.menu_label,
                slug: view.slug,
                attributes: view.attributes,
                default_render_page: view.default_render_page,
              };
              const schema = {
                name: { type: "string", description: "name of the view" },
                viewtemplate: {
                  type: "string",
                  description:
                    "viewtemplate to use. Use list_entities viewtemplates to see options",
                },
                table: {
                  type: "string",
                  description: "name of the table (use this, not table_id)",
                },
                min_role: {
                  type: "number",
                  description:
                    "minimum role id required. 100=public, 80=user. Use list_entities roles for valid ids",
                },
                description: {
                  type: "string",
                  description: "optional description",
                },
                configuration: {
                  type: "object",
                  description: `viewtemplate-specific configuration for the '${view.viewtemplate}' viewtemplate`,
                },
                menu_label: {
                  type: "string",
                  description: "optional menu label to show in navigation",
                },
                default_render_page: {
                  type: "string",
                  description:
                    "optional page name to render instead of the view",
                },
                slug: {
                  type: "object",
                  description: "optional URL slug configuration",
                },
                attributes: {
                  type: "object",
                  description: "optional view attributes",
                },
              };
              return fmt("view", view.name, value, schema);
            }
            case "table": {
              const table = Table.findOne({ name: input.entity_name });
              if (!table) return `table not found`;
              const value = table.to_json;
              const fieldSchema = {
                type: "array",
                description: "array of field definitions",
                items: {
                  name: {
                    type: "string",
                    description: "field name (snake_case)",
                  },
                  label: { type: "string", description: "display label" },
                  type: {
                    type: "string",
                    description:
                      "field type name. Use list_entities types for valid options",
                  },
                  required: { type: "boolean" },
                  description: { type: "string" },
                  attributes: {
                    type: "object",
                    description:
                      "type-specific attributes. Use get_entity type <typename> for valid attributes",
                  },
                },
              };
              const schema = {
                name: { type: "string", description: "table name" },
                description: { type: "string" },
                min_role_read: {
                  type: "number",
                  description:
                    "role id for read access. Use list_entities roles",
                },
                min_role_write: {
                  type: "number",
                  description:
                    "role id for write access. Use list_entities roles",
                },
                versioned: {
                  type: "boolean",
                  description: "whether to keep row history",
                },
                ownership_formula: {
                  type: "string",
                  description: "formula to determine row ownership",
                },
                ownership_field_name: {
                  type: "string",
                  description: "field name that stores owner user id",
                },
                fields: fieldSchema,
                constraints: {
                  type: "array",
                  description: "array of table constraints",
                },
              };
              return fmt("table", table.name, value, schema);
            }
            case "system-configuration-value": {
              const v = getState().getConfig(input.entity_name);
              const cfgMeta = getState().configs[input.entity_name];
              if (cfgMeta?.description) {
                return `The value of "${input.entity_name}" is: ${JSON.stringify(v)}\n\nDescription: ${cfgMeta.description}`;
              }
              return v;
            }
            case "plugin": {
              const plugin = await Plugin.findOne({ name: input.entity_name });
              if (!plugin) return `plugin not found`;
              return plugin;
            }
            case "page": {
              const page = Page.findOne({ name: input.entity_name });
              if (!page) return `page not found`;
              const root_page_for_roles = await page.is_root_page_for_roles();
              const value = {
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
              const schema = {
                name: { type: "string", description: "page name" },
                title: {
                  type: "string",
                  description: "page title shown in browser tab",
                },
                description: { type: "string" },
                min_role: {
                  type: "number",
                  description:
                    "minimum role id required. 100=public, 80=user. Use list_entities roles for valid ids",
                },
                layout: {
                  type: "object",
                  description: "page layout definition",
                },
                fixed_states: {
                  type: "object",
                  description: "fixed state values for embedded views",
                },
                menu_label: {
                  type: "string",
                  description: "optional menu label",
                },
                attributes: { type: "object" },
              };
              return fmt("page", page.name, value, schema);
            }
            case "trigger": {
              const trigger = Trigger.findOne({ name: input.entity_name });
              if (!trigger) return `trigger not found`;
              const value = trigger.toJson;
              const schema = {
                name: { type: "string", description: "trigger name" },
                action: {
                  type: "string",
                  description:
                    "action to run. Use list_entities actions or installed-plugins to find valid actions",
                },
                when_trigger: {
                  type: "string",
                  description:
                    "when to fire. Options: Insert, Update, Delete (require a table), Weekly, Daily, Hourly, Never (no table needed), or a custom event name. Use 'Never' for triggers that are called programmatically or on demand.",
                },
                table: {
                  type: "string",
                  description:
                    "table name — only required when when_trigger is Insert, Update, or Delete. Omit for Never, time-based, or event triggers.",
                },
                description: { type: "string" },
                min_role: {
                  type: "number",
                  description: "minimum role id. Use list_entities roles",
                },
                configuration: {
                  type: "object",
                  description: "action-specific configuration",
                },
              };
              return fmt("trigger", trigger.name, value, schema);
            }
            case "type": {
              const types = getState().types;
              const type = types[input.entity_name];
              if (!type) return `type not found`;
              const serializeField = (f) => {
                const {
                  name,
                  label,
                  type: ftype,
                  description,
                  required,
                  options,
                } = f;
                return {
                  name,
                  label,
                  type: typeof ftype === "string" ? ftype : ftype?.name,
                  description,
                  required,
                  options,
                };
              };
              const result = {
                name: type.name,
                description: type.description,
              };
              if (Array.isArray(type.attributes)) {
                result.attributes = type.attributes.map(serializeField);
              } else if (typeof type.attributes === "function") {
                result.attributes = "dynamic (depends on table context)";
              }
              if (type.fieldviews) {
                result.fieldviews = Object.entries(type.fieldviews).map(
                  ([fvName, fv]) => {
                    const fvInfo = {
                      name: fvName,
                      description: fv.description,
                      isEdit: fv.isEdit || false,
                      isFilter: fv.isFilter || false,
                    };
                    if (Array.isArray(fv.configFields)) {
                      fvInfo.configFields = fv.configFields.map(serializeField);
                    } else if (typeof fv.configFields === "function") {
                      fvInfo.configFields = "dynamic";
                    }
                    return fvInfo;
                  },
                );
              }
              return result;
            }
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
                  "module-configuration",
                  "role",
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
        process: async (input, ctx) => {
          try {
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
                  viewname,
                  ...viewNoTable
                } = entityValue;

                if (viewname && !viewNoTable.name) viewNoTable.name = viewname;
                if (!viewNoTable.name) viewNoTable.name = input.entity_name;

                if (typeof viewNoTable.table_id === "string") {
                  const t = Table.findOne({ name: viewNoTable.table_id });
                  if (!t) return `Table '${viewNoTable.table_id}' not found`;
                  viewNoTable.table_id = t.id;
                }

                const tableName =
                  table ||
                  entityValue.configuration?.table_name ||
                  entityValue.configuration?.exttable_name;
                if (tableName && !viewNoTable.table_id) {
                  const thetable = Table.findOne({ name: tableName });
                  if (!thetable) return `Table '${tableName}' not found`;
                  viewNoTable.table_id = thetable.id;
                }

                if (!viewNoTable.min_role) viewNoTable.min_role = 100;
                if (
                  viewNoTable.table_id == null &&
                  !viewNoTable.exttable_name &&
                  !entityValue.configuration?.exttable_name
                )
                  return `View requires a table. Provide a 'table' field with the table name.`;

                const existing = await View.findOne({
                  name: input.entity_name,
                });
                const oldValues = existing
                  ? {
                      viewtemplate: existing.viewtemplate,
                      configuration: existing.configuration,
                      table_id: existing.table_id,
                      min_role: existing.min_role,
                      slug: existing.slug,
                      attributes: existing.attributes,
                      default_render_page: existing.default_render_page,
                      exttable_name: existing.exttable_name,
                    }
                  : null;

                if (existing?.id) {
                  await View.update(viewNoTable, existing.id);
                } else {
                  try {
                    await View.create(viewNoTable);
                  } catch (e) {
                    return `Error creating view: ${e.message}`;
                  }
                }
                await getState().refresh_views();

                const errors = [];
                const warnings = [];
                const savedView = await View.findOne({
                  name: input.entity_name,
                });

                if (savedView?.viewtemplateObj?.configCheck) {
                  try {
                    const issues =
                      await savedView.viewtemplateObj.configCheck(savedView);
                    if (Array.isArray(issues) && issues.length > 0) {
                      errors.push(...issues);
                    } else if (!Array.isArray(issues)) {
                      if (Array.isArray(issues.errors)) {
                        errors.push(...issues.errors);
                      }
                      if (Array.isArray(issues.warnings)) {
                        warnings.push(...issues.warnings);
                      }
                    }
                  } catch (e) {
                    errors.push(`configCheck error: ${e.message}`);
                  }
                }

                if (errors.length === 0 && savedView) {
                  try {
                    const sfs = await savedView.get_state_fields();
                    const needsPk =
                      savedView.table_id &&
                      sfs.some((f) => f.primary_key || f.name === "id");
                    if (needsPk) {
                      const tbl = Table.findOne({ id: savedView.table_id });
                      const pk = tbl.pk_name;
                      const rows = await tbl.getRows(
                        {},
                        { orderBy: "RANDOM()", limit: 1 },
                      );
                      if (rows.length > 0) {
                        await savedView.run(
                          { [pk]: rows[0][pk] },
                          { req: ctx?.req },
                        );
                      }
                      if (rows.length === 0 || sfs.every((f) => !f.required)) {
                        await savedView.run({}, { req: ctx?.req });
                      }
                    } else {
                      await savedView.run({}, { req: ctx?.req });
                    }
                  } catch (e) {
                    errors.push(`render error: ${e.message}`);
                  }
                }

                if (errors.length > 0) {
                  try {
                    if (oldValues) {
                      await View.update(oldValues, existing.id);
                    } else {
                      const newView = await View.findOne({
                        name: input.entity_name,
                      });
                      if (newView) await newView.delete();
                    }
                    await getState().refresh_views();
                  } catch (re) {
                    errors.push(`(rollback failed: ${re.message})`);
                  }
                  const msg = [
                    `Errors found, changes not applied:\n${errors.join("\n")}`,
                  ];
                  if (warnings.length)
                    msg.push(`Warnings: ${warnings.join("\n")}`);
                  return msg.join("\n");
                }
                if (warnings.length)
                  return `Done (warnings: ${warnings.join("; ")})`;
                break;
              }

              case "system-configuration-value":
                await getState().setConfig(input.entity_name, entityValue);
                await getState().refresh_config();
                break;

              case "page": {
                const { root_page_for_roles, menu_label, ...pageSpec } =
                  entityValue;

                if (!pageSpec.min_role) {
                  pageSpec.min_role = 100;
                } else {
                  const roles = await User.get_roles();
                  const roleExists = roles.some(
                    (r) => r.id === pageSpec.min_role,
                  );
                  if (!roleExists) pageSpec.min_role = 100;
                }

                const existing = Page.findOne({ name: input.entity_name });

                const oldValues = existing
                  ? {
                      title: existing.title,
                      description: existing.description,
                      min_role: existing.min_role,
                      layout: existing.layout,
                      fixed_states: existing.fixed_states,
                      menu_label: existing.menu_label,
                      attributes: existing.attributes,
                    }
                  : null;

                if (existing?.id) await Page.update(existing.id, pageSpec);
                else {
                  try {
                    await Page.create(pageSpec);
                  } catch (e) {
                    return `Error creating page: ${e.message}`;
                  }
                }
                await getState().refresh_pages();

                const errors = [];
                try {
                  const savedPage = Page.findOne({ name: input.entity_name });
                  if (savedPage) await savedPage.run({}, { req: ctx?.req });
                } catch (e) {
                  errors.push(`render error: ${e.message}`);
                }

                if (errors.length > 0) {
                  try {
                    if (oldValues) {
                      await Page.update(existing.id, oldValues);
                    } else {
                      const newPage = Page.findOne({ name: input.entity_name });
                      if (newPage) await newPage.delete();
                    }
                    await getState().refresh_pages();
                  } catch (re) {
                    errors.push(`(rollback failed: ${re.message})`);
                  }
                  return `Errors found, changes not applied:\n${errors.join("\n")}`;
                }
                break;
              }

              case "trigger": {
                const existing = await Trigger.findOne({
                  name: entityValue.name || input.entity_name,
                });
                const { table, table_name, steps, ...tsNoTableName } =
                  entityValue;
                if (table || table_name)
                  tsNoTableName.table_id = Table.findOne(
                    table || table_name,
                  )?.id;

                // Pre-check action before saving
                if (tsNoTableName.action) {
                  const action = getState().actions[tsNoTableName.action];
                  if (!action)
                    return `Action '${tsNoTableName.action}' not found`;
                  if (action.configCheck) {
                    try {
                      const tbl = tsNoTableName.table_id
                        ? Table.findOne({ id: tsNoTableName.table_id })
                        : undefined;
                      const errs = await action.configCheck({
                        table: tbl,
                        ...tsNoTableName,
                      });
                      console.log({ errs });
                      if (Array.isArray(errs) && errs.length > 0)
                        return `Errors found, changes not applied:\n${errs.join("\n")}`;
                    } catch (e) {
                      return `configCheck error: ${e.message}`;
                    }
                  }
                }

                let id;
                if (existing) {
                  await Trigger.update(existing.id, tsNoTableName);
                  id = existing.id;
                } else {
                  try {
                    const newTrigger = await Trigger.create(tsNoTableName);
                    id = newTrigger.id;
                  } catch (error) {
                    return `Error creating trigger: ${error.message}`;
                  }
                }
                if (entityValue.action === "Workflow" && entityValue.steps) {
                  await WorkflowStep.deleteForTrigger(id);
                  for (const step of entityValue.steps) {
                    await WorkflowStep.create({ ...step, trigger_id: id });
                  }
                }
                await getState().refresh_triggers();
                break;
              }

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

                const existing = Table.findOne({ name: input.entity_name });
                if (existing) {
                  await existing.update(updrow);
                } else {
                  await Table.create(input.entity_name, entityValue);
                }

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
                        await Field.create({
                          table: _table,
                          ...field,
                          required: false,
                        });
                      else await Field.create({ table: _table, ...field });
                    } else if (
                      exfield &&
                      !(
                        _table.name === "users" &&
                        (field.name === "email" || field.name === "role_id")
                      ) &&
                      exfield.type
                    ) {
                      const { id: _id, table_id, ...fieldUpdrow } = field;
                      await exfield.update(fieldUpdrow);
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

                // Check calculated fields
                const calcErrors = [];
                for (const field of _table
                  .getFields()
                  .filter((f) => f.calculated && f.expression)) {
                  try {
                    const rows = await _table.getRows({}, { limit: 1 });
                    if (rows.length > 0) {
                      const {
                        eval_expression,
                      } = require("@saltcorn/data/models/expression");
                      eval_expression(
                        field.expression,
                        rows[0],
                        ctx?.req?.user,
                      );
                    }
                  } catch (e) {
                    calcErrors.push(
                      `Calculated field '${field.name}': ${e.message}`,
                    );
                  }
                }
                if (calcErrors.length > 0)
                  return `Table saved but calculated field errors found:\n${calcErrors.join("\n")}`;

                break;
              }

              case "module-configuration": {
                const plugin = await Plugin.findOne({
                  name: input.entity_name,
                });
                if (!plugin) return `module not found: ${input.entity_name}`;
                plugin.configuration = {
                  ...(plugin.configuration || {}),
                  ...entityValue,
                };
                await plugin.upsert();
                getState().plugin_cfgs[input.entity_name] =
                  plugin.configuration;
                await getState().refresh_plugins();
                return "Module configuration updated";
              }

              case "role": {
                const result = await Role.create({
                  role: input.entity_name,
                  ...entityValue,
                });
                if (result?.error) return result.error;
                await getState().refresh_roles();
                return "Role created";
              }
            }
            return "Done";
          } catch (e) {
            return `An error occurred: ${e?.message || e}`;
          }
        },
      },
    ];
  };
}

module.exports = RegistryEditorSkill;
