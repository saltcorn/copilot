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
const { PromptGenerator } = require("../prompt-generator");
const {
  tasksOfType,
  allTasksDone,
  unmetDeps,
  phases_tool,
} = require("./common");
const { ChainHelper } = require("./chain-helper");

/**
 * Static namespace for phase operations - always queries MetaData live, no
 * cached state. The "Generate & Run" iteration lives in ChainHelper, used
 * only from here; index.js/view.js/tasks.js call PhaseHelper, never ChainHelper.
 */
class PhaseHelper {
  /**
   * Status for one phase: busy/generating/running/stopping + active type.
   * @param {number} idx - phase index
   * @param {string} pt - project type namespace
   */
  static async status(idx, pt) {
    const [generatingMd, allTasks, ...runFlags] = await Promise.all([
      MetaData.findOne({ type: pt, name: "generating_phase_tasks" }),
      MetaData.find({ type: pt, name: "task" }),
      ...TASK_TYPE_ORDER.map((tt) =>
        MetaData.findOne({ type: pt, name: `phase_running_${idx}_${tt}` })
      ),
    ]);
    const anyRunning = allTasks.some(
      (t) => t.body?.phase_idx === idx && t.body?.status === "Running"
    );
    const isGenerating = generatingMd?.body?.phase_idx === idx;
    const isRunning = runFlags.some(Boolean);
    const isBusy = isGenerating || isRunning || anyRunning;
    return {
      active: isBusy,
      isBusy,
      isGenerating,
      isRunning: isRunning || anyRunning,
      // stop() ran but the in-flight task hasn't finished yet
      isStopping: !isRunning && !isGenerating && anyRunning,
      taskType: await ChainHelper.activeTaskType(idx, pt),
    };
  }

  /**
   * Starts (or resumes) this phase's "Generate & Run" chain.
   * @param {number} idx - phase index
   * @param {string} pt - project type namespace
   * @param {object} req - request-like object (user, __, getLocale)
   */
  static async start(idx, pt, req) {
    const existing = await MetaData.findOne({
      type: pt,
      name: `phase_chain_${idx}`,
    });
    if (!existing) {
      await MetaData.create({
        type: pt,
        name: `phase_chain_${idx}`,
        body: { typeIdx: 0, stopped: false, startedAt: Date.now() },
        user_id: req.user?.id,
      });
    }
    ChainHelper.runPhaseChain(idx, req, pt).catch((e) =>
      getState().log(1, "PhaseHelper.start error:", e)
    );
  }

  /**
   * Stops this phase, live from MetaData. Deletes rows outright rather than
   * marking stopped, since the in-flight LLM/task call can't be aborted.
   * @param {number} idx - phase index
   * @param {string} pt - project type namespace
   */
  static async stop(idx, pt) {
    const [chainMd, allChainMd, generatingMd, ...runFlags] = await Promise.all([
      MetaData.findOne({ type: pt, name: `phase_chain_${idx}` }),
      MetaData.findOne({ type: pt, name: "all_phases_chain" }),
      MetaData.findOne({ type: pt, name: "generating_phase_tasks" }),
      ...TASK_TYPE_ORDER.map((tt) =>
        MetaData.findOne({ type: pt, name: `phase_running_${idx}_${tt}` })
      ),
    ]);

    if (chainMd) await chainMd.delete();
    if (allChainMd?.body.phaseIdx === idx) await allChainMd.delete();

    if (generatingMd?.body?.phase_idx === idx) {
      await generatingMd.delete();
      return;
    }
    const runningFlag = runFlags.find(Boolean);
    if (runningFlag) await runningFlag.delete();
  }

  /**
   * Starts (or resumes) "Run all phases" project-wide.
   * @param {string} pt - project type namespace
   * @param {number} userId - user starting the run
   * @param {object} req - request-like object (user, __, getLocale)
   */
  static async startAll(pt, userId, req) {
    await ChainHelper.ensureAllPhasesStarted(pt, userId);
    ChainHelper.runAllPhasesChain(req, pt).catch((e) =>
      getState().log(1, "PhaseHelper.startAll error:", e)
    );
  }

  /**
   * Project-wide "Run all phases" state - not standalone per-phase runs.
   * @param {string} pt - project type namespace
   */
  static async allPhasesStatus(pt) {
    const chain = await MetaData.findOne({
      type: pt,
      name: "all_phases_chain",
    });
    if (!chain) return { active: false };
    const phasesMd = await MetaData.findOne({ type: pt, name: "phases" });
    const phases = phasesMd?.body?.phases || [];
    const idx = chain.body.phaseIdx;
    const taskType =
      idx < phases.length ? await ChainHelper.activeTaskType(idx, pt) : null;
    return {
      active: true,
      stopped: !!chain.body.stopped,
      idx,
      phaseName: phases[idx]?.name || `Phase ${idx + 1}`,
      taskType,
    };
  }

  /**
   * Cancels an in-flight generation, independent of any chain.
   * @param {number} idx - phase index
   * @param {string} pt - project type namespace
   * @param {string} taskType - task type being generated
   */
  static async cancelGenerating(idx, pt, taskType) {
    const generatingMd = await MetaData.findOne({
      type: pt,
      name: "generating_phase_tasks",
    });
    if (
      generatingMd &&
      generatingMd.body?.phase_idx === idx &&
      (!generatingMd.body?.task_type ||
        generatingMd.body?.task_type === taskType)
    ) {
      await generatingMd.delete();
    }
  }

  /**
   * Starts one task type's queue for a phase.
   * @param {number} idx - phase index
   * @param {string} taskType - task type to run
   * @param {object} req - request-like object (user, __, getLocale)
   * @param {string} pt - project type namespace
   */
  static async startTaskChain(idx, taskType, req, pt) {
    return ChainHelper.startTaskChain(idx, taskType, req, pt);
  }

  /**
   * Generates one task type for a phase via the LLM.
   * @param {object} phase - phase object (must include idx)
   * @param {number} userId - user requesting generation
   * @param {string} taskType - task type to generate
   * @param {string} pt - project type namespace
   */
  static async generateTasks(phase, userId, taskType, pt) {
    return ChainHelper.generateTasks(phase, userId, taskType, pt);
  }

  /**
   * Whether taskType tasks exist yet, or generation ran and found none.
   * @param {number} idx - phase index
   * @param {string} taskType - task type to check
   * @param {string} pt - project type namespace
   */
  static async typeGenerationState(idx, taskType, pt) {
    return ChainHelper.typeGenerationState(idx, taskType, pt);
  }

  /**
   * Clears the "requirements changed" marker for a phase.
   * @param {number} idx - phase index
   * @param {string} pt - project type namespace
   */
  static async clearStaleMarker(idx, pt) {
    return ChainHelper.clearStaleMarker(idx, pt);
  }

  /** Scheduler-driven cleanup: resumes work orphaned by a hard process restart. */
  static async resumeStuck() {
    return ChainHelper.resumeStuck();
  }

  /**
   * Deletes all tasks (and related markers) of one type for this phase.
   * @param {number} idx - phase index
   * @param {string} pt - project type namespace
   * @param {string} taskType - task type to delete
   */
  static async deleteTypeTasks(idx, pt, taskType) {
    const allTasks = await MetaData.find({ type: pt, name: "task" });
    for (const t of allTasks) {
      if (
        t.body?.phase_idx === idx &&
        (t.body?.task_type || "feature") === taskType
      )
        await t.delete();
    }
    if (taskType === "plugin") {
      const markers = await MetaData.find({
        type: pt,
        name: "phase_plugin_generated",
      });
      for (const m of markers.filter((m) => m.body?.phase_idx === idx))
        await m.delete();
      const pluginPhase = await MetaData.find({
        type: pt,
        name: "plugin_phase",
      });
      for (const m of pluginPhase.filter((m) => m.body?.phase_idx === idx))
        await m.delete();
    }
    if (taskType === "data_model") {
      const tablePhase = await MetaData.find({
        type: pt,
        name: "table_phase",
      });
      for (const m of tablePhase.filter((m) => m.body?.phase_idx === idx))
        await m.delete();
      const dmMarkers = await MetaData.find({
        type: pt,
        name: "phase_data_model_generated",
      });
      for (const m of dmMarkers.filter((m) => m.body?.phase_idx === idx))
        await m.delete();
    }
    if (taskType === "feature") {
      const viewPhase = await MetaData.find({
        type: pt,
        name: "view_phase",
      });
      for (const m of viewPhase.filter((m) => m.body?.phase_idx === idx))
        await m.delete();
    }
  }

  /**
   * Whether this phase's tasks are all done and whether it has feedback,
   * for repainting a single phase card without reloading the whole list.
   * @param {number} idx - phase index
   * @param {string} pt - project type namespace
   */
  static async cardData(idx, pt) {
    const allTasks = await MetaData.find({ type: pt, name: "task" });
    const phaseTasks = allTasks.filter((t) => t.body?.phase_idx === idx);
    const [pluginMarkers, dmMarkers, fbMds] = await Promise.all([
      MetaData.find({ type: pt, name: "phase_plugin_generated" }),
      MetaData.find({ type: pt, name: "phase_data_model_generated" }),
      MetaData.find({ type: pt, name: "feedback_pending" }).catch(() => []),
    ]);
    const pluginOk =
      pluginMarkers.some((m) => m.body?.phase_idx === idx) ||
      allTasksDone(tasksOfType(phaseTasks, "plugin"));
    const dmOk =
      dmMarkers.some((m) => m.body?.phase_idx === idx) ||
      allTasksDone(tasksOfType(phaseTasks, "data_model"));
    const allDone =
      dmOk && allTasksDone(tasksOfType(phaseTasks, "feature")) && pluginOk;
    const hasFeedback = fbMds.some((r) => r.body?.phase_idx === idx);
    return { allDone, hasFeedback };
  }

  /**
   * Adds or updates one requirement on this phase.
   * @param {number} idx - phase index
   * @param {string} pt - project type namespace
   * @param {number} reqIdx - requirement index, or out of range to append
   * @param {string} requirement - requirement text
   * @param {number} priority - requirement priority (1-5)
   * @param {number} userId - user making the change
   */
  static async saveRequirement(idx, pt, reqIdx, requirement, priority, userId) {
    const phasesMd = await MetaData.findOne({
      type: pt,
      name: "phases",
    });
    if (!phasesMd) return { error: "Phases not found" };

    const phases = phasesMd.body.phases || [];
    if (!phases[idx]) return { error: "Phase not found" };

    const reqs = phases[idx].requirements || [];
    if (reqIdx >= 0 && reqIdx < reqs.length) {
      reqs[reqIdx] = { requirement, priority: parseInt(priority) };
    } else {
      reqs.push({ requirement, priority: parseInt(priority) });
    }
    phases[idx].requirements = reqs;
    await phasesMd.update({ body: { ...phasesMd.body, phases } });

    const hasTasks = (await MetaData.find({ type: pt, name: "task" })).some(
      (t) => t.body?.phase_idx === idx
    );
    if (hasTasks) await ChainHelper.markStale(idx, userId, pt);

    return { success: true };
  }

  /**
   * Removes one requirement from this phase.
   * @param {number} idx - phase index
   * @param {string} pt - project type namespace
   * @param {number} reqIdx - requirement index to remove
   * @param {number} userId - user making the change
   */
  static async deleteRequirement(idx, pt, reqIdx, userId) {
    const phasesMd = await MetaData.findOne({
      type: pt,
      name: "phases",
    });
    if (!phasesMd) return { error: "Phases not found" };

    const phases = phasesMd.body.phases || [];
    if (!phases[idx]) return { error: "Phase not found" };

    const reqs = phases[idx].requirements || [];
    reqs.splice(reqIdx, 1);
    phases[idx].requirements = reqs;
    await phasesMd.update({ body: { ...phasesMd.body, phases } });

    const hasTasks = (await MetaData.find({ type: pt, name: "task" })).some(
      (t) => t.body?.phase_idx === idx
    );
    if (hasTasks) await ChainHelper.markStale(idx, userId, pt);

    return { success: true };
  }

  /**
   * Names of this task's dependencies that aren't done yet.
   * @param {number} taskId - MetaData id of the task
   * @param {object} [options]
   * @param {boolean} [options.sameTypeOnly] - only count same-type dependencies
   */
  static async unmetDependencies(taskId, { sameTypeOnly = false } = {}) {
    const task = await MetaData.findOne({ id: taskId });
    if (!task) return [];
    const pt = projectType(task.body.project_id);
    const allTasks = await MetaData.find({ type: pt, name: "task" });

    if (!sameTypeOnly) {
      const doneNames = new Set(
        allTasks.filter((t) => t.body.status === "Done").map((t) => t.body.name)
      );
      return unmetDeps(task.body.depends_on, doneNames);
    }

    const phaseTasks = allTasks.filter(
      (t) => t.body?.phase_idx === task.body.phase_idx
    );
    const doneNames = new Set(
      phaseTasks.filter((t) => t.body.status === "Done").map((t) => t.body.name)
    );
    const sameTypeNames = new Set(
      tasksOfType(phaseTasks, task.body.task_type || "feature")
        .map((t) => t.body.name)
        .filter(Boolean)
    );
    return unmetDeps(task.body.depends_on, doneNames, sameTypeNames);
  }

  /**
   * Deletes all feedback entries tied to a phase, along with their research.
   * @param {string} pt - project type namespace
   */
  static async deletePhaseScopedFeedback(pt) {
    for (const name of ["feedback_pending", "feedback"]) {
      const records = await MetaData.find({ type: pt, name });
      for (const r of records.filter((r) => r.body?.phase_idx != null)) {
        const research = await MetaData.findOne({
          type: pt,
          name: `feedback_research_${r.id}`,
        });
        if (research) await research.delete();
        await r.delete();
      }
    }
  }

  /**
   * Generates the phase list for a project via the LLM.
   * @param {number} userId - user requesting generation
   * @param {string} pt - project type namespace
   */
  static async generatePhases(userId, pt) {
    // clear any leftover error from a previous failed attempt
    const oldErr = await MetaData.findOne({
      type: pt,
      name: "phases_gen_error",
    });
    if (oldErr) await oldErr.delete();

    const generatingMd = await MetaData.create({
      type: pt,
      name: "generating_phases",
      body: {},
      user_id: userId,
    });
    let failed = false;
    let toastMsg = "";
    try {
      const generator = await PromptGenerator.createInstance({ pt });
      if (!generator.spec) throw new Error("Specification not found");
      const answer = await getState().functions.llm_generate.run(
        generator.phasesPlanPrompt(),
        {
          tools: [phases_tool],
          ...tool_choice("set_phases"),
          systemPrompt:
            "You are a senior software architect and project manager. " +
            "Break the application into logical delivery phases, each containing the requirements that belong to that phase. " +
            "Only include what is explicitly stated in the specification — do not infer or add plausible extras.",
        }
      );

      if (typeof answer?.getToolCalls !== "function")
        throw new Error(missingToolCallError());
      const tc = answer.getToolCalls()[0];

      // Delete all phase tasks and phase-scoped feedback before replacing phases
      // (phase indices will shift, making both stale)
      const allTasks = await MetaData.find({
        type: pt,
        name: "task",
      });
      for (const t of allTasks.filter((t) => t.body?.phase_idx !== undefined))
        await t.delete();
      await PhaseHelper.deletePhaseScopedFeedback(pt);

      const existing = await MetaData.findOne({
        type: pt,
        name: "phases",
      });
      if (existing) {
        await existing.update({ body: { phases: tc.input.phases } });
      } else {
        await MetaData.create({
          type: pt,
          name: "phases",
          body: { phases: tc.input.phases },
          user_id: userId,
        });
      }
    } catch (err) {
      getState().log(1, "PhaseHelper.generatePhases error:", err);
      toastMsg = genErrorToastMsg(err, "Phase generation");
      failed = true;
      try {
        await MetaData.create({
          type: pt,
          name: "phases_gen_error",
          body: { message: toastMsg },
          user_id: userId,
        });
      } catch (_) {}
      try {
        await MetaData.create({
          type: BASE_TYPE,
          name: "error",
          body: {
            source: "constructor",
            error: { message: err?.message || String(err), stack: err?.stack },
          },
          user_id: userId,
        });
      } catch (_) {}
    } finally {
      await generatingMd.delete();
      try {
        getState().emitDynamicUpdate(db.getTenantSchema(), {
          eval_js: failed
            ? `notifyAlert({type:'danger',text:${JSON.stringify(
                toastMsg
              )}});if(typeof copilotRefreshPhases==='function')copilotRefreshPhases();`
            : "if(typeof copilotRefreshPhases==='function')copilotRefreshPhases();",
        });
      } catch (_) {}
    }
  }

  /**
   * Deletes every phase, task, and phase-scoped marker for a project.
   * @param {string} pt - project type namespace
   */
  static async deleteAllPhases(pt) {
    const allTasks = await MetaData.find({
      type: pt,
      name: "task",
    });
    for (const t of allTasks.filter((t) => t.body?.phase_idx !== undefined))
      await t.delete();
    await PhaseHelper.deletePhaseScopedFeedback(pt);
    for (const name of [
      "phase_plugin_generated",
      "table_phase",
      "view_phase",
      "plugin_phase",
    ]) {
      const markers = await MetaData.find({ type: pt, name });
      for (const m of markers) await m.delete();
    }
    const phasesMd = await MetaData.findOne({
      type: pt,
      name: "phases",
    });
    if (phasesMd) await phasesMd.delete();
  }
}

module.exports = { PhaseHelper };
