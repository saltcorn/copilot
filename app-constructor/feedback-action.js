const MetaData = require("@saltcorn/data/models/metadata");
const { interpolate } = require("@saltcorn/data/utils");
const { getState } = require("@saltcorn/data/db/state");
const { requirements_tool, task_tool } = require("./tools");
const { tool_choice } = require("./common");
const { PromptGenerator } = require("./prompt-generator");

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
      pt = "CopilotConstructMgr",
      project_id,
      feedback_id,
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

    const generator = await PromptGenerator.createInstance({ pt });
    if (!generator.spec) return;

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

    // plan requirements for a feedback
    const reqAnswer = await getState().functions.llm_generate.run(
      generator.feedbackReqPrompt({
        title: use_title,
        description: use_description,
        urlSection,
        feedbackResearchSection,
      }),
      {
        tools: [requirements_tool],
        ...tool_choice("make_requirements"),
        systemPrompt:
          "You are a project manager. The user wants to build an application, and you\n" +
          "must analyse their application description and any feedback available.",
      }
    );
    const tc = reqAnswer.getToolCalls()[0];
    console.log("got new requiremenrts", tc.input.requirements);

    for (const reqm of tc.input.requirements)
      await MetaData.create({
        type: pt,
        name: "requirement",
        body: { ...reqm, source: "feedback", feedback_title: use_title },
        user_id: req.user?.id,
      });

    // plan tasks for the new requirements
    const taskAnswer = await getState().functions.llm_generate.run(
      generator.feedbackPrompt({
        title: use_title,
        description: use_description,
        urlSection,
        feedbackResearchSection,
        newRequirements: tc.input.requirements,
      }),
      {
        tools: [task_tool],
        ...tool_choice("plan_tasks"),
        systemPrompt:
          "You are a project manager. The user wants to build an application, and you\n" +
          "must analyse their application description and any feedback available.",
      }
    );
    const tcTasks = taskAnswer.getToolCalls()[0];
    console.log("got new tasks", tcTasks.input.tasks);

    for (const task of tcTasks.input.tasks)
      await MetaData.create({
        type: pt,
        name: "task",
        body: { ...task, source: "feedback", feedback_id, project_id },
        user_id: req.user?.id,
      });

    await MetaData.create({
      type: pt,
      name: "feedback",
      body: {
        title: use_title,
        description: use_description,
        url: use_url,
        research_context,
        scope: row.scope || "overall",
        phase_idx: row.phase_idx ?? null,
        feedback_id,
      },
      user_id: user?.id,
    });
  },
};
