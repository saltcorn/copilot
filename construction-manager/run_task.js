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
const { viewname } = require("./common");

const runTask = async (md_id, req) => {
  const md = await MetaData.findOne({
    id: md_id,
  });

  if (!md) return { error: "Task not found" };
  const spec = await MetaData.findOne({
    type: "CopilotConstructMgr",
    name: "spec",
  });
  if (!spec) return { error: "Specification not found" };
  const agent_action = new Trigger({
    action: "Agent",
    when_trigger: "Never",
    configuration: {
      viewname: viewname,
      sys_prompt: "",
      prompt: "{{prompt}}",
      skills: [
        { skill_type: "Generate Page", yoloMode: true },
        { skill_type: "Database design", yoloMode: true },
        { skill_type: "Generate Workflow", yoloMode: true },
        { skill_type: "Generate View", yoloMode: true },
      ],
    },
  });
  const prompt = `You are engaged in building the following application:

Description: ${spec.body.description}
Audience: ${spec.body.audience}
Core features: ${spec.body.core_features}
Out of scope: ${spec.body.out_of_scope}
Visual style: ${spec.body.visual_style}

Your task now is:
${md.body.description}`;

  const actionres = await agent_action.runWithoutRow({
    row: { prompt },
    req,
    user: req.user,
  });
  //console.log("actionres", actionres);
  const run_id = actionres.json.run_id;
  const run = await WorkflowRun.findOne({ id: run_id });
  await agent_action.runWithoutRow({
    row: {
      prompt:
        "Write a description of what you did, for the purposes of a progress report. Write 1-4 sentences. Do not use any tools or write any code",
    },
    req,
    run,
    user: req.user,
  });
  const lastInteraction =
    run.context.interactions[run.context.interactions.length - 1];
  const lastText =
    typeof lastInteraction.content === "string"
      ? lastInteraction.content
      : lastInteraction.content.text
        ? lastInteraction.content.text
        : Array.isArray(lastInteraction.content)
          ? lastInteraction.content[0].text
          : lastInteraction.content;
  await MetaData.create({
    type: "CopilotConstructMgr",
    name: "progress",
    body: { text: lastText, run_id, task_id: md.id },
    user_id: req.user?.id,
  });

  //console.log("run", run);
  await md.update({ body: { ...md.body, status: "Done", run_id } });
  return { reload_page: true };
};

module.exports = { runTask };
