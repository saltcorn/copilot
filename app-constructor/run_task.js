const Table = require("@saltcorn/data/models/table");
const MetaData = require("@saltcorn/data/models/metadata");
const View = require("@saltcorn/data/models/view");
const Page = require("@saltcorn/data/models/page");
const Trigger = require("@saltcorn/data/models/trigger");
const Plugin = require("@saltcorn/data/models/plugin");
const Tag = require("@saltcorn/data/models/tag");
const db = require("@saltcorn/data/db");
const WorkflowRun = require("@saltcorn/data/models/workflow_run");
const { getState } = require("@saltcorn/data/db/state");
const { viewname, TaskType, projectType, BASE_TYPE } = require("./common");
const { PromptGenerator } = require("./prompt-generator");

const getOrCreatePhaseTag = async (phaseIdx, projectName) => {
  const tagName = `${projectName} Phase ${phaseIdx + 1}`;
  const existing = await Tag.findOne({ name: tagName });
  if (existing) return existing;
  return await Tag.create({ name: tagName });
};

/**
 * @param {number} md_id - MetaData id of the task to run
 * @param {object} req - Express request (may be empty `{}` from scheduler)
 */
const runTask = async (md_id, req) => {
  const md = await MetaData.findOne({
    id: md_id,
  });

  if (!md) return { error: "Task not found" };

  const taskType = md.body.task_type || TaskType.FEATURE;
  const projectMd = await MetaData.findOne({
    type: BASE_TYPE,
    name: "project",
    id: md.body.project_id,
  });
  const projectName = projectMd?.body?.name || "Project";

  const agent_action = new Trigger({
    action: "Agent",
    when_trigger: "Never",
    configuration: {
      viewname: viewname,
      sys_prompt:
        taskType === TaskType.PLUGIN
          ? "Each task installs exactly one plugin from the Saltcorn plugin store. " +
            "Use the Install Plugin skill to find and install it. Call the skill once and then stop."
          : taskType === TaskType.DATA_MODEL
          ? "Each task creates or modifies database tables/fields or configures platform-level settings (such as custom roles). " +
            "Use the database design tool for schema changes. Use the Registry editor (set_entity) for platform configuration such as creating custom roles. " +
            "Call only the tools needed for the task and then stop. Do not create any views, pages, or triggers."
          : "Each task creates exactly one primary artifact: one view, one page, or one workflow trigger. " +
            "Never create more than one view or page per task, even if the description mentions multiple. " +
            "Exception: if the task description explicitly says to both create a workflow trigger AND update an existing view to add an action button for it, do both — create the workflow first, then update the specified view. " +
            "After completing the primary artifact (and the explicitly described action button update, if any), stop.",
      prompt: "{{prompt}}",
      skills:
        taskType === TaskType.PLUGIN
          ? [{ skill_type: "Install Plugin", yoloMode: true }]
          : taskType === TaskType.DATA_MODEL
          ? [
              { skill_type: "Database design", yoloMode: true },
              { skill_type: "Registry editor", yoloMode: true },
            ]
          : [
              { skill_type: "Generate Page", yoloMode: true },
              { skill_type: "Generate Workflow", yoloMode: true },
              { skill_type: "Generate trigger", yoloMode: true },
              { skill_type: "Generate View", yoloMode: true },
              { skill_type: "Install Plugin", yoloMode: true },
              { skill_type: "Registry editor", yoloMode: true },
            ],
    },
  });

  const pt = projectType(md.body.project_id);
  const generator = await PromptGenerator.createInstance({ pt });
  if (!generator.spec) return { error: "Specification not found" };
  const prompt = generator.taskExecPrompt(taskType, md.body.description);

  const safeReq =
    req?.__ && req?.getLocale
      ? req
      : {
          ...req,
          __: req?.__ || ((s) => s),
          getLocale: req?.getLocale || (() => "en"),
          user: req?.user,
        };

  const tableNamesBefore =
    taskType === TaskType.DATA_MODEL
      ? new Set((await Table.find({})).map((t) => t.name))
      : null;
  const viewNamesBefore =
    taskType === TaskType.FEATURE && md.body.phase_idx !== undefined
      ? new Set((await View.find({})).map((v) => v.name))
      : null;
  const pageNamesBefore =
    taskType === TaskType.FEATURE && md.body.phase_idx !== undefined
      ? new Set((await Page.find({})).map((p) => p.name))
      : null;
  const triggerNamesBefore =
    taskType === TaskType.FEATURE && md.body.phase_idx !== undefined
      ? new Set((await Trigger.find({})).map((t) => t.name))
      : null;
  const pluginNamesBefore =
    taskType === TaskType.PLUGIN && md.body.phase_idx !== undefined
      ? new Set((await Plugin.find({})).map((p) => p.name))
      : null;

  await md.update({
    body: { ...md.body, status: "Running", started_at: Date.now() },
  });
  try {
    getState().emitDynamicUpdate(db.getTenantSchema(), {
      eval_js:
        "if(typeof copilotRefreshTasks==='function')copilotRefreshTasks();",
    });
  } catch (_) {}
  try {
    const actionres = await agent_action.runWithoutRow({
      row: { prompt },
      req: safeReq,
      user: safeReq.user,
    });
    const run_id = actionres.json.run_id;
    const run = await WorkflowRun.findOne({ id: run_id });

    // The task's real work is already done at this point (actionres above) -
    // this second call only writes a nicer human-readable summary for the
    // progress log. A transient failure here (e.g. an LLM API hiccup)
    // shouldn't undo a task that actually succeeded, so it's isolated in its
    // own try/catch with a plain fallback instead of failing the whole task.
    let lastText = "";
    try {
      await agent_action.runWithoutRow({
        row: {
          prompt:
            "Write a description of what you did, for the purposes of a progress report. Write 1-4 sentences. Do not use any tools or write any code",
        },
        req: safeReq,
        run,
        user: safeReq.user,
      });
      const updatedRun = await WorkflowRun.findOne({ id: run_id });
      const extractText = (content) => {
        if (!content) return "";
        if (typeof content === "string") return content;
        if (
          typeof content === "object" &&
          !Array.isArray(content) &&
          content.text
        )
          return content.text;
        if (Array.isArray(content)) {
          const tb = content.find((b) => b?.type === "text" && b?.text);
          return tb?.text || "";
        }
        return "";
      };
      const interactions = updatedRun.context.interactions || [];
      for (let i = interactions.length - 1; i >= 0; i--) {
        const t = extractText(interactions[i]?.content);
        if (t) {
          lastText = t;
          break;
        }
      }
    } catch (e) {
      getState().log(
        1,
        "runTask: progress-description generation failed (non-fatal):",
        e
      );
    }
    if (!lastText) lastText = md.body.description || md.body.name || "";
    await MetaData.create({
      type: pt,
      name: "progress",
      body: {
        text: lastText,
        run_id,
        task_id: md.id,
        phase_idx: md.body.phase_idx ?? null,
      },
      user_id: req?.user?.id,
    });
    await md.update({ body: { ...md.body, status: "Done", run_id } });
    if (
      taskType === TaskType.DATA_MODEL &&
      tableNamesBefore &&
      md.body.phase_idx !== undefined
    ) {
      const tablesAfter = await Table.find({});
      const newTables = tablesAfter.filter(
        (t) => !t.name.startsWith("_sc_") && !tableNamesBefore.has(t.name)
      );
      for (const table of newTables) {
        await MetaData.create({
          type: pt,
          name: "table_phase",
          body: {
            table_name: table.name,
            phase_idx: md.body.phase_idx,
            phase_name: md.body.phase_name,
          },
          user_id: req?.user?.id,
        });
      }
      if (newTables.length) {
        try {
          const tag = await getOrCreatePhaseTag(md.body.phase_idx, projectName);
          for (const t of newTables) await tag.addEntry({ table_id: t.id });
        } catch (e) {
          console.warn("phase tag update failed:", e.message);
        }
      }
    }
    if (
      taskType === TaskType.PLUGIN &&
      pluginNamesBefore &&
      md.body.phase_idx !== undefined
    ) {
      const pluginsAfter = await Plugin.find({});
      for (const p of pluginsAfter.filter(
        (p) => !pluginNamesBefore.has(p.name)
      )) {
        await MetaData.create({
          type: pt,
          name: "plugin_phase",
          body: {
            plugin_name: p.name,
            phase_idx: md.body.phase_idx,
            phase_name: md.body.phase_name,
          },
          user_id: req?.user?.id,
        });
      }
    }
    if (
      taskType === TaskType.FEATURE &&
      viewNamesBefore &&
      md.body.phase_idx !== undefined
    ) {
      const viewsAfter = await View.find({});
      const newViews = viewsAfter.filter((v) => !viewNamesBefore.has(v.name));
      for (const v of newViews) {
        await MetaData.create({
          type: pt,
          name: "view_phase",
          body: {
            view_name: v.name,
            viewtemplate: v.viewtemplate,
            phase_idx: md.body.phase_idx,
            phase_name: md.body.phase_name,
          },
          user_id: req?.user?.id,
        });
      }
      const pagesAfter = await Page.find({});
      const newPages = pagesAfter.filter((p) => !pageNamesBefore.has(p.name));
      for (const p of newPages) {
        await MetaData.create({
          type: pt,
          name: "view_phase",
          body: {
            view_name: p.name,
            viewtemplate: "page",
            phase_idx: md.body.phase_idx,
            phase_name: md.body.phase_name,
          },
          user_id: req?.user?.id,
        });
      }
      const triggersAfter = await Trigger.find({});
      const newTriggers = triggersAfter.filter(
        (t) => !triggerNamesBefore.has(t.name)
      );
      if (newViews.length || newPages.length || newTriggers.length) {
        try {
          const tag = await getOrCreatePhaseTag(md.body.phase_idx, projectName);
          for (const v of newViews) await tag.addEntry({ view_id: v.id });
          for (const p of newPages) await tag.addEntry({ page_id: p.id });
          for (const t of newTriggers) await tag.addEntry({ trigger_id: t.id });
        } catch (e) {
          console.warn("phase tag update failed:", e.message);
        }
      }
    }
    try {
      const phaseIdx = md.body.phase_idx;
      getState().emitDynamicUpdate(db.getTenantSchema(), {
        eval_js:
          "if(typeof copilotRefreshTasks==='function')copilotRefreshTasks();" +
          (taskType === TaskType.DATA_MODEL
            ? "if(typeof copilotRefreshSchema==='function')copilotRefreshSchema();"
            : "") +
          (phaseIdx != null
            ? `if(typeof copilotRefreshPhaseProgress==='function')copilotRefreshPhaseProgress(${phaseIdx});`
            : ""),
      });
    } catch (_) {}
  } catch (e) {
    await md.update({ body: { ...md.body, status: "To do" } });
    throw e;
  }
};

module.exports = { runTask };
