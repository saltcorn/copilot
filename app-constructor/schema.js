const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const MetaData = require("@saltcorn/data/models/metadata");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const { findType } = require("@saltcorn/data/models/discovery");
const { save_menu_items } = require("@saltcorn/data/models/config");
const db = require("@saltcorn/data/db");
const WorkflowRun = require("@saltcorn/data/models/workflow_run");
const {
  localeDateTime,
  renderForm,
  mkTable,
  post_delete_btn,
} = require("@saltcorn/markup");
const {
  div,
  script,
  domReady,
  pre,
  code,
  input,
  h4,
  style,
  h5,
  button,
  text_attr,
  i,
  p,
  span,
  small,
  form,
  textarea,
} = require("@saltcorn/markup/tags");
const { getState } = require("@saltcorn/data/db/state");
const renderLayout = require("@saltcorn/markup/layout");
const { viewname, tool_choice } = require("./common");
const { requirements_tool } = require("./tools");
const { saltcorn_description, existing_tables_list } = require("./prompts");
const GenerateTables = require("../actions/generate-tables");
const { buildMermaidMarkup } = GenerateTables;
const GenerateTablesSkill = require("../agent-skills/database-design");

const showSchema = async (req) => {
  const schema = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "schema",
  });

  if (schema) {
    const newTableDefs = schema.body.tables || [];
    const newTableInstances = GenerateTables.process_tables(newTableDefs);
    const reusedMd = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "reused_schema",
    });
    const reusedNames = reusedMd?.body?.table_names || [];
    const reusedInstances = reusedNames
      .map((n) => Table.findOne({ name: n }))
      .filter(Boolean);
    const allTables = [...newTableInstances, ...reusedInstances];
    const mmdia = buildMermaidMarkup(allTables);
    const implemented = !!schema.body.implemented;

    const newNames = newTableDefs.map((t) => t.table_name).filter(Boolean);

    const colorMap = Object.fromEntries([
      ...newNames.map((n) => [n, "#198754"]),
      ...reusedNames.map((n) => [n, "#6c757d"]),
    ]);
    const colorScript = script(
      domReady(`
  const colors = ${JSON.stringify(colorMap)};
  const pre = document.querySelector('.schema-mermaid');
  if (!pre) return;

  const doRender = () => {
    mermaid.run({ nodes: [pre], suppressErrors: true, postRenderCallback: () => {
      for (const g of pre.querySelectorAll('g[id^="entity-"]')) {
        const name = g.id.replace(/^entity-/, '').replace(/-\\d+$/, '');
        const color = colors[name];
        if (color) {
          const p = g.querySelector('path');
          if (p) p.setAttribute('fill', color);
        }
      }
      for (const el of pre.querySelectorAll('g.label.name .nodeLabel')) {
        el.style.color = 'white';
        el.style.fontWeight = 'bold';
      }
    }});
  };

  // Defer render until tab is visible, then colorize nodes.
  const pane = pre.closest('.tab-pane');
  if (pane && !pane.classList.contains('active')) {
    const link = document.querySelector('[href="#' + pane.id + '"]');
    if (link) link.addEventListener('shown.bs.tab', doRender, { once: true });
    else {
      const o = new MutationObserver(() => {
        if (pane.classList.contains('active')) { o.disconnect(); doRender(); }
      });
      o.observe(pane, { attributes: true, attributeFilter: ['class'] });
    }
  } else doRender();
`)
    );

    const legend = div(
      { class: "mt-3 d-flex flex-wrap gap-3 align-items-start" },
      newNames.length
        ? div(
            { class: "d-flex flex-wrap align-items-center gap-1" },
            span(
              { class: "me-1 text-muted small" },
              implemented ? "Was created:" : "Will be created:"
            ),
            ...newNames.map((n) => span({ class: "badge bg-success" }, n))
          )
        : "",
      reusedNames.length
        ? div(
            { class: "d-flex flex-wrap align-items-center gap-1" },
            span(
              { class: "me-1 text-muted small" },
              implemented ? "Already existed:" : "Already exists:"
            ),
            ...reusedNames.map((n) => span({ class: "badge bg-secondary" }, n))
          )
        : ""
    );

    return div(
      { class: "mt-2" },
      pre({ class: "schema-mermaid" }, mmdia),
      colorScript,
      legend,
      !implemented &&
        div(
          { class: "mb-4 d-block mt-3" },
          button(
            {
              class: "btn btn-primary me-2",
              onclick: `view_post("${viewname}", "implement_schema")`,
            },
            "Implement schema"
          ),
          button(
            {
              class: "btn btn-outline-danger",
              onclick: `view_post("${viewname}", "del_schema")`,
            },
            "Delete schema"
          )
        )
    );
  }

  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_schema",
  });
  if (generating) {
    return div(
      { class: "mt-2" },
      p(
        i({ class: "fas fa-spinner fa-spin me-2" }),
        "Generating schema, please wait..."
      ),
      script(
        domReady(`
const poll = () => {
  view_post(${JSON.stringify(viewname)}, 'schema_status', {}, (resp) => {
    if (resp && !resp.generating) location.reload();
    else setTimeout(poll, 3000);
  });
};
setTimeout(poll, 3000);
`)
      )
    );
  }

  return div(
    { class: "mt-2", id: "schema-gen-area" },
    p("Schema not found"),
    button(
      { class: "btn btn-primary", onclick: `copilotGenSchema()` },
      "Generate schema"
    ),
    script(
      domReady(`
window.copilotGenSchema = () => {
  document.getElementById('schema-gen-area').innerHTML =
    '<p><i class="fas fa-spinner fa-spin me-2"></i>Generating schema, please wait...</p>';
  view_post(${JSON.stringify(viewname)}, 'gen_schema', {}, () => {});
  const poll = () => {
    view_post(${JSON.stringify(viewname)}, 'schema_status', {}, (resp) => {
      if (resp && !resp.generating) location.reload();
      else setTimeout(poll, 3000);
    });
  };
  setTimeout(poll, 3000);
};
`)
    )
  );
};

const doGenSchema = async (spec, rs, userId) => {
  const generatingMd = await MetaData.create({
    type: "CopilotConstructMgr",
    name: "generating_schema",
    body: {},
    user_id: userId,
  });
  try {
    const databaseDesignTool = new GenerateTablesSkill({}).provideTools();
    const existing_tables = await Table.find({});
    const answer = await getState().functions.llm_generate.run(
      `Generate the database schema for this application:

Description: ${spec.body.description}
Audience: ${spec.body.audience}
Core features: ${spec.body.core_features}
Out of scope: ${spec.body.out_of_scope}
Visual style: ${spec.body.visual_style}

These are the requirements of the application:

${rs.map((r) => `* ${r.body.requirement}`).join("\n")}

${saltcorn_description}

${existing_tables_list(existing_tables)}

Design a complete database schema that covers ALL requirements listed above. Every distinct entity in the application must have its own table. Do not produce a minimal or partial schema — all tables needed to implement every requirement must be included in this single call. Do not leave any tables for a later step.

The tables listed above already exist in the database. Do NOT modify or extend them — treat them as fixed. Handle them as follows:
- If an existing table is already complete and used as-is: add its name to reused_table_names. Do NOT define its fields again in the tables array.
- New tables not yet in the database: include them in the tables array with all their fields as usual.

For every field that must be unique (e.g. unique email, unique slug, unique combination keys expressed as individual unique fields), set unique=true on that field.
For every field that must not be empty, set not_null=true. Description, notes, and other free-text fields should NOT be not_null unless the requirements explicitly state they are required.
Do NOT leave uniqueness or required constraints for a later step — express them fully in this schema.

Note: ownership configuration (automatically populating a FK-to-users field from the logged-in user) is a VIEW-level concern and cannot be expressed in the schema. Do not attempt to annotate fields as "ownership fields" here — simply define the foreign key field normally. Ownership will be configured when the Edit views are generated.

Now use the ${
        databaseDesignTool.function.name
      } tool to generate the complete database schema for this software application
`,
      {
        tools: [databaseDesignTool],
        ...tool_choice(databaseDesignTool.function.name),
        systemPrompt:
          "You are a database designer. The user wants to build an application, and you must analyse their application description and requirements and design a complete schema. Every entity needed by any requirement must have its own table. Never produce a partial schema.",
      }
    );

    const tc = answer.getToolCalls()[0];

    const noNewTables = !tc.input.tables || tc.input.tables.length === 0;
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "schema",
      body: { tables: tc.input.tables || [], implemented: noNewTables },
      user_id: userId,
    });

    const reusedNames = tc.input.reused_table_names || [];
    if (reusedNames.length) {
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: "reused_schema",
        body: { table_names: reusedNames },
        user_id: userId,
      });
    }
  } finally {
    await generatingMd.delete();
  }
};

const gen_schema = async (table_id, viewname, config, body, { req, res }) => {
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  if (!spec) throw new Error("Specification not found");
  const rs = await MetaData.find({
    type: "CopilotConstructMgr",
    name: "requirement",
  });
  if (!rs.length) throw new Error("No requirements found");

  doGenSchema(spec, rs, req.user?.id).catch((e) =>
    console.error("gen_schema error", e)
  );
  return { json: { success: true } };
};

const schema_status = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const generating = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "generating_schema",
  });
  return { json: { generating: !!generating } };
};

const del_schema = async (table_id, viewname, config, body, { req, res }) => {
  for (const name of ["schema", "reused_schema", "generating_schema"]) {
    const rs = await MetaData.find({ type: "CopilotConstructMgr", name });
    for (const r of rs) await r.delete();
  }
  return { json: { reload_page: true } };
};

const implement_schema = async (
  table_id,
  viewname,
  config,
  body,
  { req, res }
) => {
  const md = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "schema",
  });

  const { apply_copilot_tables } = new GenerateTablesSkill({}).userActions;
  const existingNames = new Set((await Table.find({})).map((t) => t.name));
  const newTables = md.body.tables.filter((t) => {
    if (existingNames.has(t.name)) {
      getState().log(
        2,
        `AppConstructor: skipping table "${t.name}" — already exists in database`
      );
      return false;
    }
    return true;
  });
  await apply_copilot_tables({ tables: newTables, user: req.user });
  md.body.implemented = true;
  await md.update({ body: md.body });

  return { json: { reload_page: true } };
};

const schema_routes = {
  gen_schema,
  schema_status,
  del_schema,
  implement_schema,
};

module.exports = { showSchema, schema_routes };
