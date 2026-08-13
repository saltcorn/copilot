const MetaData = require("@saltcorn/data/models/metadata");
const { getState } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const {
  tool_choice,
  projectType,
  BASE_TYPE,
  TASK_TYPE_ORDER,
  genErrorToastMsg,
  missingToolCallError,
} = require("../common");
const { task_tool } = require("../tools");
const { runTask } = require("../run_task");
const { PromptGenerator } = require("../prompt-generator");
const {
  emitChainUpdate,
  emitOverviewUpdate,
  tasksOfType,
  unmetDeps,
} = require("./common");

const TASK_STALE_MS = 30 * 60 * 1000; // agent tasks can legitimately run long
const FLAG_STALE_MS = 10 * 60 * 1000; // well above the default 5-min "Often" tick

/**
 * Drives the "Generate & Run" chain, always reading fresh data so a stop
 * mid-run is noticed. Internal engine used only by PhaseHelper.
 */
class ChainHelper {
  /**
   * Clears the "requirements changed" marker for a phase.
   * @param {number} phaseIdx - phase index
   * @param {string} pt - project type namespace
   */
  static async clearStaleMarker(phaseIdx, pt) {
    const all = await MetaData.find({ type: pt, name: "phase_reqs_changed" });
    for (const m of all.filter((m) => m.body?.phase_idx === phaseIdx))
      await m.delete();
  }

  /**
   * Marks a phase's tasks as stale after its requirements changed.
   * @param {number} phaseIdx - phase index
   * @param {number} userId - user triggering the change
   * @param {string} pt - project type namespace
   */
  static async markStale(phaseIdx, userId, pt) {
    const all = await MetaData.find({ type: pt, name: "phase_reqs_changed" });
    if (!all.some((m) => m.body?.phase_idx === phaseIdx)) {
      await MetaData.create({
        type: pt,
        name: "phase_reqs_changed",
        body: { phase_idx: phaseIdx },
        user_id: userId,
      });
    }
  }

  /**
   * Whether taskType tasks exist yet, or generation ran and found none.
   * @param {number} phaseIdx - phase index
   * @param {string} taskType - task type to check
   * @param {string} pt - project type namespace
   */
  static async typeGenerationState(phaseIdx, taskType, pt) {
    const tasks = await MetaData.find({ type: pt, name: "task" });
    const hasTasks =
      tasksOfType(
        tasks.filter((t) => t.body?.phase_idx === phaseIdx),
        taskType
      ).length > 0;
    let markedEmpty = false;
    if (!hasTasks && (taskType === "plugin" || taskType === "data_model")) {
      const markerName =
        taskType === "plugin"
          ? "phase_plugin_generated"
          : "phase_data_model_generated";
      const markers = await MetaData.find({ type: pt, name: markerName });
      markedEmpty = markers.some((m) => m.body?.phase_idx === phaseIdx);
    }
    return { hasTasks, markedEmpty };
  }

  /**
   * Generates one task type for a phase via the LLM and stores the result.
   * @param {object} phase - phase object (must include idx, name)
   * @param {number} userId - user requesting generation
   * @param {string} taskType - task type to generate
   * @param {string} pt - project type namespace
   */
  static async generateTasks(phase, userId, taskType, pt) {
    const generatingMd = await MetaData.create({
      type: pt,
      name: "generating_phase_tasks",
      body: { phase_idx: phase.idx, task_type: taskType },
      user_id: userId,
    });
    let cancelled = false;
    let failed = false;
    let toastMsg = "";

    try {
      const generator = await PromptGenerator.createInstance({ phase, pt });
      const answer = await getState().functions.llm_generate.run(
        generator.taskPlanPrompt(taskType),
        {
          tools: [task_tool],
          ...tool_choice("plan_tasks"),
          systemPrompt:
            "You are a project manager planning implementation tasks for a Saltcorn application. " +
            "Each task must map to a concrete deliverable (a view, page, trigger, or schema change). " +
            "Keep tasks small and focused.",
        }
      );

      // If cancelled while the LLM was running, bail out without creating tasks
      const stillActive = await MetaData.findOne({
        type: pt,
        name: "generating_phase_tasks",
      });
      if (!stillActive || stillActive.id !== generatingMd.id) {
        cancelled = true;
        return { failed: false, cancelled: true };
      }

      if (typeof answer?.getToolCalls !== "function")
        throw new Error(missingToolCallError());
      const tc = answer.getToolCalls()[0];

      // Remove existing tasks of the relevant type(s) before storing new ones
      const existing = await MetaData.find({
        type: pt,
        name: "task",
      });
      const phaseTasks = existing.filter(
        (t) => t.body?.phase_idx === phase.idx
      );
      for (const t of tasksOfType(phaseTasks, taskType)) await t.delete();

      // Clear any existing "no tasks needed" markers for this phase
      if (taskType === "plugin") {
        const oldMarkers = await MetaData.find({
          type: pt,
          name: "phase_plugin_generated",
        });
        for (const m of oldMarkers.filter(
          (m) => m.body?.phase_idx === phase.idx
        ))
          await m.delete();
      } else if (taskType === "data_model") {
        const oldMarkers = await MetaData.find({
          type: pt,
          name: "phase_data_model_generated",
        });
        for (const m of oldMarkers.filter(
          (m) => m.body?.phase_idx === phase.idx
        ))
          await m.delete();
      }

      const projectId = Number(pt.split(":")[1]);
      for (const task of tc.input.tasks)
        await MetaData.create({
          type: pt,
          name: "task",
          body: {
            ...task,
            phase_idx: phase.idx,
            phase_name: phase.name,
            project_id: projectId,
          },
          user_id: userId,
        });

      await ChainHelper.clearStaleMarker(phase.idx, pt);

      // If generation produced 0 tasks, record that it was considered
      if (
        taskType === "plugin" &&
        tc.input.tasks.filter((t) => t.task_type === "plugin").length === 0
      ) {
        await MetaData.create({
          type: pt,
          name: "phase_plugin_generated",
          body: { phase_idx: phase.idx },
          user_id: userId,
        });
      }
      if (
        taskType === "data_model" &&
        tc.input.tasks.filter((t) => t.task_type === "data_model").length === 0
      ) {
        await MetaData.create({
          type: pt,
          name: "phase_data_model_generated",
          body: { phase_idx: phase.idx },
          user_id: userId,
        });
      }
    } catch (err) {
      const activeOnErr = await MetaData.findOne({
        type: pt,
        name: "generating_phase_tasks",
      }).catch(() => null);
      if (!activeOnErr || activeOnErr.id !== generatingMd.id) {
        cancelled = true;
      }
      if (!cancelled) {
        getState().log(1, "ChainHelper.generateTasks error:", err);
        toastMsg = genErrorToastMsg(err, "Task generation");
        try {
          await MetaData.create({
            type: BASE_TYPE,
            name: "error",
            body: {
              source: "constructor",
              error: {
                message: err?.message || String(err),
                stack: err?.stack,
              },
            },
            user_id: userId,
          });
        } catch (_) {}
        failed = true;
      }
    } finally {
      try {
        await generatingMd.delete();
      } catch (_) {}
      if (!cancelled)
        try {
          getState().emitDynamicUpdate(db.getTenantSchema(), {
            eval_js: failed
              ? `notifyAlert({type:'danger',text:${JSON.stringify(
                  toastMsg
                )}});if(typeof copilotPhaseTasksFailed==='function')copilotPhaseTasksFailed(${
                  phase.idx
                });`
              : `if(typeof copilotPhaseTasksDone==='function')copilotPhaseTasksDone(${phase.idx});`,
          });
        } catch (_) {}
    }
    return { failed, cancelled };
  }

  /**
   * Runs startable tasks of one type until none are left. Always queries
   * live, since a stop() can happen mid-loop while a task is running.
   * @param {number} phaseIdx - phase index
   * @param {string} taskType - task type to run
   * @param {object} req - request-like object (user, __, getLocale)
   * @param {string} pt - project type namespace
   */
  static async startTaskChain(phaseIdx, taskType, req, pt) {
    const flagName = `phase_running_${phaseIdx}_${taskType}`;
    const running = await MetaData.findOne({
      type: pt,
      name: flagName,
    });
    if (!running) {
      try {
        getState().emitDynamicUpdate(db.getTenantSchema(), {
          eval_js: `if(typeof copilotPhaseTasksDone==='function')copilotPhaseTasksDone(${phaseIdx});`,
        });
      } catch (_) {}
      return { failed: false };
    }

    const allTasks = await MetaData.find({
      type: pt,
      name: "task",
    });
    const phaseTasks = allTasks.filter((t) => t.body?.phase_idx === phaseIdx);
    const typedTasks = tasksOfType(phaseTasks, taskType);

    if (typedTasks.some((t) => t.body.status === "Running"))
      return { failed: false };

    const doneNames = new Set(
      phaseTasks.filter((t) => t.body.status === "Done").map((t) => t.body.name)
    );
    // Only block on same-type dependencies; cross-type deps are the user's ordering concern
    const sameTypeNames = new Set(
      typedTasks.map((t) => t.body.name).filter(Boolean)
    );
    const todos = typedTasks.filter(
      (t) => !t.body.status || t.body.status === "To do"
    );
    const startable = todos.filter(
      (t) => unmetDeps(t.body.depends_on, doneNames, sameTypeNames).length === 0
    );

    if (startable[0]) {
      try {
        await runTask(startable[0].id, req);
      } catch (e) {
        getState().log(1, "ChainHelper.startTaskChain error:", e);
        const toastMsg = genErrorToastMsg(e, "Task run");
        try {
          await MetaData.create({
            type: BASE_TYPE,
            name: "error",
            body: {
              source: "constructor",
              error: { message: e?.message || String(e), stack: e?.stack },
            },
          });
        } catch (_) {}
        const runningMd = await MetaData.findOne({ type: pt, name: flagName });
        if (runningMd) await runningMd.delete();
        try {
          getState().emitDynamicUpdate(db.getTenantSchema(), {
            eval_js: `notifyAlert({type:'danger',text:${JSON.stringify(
              toastMsg
            )}});if(typeof copilotPhaseTasksFailed==='function')copilotPhaseTasksFailed(${phaseIdx});`,
          });
        } catch (_) {}
        return { failed: true };
      }
      return await ChainHelper.startTaskChain(phaseIdx, taskType, req, pt);
    } else {
      const runningMd = await MetaData.findOne({
        type: pt,
        name: flagName,
      });
      if (runningMd) await runningMd.delete();
      try {
        getState().emitDynamicUpdate(db.getTenantSchema(), {
          eval_js: `if(typeof copilotPhaseTasksDone==='function')copilotPhaseTasksDone(${phaseIdx});`,
        });
      } catch (_) {}
      return { failed: false };
    }
  }

  /**
   * Whether a task type is currently generating or running for a phase.
   * @param {number} idx - phase index
   * @param {string} taskType - task type to check
   * @param {string} pt - project type namespace
   */
  static async isTypeActive(idx, taskType, pt) {
    const tasks = await MetaData.find({ type: pt, name: "task" });
    if (
      tasksOfType(
        tasks.filter((t) => t.body?.phase_idx === idx),
        taskType
      ).some((t) => t.body.status === "Running")
    )
      return true;
    const generating = await MetaData.findOne({
      type: pt,
      name: "generating_phase_tasks",
    });
    return !!(
      generating &&
      generating.body?.phase_idx === idx &&
      (!generating.body?.task_type || generating.body.task_type === taskType)
    );
  }

  /**
   * Currently active task type for a phase, freshly queried.
   * @param {number} idx - phase index
   * @param {string} pt - project type namespace
   */
  static async activeTaskType(idx, pt) {
    const generating = await MetaData.findOne({
      type: pt,
      name: "generating_phase_tasks",
    });
    if (generating?.body?.phase_idx === idx)
      return generating.body?.task_type || "feature";
    for (const tt of TASK_TYPE_ORDER) {
      const flag = await MetaData.findOne({
        type: pt,
        name: `phase_running_${idx}_${tt}`,
      });
      if (flag) return tt;
    }
    const tasks = await MetaData.find({ type: pt, name: "task" });
    const runningTask = tasks.find(
      (t) => t.body?.phase_idx === idx && t.body?.status === "Running"
    );
    return runningTask?.body?.task_type || "feature";
  }

  /**
   * Runs a phase through plugin, data model, then feature tasks in order.
   * @param {number} idx - phase index
   * @param {object} req - request-like object (user, __, getLocale)
   * @param {string} pt - project type namespace
   */
  static async runPhaseChain(idx, req, pt) {
    while (true) {
      const chain = await MetaData.findOne({
        type: pt,
        name: `phase_chain_${idx}`,
      });
      if (
        !chain ||
        chain.body.stopped ||
        chain.body.typeIdx >= TASK_TYPE_ORDER.length
      ) {
        if (chain) await chain.delete();
        emitChainUpdate(idx);
        emitOverviewUpdate(pt);
        return { aborted: false };
      }

      const taskType = TASK_TYPE_ORDER[chain.body.typeIdx];
      const phasesMd = await MetaData.findOne({ type: pt, name: "phases" });
      const phase = phasesMd?.body?.phases?.[idx];
      if (!phase) {
        await chain.delete();
        emitChainUpdate(idx);
        emitOverviewUpdate(pt);
        return { aborted: false };
      }
      phase.idx = idx;

      emitChainUpdate(idx); // let push clients paint "starting <taskType>" promptly
      emitOverviewUpdate(pt);

      const { hasTasks, markedEmpty } = await ChainHelper.typeGenerationState(
        idx,
        taskType,
        pt
      );
      if (!hasTasks && !markedEmpty) {
        const genResult = await ChainHelper.generateTasks(
          phase,
          req.user?.id,
          taskType,
          pt
        );
        if (genResult?.failed || genResult?.cancelled) {
          // Generation failed - stop here rather than moving to the next type.
          const chainOnFail = await MetaData.findOne({ id: chain.id });
          if (chainOnFail) await chainOnFail.delete();
          emitChainUpdate(idx);
          emitOverviewUpdate(pt);
          return { aborted: true };
        }
      }

      const flagName = `phase_running_${idx}_${taskType}`;
      if (!(await MetaData.findOne({ type: pt, name: flagName }))) {
        await MetaData.create({
          type: pt,
          name: flagName,
          body: { started: Date.now() },
          user_id: req.user?.id,
        });
      }
      const runResult = await ChainHelper.startTaskChain(
        idx,
        taskType,
        req,
        pt
      );
      if (runResult?.failed) {
        // A task failed - stop here rather than moving to the next type.
        const chainOnFail = await MetaData.findOne({
          type: pt,
          name: `phase_chain_${idx}`,
        });
        if (chainOnFail) await chainOnFail.delete();
        emitChainUpdate(idx);
        emitOverviewUpdate(pt);
        return { aborted: true };
      }

      const chainAfter = await MetaData.findOne({ id: chain.id });
      if (!chainAfter || chainAfter.body.stopped) {
        if (chainAfter) await chainAfter.delete();
        emitChainUpdate(idx);
        emitOverviewUpdate(pt);
        return { aborted: false };
      }
      await chainAfter.update({
        body: { ...chainAfter.body, typeIdx: chainAfter.body.typeIdx + 1 },
        written_at: new Date(), // staleness marker read by resumeStuck
      });
    }
  }

  /**
   * Creates the all_phases_chain row if one doesn't already exist.
   * @param {string} pt - project type namespace
   * @param {number} userId - user starting the run
   */
  static async ensureAllPhasesStarted(pt, userId) {
    const existing = await MetaData.findOne({
      type: pt,
      name: "all_phases_chain",
    });
    if (!existing)
      await MetaData.create({
        type: pt,
        name: "all_phases_chain",
        body: { phaseIdx: 0, stopped: false, startedAt: Date.now() },
        user_id: userId,
      });
  }

  /**
   * Runs "Generate & Run" for every phase in order, via runPhaseChain().
   * @param {object} req - request-like object (user, __, getLocale)
   * @param {string} pt - project type namespace
   */
  static async runAllPhasesChain(req, pt) {
    while (true) {
      const chain = await MetaData.findOne({
        type: pt,
        name: "all_phases_chain",
      });
      if (!chain || chain.body.stopped) {
        if (chain) await chain.delete();
        emitOverviewUpdate(pt);
        return;
      }

      const phasesMd = await MetaData.findOne({ type: pt, name: "phases" });
      const phaseCount = phasesMd?.body?.phases?.length || 0;
      const idx = chain.body.phaseIdx;
      if (idx >= phaseCount) {
        await chain.delete();
        emitOverviewUpdate(pt);
        return;
      }

      const phaseChain = await MetaData.findOne({
        type: pt,
        name: `phase_chain_${idx}`,
      });
      if (!phaseChain)
        await MetaData.create({
          type: pt,
          name: `phase_chain_${idx}`,
          body: { typeIdx: 0, stopped: false, startedAt: Date.now() },
          user_id: req.user?.id,
        });
      emitOverviewUpdate(pt); // paint "processing phase N" before runPhaseChain's own (possibly slow) work

      const phaseResult = await ChainHelper.runPhaseChain(idx, req, pt);
      if (phaseResult?.aborted) {
        // The phase failed - stop "Run all phases" here too.
        const chainOnAbort = await MetaData.findOne({ id: chain.id });
        if (chainOnAbort) await chainOnAbort.delete();
        emitOverviewUpdate(pt);
        return;
      }

      const chainAfter = await MetaData.findOne({ id: chain.id });
      if (!chainAfter || chainAfter.body.stopped) {
        if (chainAfter) await chainAfter.delete();
        emitOverviewUpdate(pt);
        return;
      }
      await chainAfter.update({
        body: { ...chainAfter.body, phaseIdx: chainAfter.body.phaseIdx + 1 },
        written_at: new Date(),
      });
    }
  }

  /** Scheduler-driven cleanup: resumes work orphaned by a hard process restart. */
  static async resumeStuck() {
    const projects = await MetaData.find({ type: BASE_TYPE, name: "project" });
    const now = Date.now();
    const syntheticReq = { user: null, __: (s) => s, getLocale: () => "en" };

    for (const project of projects) {
      const pt = projectType(project.id);

      // 1. Un-stick tasks orphaned mid-run (started_at stamped in run_task.js)
      const tasks = await MetaData.find({ type: pt, name: "task" });
      for (const t of tasks) {
        if (
          t.body.status === "Running" &&
          now - (t.body.started_at || 0) > TASK_STALE_MS
        ) {
          await t.update({ body: { ...t.body, status: "To do" } });
        }
      }

      const phasesMd = await MetaData.findOne({ type: pt, name: "phases" });
      const phaseCount = phasesMd?.body?.phases?.length || 0;

      // 2. Resume chains stuck between/within steps
      for (let idx = 0; idx < phaseCount; idx++) {
        const chain = await MetaData.findOne({
          type: pt,
          name: `phase_chain_${idx}`,
        });
        if (!chain || chain.body.stopped) continue;
        if (now - new Date(chain.written_at).getTime() < FLAG_STALE_MS)
          continue;
        const taskType = TASK_TYPE_ORDER[chain.body.typeIdx];
        if (taskType && (await ChainHelper.isTypeActive(idx, taskType, pt)))
          continue; // genuinely still working
        await chain.update({ written_at: new Date() }); // claim, avoid double-fire on an overlapping tick
        // resume via "Run all phases" if that's what's driving this phase
        const allChainForIdx = await MetaData.findOne({
          type: pt,
          name: "all_phases_chain",
        });
        if (
          allChainForIdx &&
          !allChainForIdx.body.stopped &&
          allChainForIdx.body.phaseIdx === idx
        ) {
          ChainHelper.runAllPhasesChain(syntheticReq, pt).catch((e) =>
            getState().log(
              1,
              "ChainHelper.resumeStuck: runAllPhasesChain failed",
              e
            )
          );
        } else {
          ChainHelper.runPhaseChain(idx, syntheticReq, pt).catch((e) =>
            getState().log(
              1,
              "ChainHelper.resumeStuck: runPhaseChain failed",
              e
            )
          );
        }
      }

      // 3. Resume standalone (non-chain) single-type runs stuck the same way
      for (let idx = 0; idx < phaseCount; idx++) {
        for (const taskType of TASK_TYPE_ORDER) {
          const flag = await MetaData.findOne({
            type: pt,
            name: `phase_running_${idx}_${taskType}`,
          });
          if (
            !flag ||
            now - new Date(flag.written_at).getTime() < FLAG_STALE_MS
          )
            continue;
          if (await ChainHelper.isTypeActive(idx, taskType, pt)) continue;
          const chain = await MetaData.findOne({
            type: pt,
            name: `phase_chain_${idx}`,
          });
          if (chain && !chain.body.stopped) continue; // step 2 already owns this one
          await flag.update({ written_at: new Date() });
          ChainHelper.startTaskChain(idx, taskType, syntheticReq, pt).catch(
            (e) =>
              getState().log(
                1,
                "ChainHelper.resumeStuck: startTaskChain failed",
                e
              )
          );
        }
      }

      // 4. Resume "Run all phases" if it died between two phases (step 2 can't catch this)
      const allChain = await MetaData.findOne({
        type: pt,
        name: "all_phases_chain",
      });
      if (
        allChain &&
        !allChain.body.stopped &&
        now - new Date(allChain.written_at).getTime() >= FLAG_STALE_MS
      ) {
        const stillHasPhaseChain = await MetaData.findOne({
          type: pt,
          name: `phase_chain_${allChain.body.phaseIdx}`,
        });
        if (!stillHasPhaseChain) {
          await allChain.update({ written_at: new Date() });
          ChainHelper.runAllPhasesChain(syntheticReq, pt).catch((e) =>
            getState().log(
              1,
              "ChainHelper.resumeStuck: runAllPhasesChain failed",
              e
            )
          );
        }
      }
    }
  }
}

module.exports = { ChainHelper };
