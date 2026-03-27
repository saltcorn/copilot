const { eval_expression } = require("@saltcorn/data/models/expression");
const MetaData = require("@saltcorn/data/models/metadata");
const { interpolate } = require("@saltcorn/data/utils");
const { getState } = require("@saltcorn/data/db/state");
const { requirements_tool, task_tool } = require("./tools");
const { tool_choice } = require("./common");

module.exports = {
  description: "Provide user feedback to the construction manager",
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
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "feedback",
      body: { title: use_title, description: use_description, url: use_url },
      user_id: user?.id,
    });
    const spec = await MetaData.findOne({
      type: "CopilotConstructMgr",
      name: "spec",
    });
    if (!spec) return;
    const reqAnswer = await getState().functions.llm_generate.run(
      `The following application is being built:

Description: ${spec.body.description}
Audience: ${spec.body.audience}
Core features: ${spec.body.core_features}
Out of scope: ${spec.body.out_of_scope}
Visual style: ${spec.body.visual_style}

A new piece of feedback has come in from a user:

Title: ${use_title}
Description: ${use_description}

Now use the make_requirements tool to create a single or several (a single is prefered) new requirements that captures this new piece of feedback.
`,
      {
        tools: [requirements_tool],
        ...tool_choice("make_requirements"),
        systemPrompt:
          "You are a project manager. The user wants to build an application, and you must analyse their application description and any feedback available",
      },
    );
    const tc = reqAnswer.getToolCalls()[0];
    console.log("gotr new requiremenrts", tc.input.requirements);

    for (const reqm of tc.input.requirements)
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: "requirement",
        body: reqm,
        user_id: req.user?.id,
      });

    const taskAnswer = await getState().functions.llm_generate.run(
      `The following application is being built:

Description: ${spec.body.description}
Audience: ${spec.body.audience}
Core features: ${spec.body.core_features}
Out of scope: ${spec.body.out_of_scope}
Visual style: ${spec.body.visual_style}

This application will be implemented in Saltcorn, a database application development
environment. 

A new piece of feedback has come in from a user:

Title: ${use_title}
Description: ${use_description}

A product manager has determined that the following requirements should be added to the list of application requirements:

${tc.input.requirements.map((r) => "  * " + r.requirement).join("\n")}

Your plan for implementing this new fedback and requirements should not include any clarification or questions to the product owner. The 
information you have been given so far is all that is available. Every step in the plan 
should be immediately implementable in Saltcorn. You are writing the steps in the plan
for a person who is competent in using saltcorn but has no other business knowledge.

Now use the plan_tasks tool to create the tasks to implement this new feedback
`,
      {
        tools: [task_tool],
        ...tool_choice("plan_tasks"),
        systemPrompt:
          "You are a project manager. The user wants to build an application, and you must analyse their application description and any feedback available",
      },
    );
    const tcTasks = taskAnswer.getToolCalls()[0];
    console.log("got new tasks", tcTasks.input.tasks);

    for (const task of tcTasks.input.tasks)
      await MetaData.create({
        type: "CopilotConstructMgr",
        name: "task",
        body: task,
        user_id: req.user?.id,
      });
  },
};
