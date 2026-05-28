const MetaData = require("@saltcorn/data/models/metadata");
const Table = require("@saltcorn/data/models/table");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const Page = require("@saltcorn/data/models/page");
const Plugin = require("@saltcorn/data/models/plugin");
const { interpolate } = require("@saltcorn/data/utils");
const { getState } = require("@saltcorn/data/db/state");
const { requirements_tool, task_tool } = require("./tools");
const { tool_choice } = require("./common");
const { getResearchAnswersText } = require("./research");
const {
  saltcorn_description,
  existing_tables_list,
  existing_entities_list,
  installed_plugins_list,
  available_plugins_list,
  task_planning_rules,
  task_planning_closing,
  research_answers_section,
} = require("./prompts");

module.exports = {
  description: "Provide user feedback to the AppConstructor",
  configFields: ({ table, mode }) => {
    if (mode === "workflow") {
      return [
        {
          name: "title",
          label: "Title",
          sublabel:
            "Feedback title. Use interpolations {{ }} to access variables in the context",
          type: "String",
        },
        {
          name: "description",
          label: "Description",
          sublabel:
            "Feedback description. Use interpolations {{ }} to access variables in the context",
          type: "String",
        },
        {
          name: "url",
          label: "URL",
          sublabel:
            "Feedback URL. Use interpolations {{ }} to access variables in the context",
          type: "String",
        },
      ];
    } else if (table) {
      const textFields = table.fields
        .filter((f) => f.type?.sql_name === "text")
        .map((f) => f.name);
      return [
        {
          name: "title_field",
          label: "Title field",
          type: "String",
          attributes: { options: textFields },
        },
        {
          name: "description_field",
          label: "Description field",
          type: "String",
          attributes: { options: textFields },
        },
        {
          name: "url_field",
          label: "URL field",
          type: "String",
          attributes: { options: textFields },
        },
      ];
    }
  },
  run: async ({
    row,
    table,
    user,
    mode,
    req,
    configuration: {
      title,
      description,
      url,
      title_field,
      description_field,
      url_field,
      research_context,
    },
  }) => {
    const use_title =
      mode === "workflow" ? interpolate(title, row, user) : row[title_field];
    const use_description =
      mode === "workflow"
        ? interpolate(description, row, user)
        : row[description_field];
    const use_url =
      mode === "workflow" ? interpolate(url, row, user) : row[url_field];
    const spec = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "spec",
    });
    if (!spec) return;

    const researchText = await getResearchAnswersText();
    const feedbackResearchSection = research_context
      ? `\nThe user also answered clarifying questions about this feedback:\n\n${research_context}\n`
      : "";

    let urlSection = "";
    if (use_url) {
      const mView = use_url.match(/\/view\/([^/?#]+)/);
      const mPage = use_url.match(/\/page\/([^/?#]+)/);
      if (mView)
        urlSection =
          `\nThe feedback was submitted from the Saltcorn view named "${mView[1]}"` +
          ` (URL: ${use_url}).\n`;
      else if (mPage)
        urlSection =
          `\nThe feedback was submitted from the Saltcorn page named "${mPage[1]}"` +
          ` (URL: ${use_url}).\n`;
      else urlSection = `\nThe feedback was submitted from: ${use_url}\n`;
    }

    const reqAnswer = await getState().functions.llm_generate.run(
      `The following application is being built:

${spec.body.specification}
${research_answers_section(researchText)}
A new piece of feedback has come in from a user:

Title: ${use_title}
Description: ${use_description}
${urlSection}${feedbackResearchSection}
Now use the make_requirements tool to create a single or several (a single is preferred) new requirements that captures this new piece of feedback.

* Priority reflects how central the feature is to the core purpose of the application. Assign 5 to features without which the application cannot function at all, 3-4 to features that are important but not blocking, 1-2 to minor convenience features. Do not assign 5 to everything.
`,
      {
        tools: [requirements_tool],
        ...tool_choice("make_requirements"),
        systemPrompt:
          "You are a project manager. The user wants to build an application, and you must analyse their application description and any feedback available",
      }
    );
    const tc = reqAnswer.getToolCalls()[0];
    console.log("got new requiremenrts", tc.input.requirements);

    const allReqs = await MetaData.find({
      type: "CopilotConstructMgr",
      name: "requirement",
    });

    for (const reqm of tc.input.requirements)
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: "requirement",
        body: { ...reqm, source: "feedback", feedback_title: use_title },
        user_id: req.user?.id,
      });

    const tables = await Table.find({});
    const tableById = Object.fromEntries(tables.map((t) => [t.id, t.name]));
    const views = await View.find({});
    const triggers = await Trigger.find({});
    const pages = await Page.find({});
    const entitiesSection = existing_entities_list({
      views,
      triggers,
      pages,
      tableById,
    });
    const installedPlugins = await Plugin.find({});
    const installedNames = new Set(installedPlugins.map((p) => p.name));
    let storePlugins = [];
    try {
      storePlugins = await Plugin.store_plugins_available();
    } catch (_) {}
    const installedPluginsSection = installed_plugins_list(installedNames);
    const pluginsSection = available_plugins_list(storePlugins, installedNames);

    const taskAnswer = await getState().functions.llm_generate.run(
      `Generate implementation tasks for a new piece of feedback for this application:

${spec.body.specification}
${research_answers_section(researchText)}
A new piece of feedback has come in from a user:

Title: ${use_title}
Description: ${use_description}
${urlSection}${feedbackResearchSection}
The existing application requirements are:

${allReqs.map((r) => `* ${r.body.requirement}`).join("\n")}

A product manager has determined that the following new requirements should be added to implement this feedback:

${tc.input.requirements.map((r) => "  * " + r.requirement).join("\n")}

${saltcorn_description}

The database has already been built. The following tables are now present in the database:

${existing_tables_list(tables)}

The plan should outline continued development of the application on top of this database.
Your plan can add additional tables if needed or adjust the table fields, but normally the tables
should be designed optimally for this application.

${entitiesSection ? entitiesSection + "\n\n" : ""}${
        installedPluginsSection ? installedPluginsSection + "\n\n" : ""
      }${pluginsSection ? pluginsSection + "\n\n" : ""}${task_planning_rules}

${task_planning_closing}

Important overrides for feedback tasks:
* Generate ONLY the minimal tasks that directly implement what the feedback requests. Do not add defensive "verify", "ensure accessible", or "check still reachable" tasks — those are not changes and do not belong in a task plan.
* Do NOT generate tasks for writing, updating, or running automated tests. There are no automated tests in this application.
* When a task modifies an existing view or page, do NOT set or change its min_role unless the feedback explicitly requests an access control change. The existing min_role is already correct — leave it as-is.
* If the feedback can be implemented in a single task, use a single task. Do not split it into more tasks than strictly necessary.

Now use the plan_tasks tool to create the tasks to implement this new feedback.
`,
      {
        tools: [task_tool],
        ...tool_choice("plan_tasks"),
        systemPrompt:
          "You are a project manager. The user wants to build an application, and you must analyse their application description and any feedback available",
      }
    );
    const tcTasks = taskAnswer.getToolCalls()[0];
    console.log("got new tasks", tcTasks.input.tasks);

    for (const task of tcTasks.input.tasks)
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: "task",
        body: { ...task, source: "feedback", feedback_title: use_title },
        user_id: req.user?.id,
      });

    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "feedback",
      body: {
        title: use_title,
        description: use_description,
        url: use_url,
        research_context,
        scope: row.scope || "overall",
        phase_idx: row.phase_idx ?? null,
      },
      user_id: user?.id,
    });
  },
};
