const { describe, it, expect, beforeEach } = require("@jest/globals");

// PhaseHelper/ChainHelper only ever touch MetaData via simple {type, name}/{id}
// where-clauses, so a tiny in-memory fake stands in for the real DB-backed
// model here - no DB, no plugin install required.
jest.mock(
  "@saltcorn/data/models/metadata",
  () => require("./helpers/fake-metadata").FakeMetaData,
  { virtual: true }
);
jest.mock(
  "@saltcorn/data/db/state",
  () => ({
    getState: () => ({
      log: () => {},
      emitDynamicUpdate: () => {},
      functions: { llm_generate: { run: async () => "" } },
      plugin_cfgs: {},
    }),
  }),
  { virtual: true }
);
jest.mock("@saltcorn/data/db", () => ({ getTenantSchema: () => "public" }), {
  virtual: true,
});
jest.mock("../app-constructor/tools", () => ({ task_tool: {} }), {
  virtual: true,
});
jest.mock("../app-constructor/run_task", () => ({ runTask: jest.fn() }), {
  virtual: true,
});
jest.mock(
  "../app-constructor/prompt-generator",
  () => ({ PromptGenerator: { createInstance: async () => ({}) } }),
  { virtual: true }
);

const { PhaseHelper } = require("../app-constructor/phases/phase-helper");
const { FakeMetaData } = require("./helpers/fake-metadata");

const PT = "CopilotConstructMgr:1";

beforeEach(() => {
  FakeMetaData.reset();
});

const makeTask = (bodyOver = {}) =>
  FakeMetaData.create({
    type: PT,
    name: "task",
    body: {
      phase_idx: 0,
      task_type: "feature",
      status: "To do",
      project_id: 1,
      ...bodyOver,
    },
  });

describe("PhaseHelper.unmetDependencies", () => {
  it("blocks on any not-yet-done dependency by default", async () => {
    await makeTask({ name: "a", status: "To do" });
    const b = await makeTask({
      name: "b",
      depends_on: ["a", "missing"],
      status: "To do",
    });
    expect(await PhaseHelper.unmetDependencies(b.id)).toEqual(["a", "missing"]);
  });

  it("clears once the dependency is Done", async () => {
    await makeTask({ name: "a", status: "Done" });
    const b = await makeTask({
      name: "b",
      depends_on: ["a"],
      status: "To do",
    });
    expect(await PhaseHelper.unmetDependencies(b.id)).toEqual([]);
  });

  it("with sameTypeOnly, only same-type dependency names can block", async () => {
    // "a" is a plugin task done or not is irrelevant to a feature task's
    // same-type check; only deps that are themselves feature-type tasks count.
    await makeTask({ name: "a", task_type: "plugin", status: "To do" });
    const b = await makeTask({
      name: "b",
      task_type: "feature",
      depends_on: ["a"],
      status: "To do",
    });
    expect(
      await PhaseHelper.unmetDependencies(b.id, { sameTypeOnly: true })
    ).toEqual([]);
  });

  it("returns an empty list for a task id that doesn't exist", async () => {
    expect(await PhaseHelper.unmetDependencies(999)).toEqual([]);
  });
});

describe("PhaseHelper.status", () => {
  it("is idle when nothing is happening for the phase", async () => {
    const status = await PhaseHelper.status(0, PT);
    expect(status).toMatchObject({
      active: false,
      isGenerating: false,
      isRunning: false,
    });
  });

  it("is generating when generating_phase_tasks targets this phase", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "generating_phase_tasks",
      body: { phase_idx: 0, task_type: "plugin" },
    });
    const status = await PhaseHelper.status(0, PT);
    expect(status.isGenerating).toBe(true);
    expect(status.active).toBe(true);
    expect(status.taskType).toBe("plugin");
  });

  it("is running when a phase_running_<idx>_<type> flag is present", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "phase_running_0_feature",
      body: { started: Date.now() },
    });
    const status = await PhaseHelper.status(0, PT);
    expect(status.isRunning).toBe(true);
    expect(status.taskType).toBe("feature");
  });

  it("is stopping when a task is still Running but no flag/generation is active", async () => {
    await makeTask({ status: "Running", task_type: "feature" });
    const status = await PhaseHelper.status(0, PT);
    expect(status.isStopping).toBe(true);
    expect(status.isGenerating).toBe(false);
    expect(status.isRunning).toBe(true); // isRunning includes anyRunning
  });

  it("does not see a different phase's state", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "phase_running_1_feature",
      body: { started: Date.now() },
    });
    expect((await PhaseHelper.status(0, PT)).active).toBe(false);
  });
});

describe("PhaseHelper.stop", () => {
  it("deletes the phase's own chain, flags, and generation marker", async () => {
    await FakeMetaData.create({ type: PT, name: "phase_chain_0", body: {} });
    await FakeMetaData.create({
      type: PT,
      name: "phase_running_0_feature",
      body: {},
    });
    await PhaseHelper.stop(0, PT);
    expect(
      await FakeMetaData.findOne({ type: PT, name: "phase_chain_0" })
    ).toBeUndefined();
    expect(
      await FakeMetaData.findOne({ type: PT, name: "phase_running_0_feature" })
    ).toBeUndefined();
  });

  it("only clears all_phases_chain when it points at this phase", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "all_phases_chain",
      body: { phaseIdx: 1 },
    });
    await PhaseHelper.stop(0, PT);
    expect(
      await FakeMetaData.findOne({ type: PT, name: "all_phases_chain" })
    ).toBeDefined();

    await PhaseHelper.stop(1, PT);
    expect(
      await FakeMetaData.findOne({ type: PT, name: "all_phases_chain" })
    ).toBeUndefined();
  });

  it("leaves other phases' rows untouched", async () => {
    await FakeMetaData.create({ type: PT, name: "phase_chain_1", body: {} });
    await PhaseHelper.stop(0, PT);
    expect(
      await FakeMetaData.findOne({ type: PT, name: "phase_chain_1" })
    ).toBeDefined();
  });
});

describe("PhaseHelper.deleteTypeTasks", () => {
  it("deletes only tasks of the given type for this phase", async () => {
    const feature = await makeTask({ task_type: "feature" });
    await makeTask({ task_type: "plugin" });
    await makeTask({ phase_idx: 1, task_type: "feature" });

    await PhaseHelper.deleteTypeTasks(0, PT, "feature");

    const remaining = await FakeMetaData.find({ type: PT, name: "task" });
    expect(remaining.map((t) => t.body.task_type)).toEqual(
      expect.arrayContaining(["plugin", "feature"])
    );
    expect(remaining.find((t) => t.id === feature.id)).toBeUndefined();
  });

  it("also clears the plugin-generated marker when deleting plugin tasks", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "phase_plugin_generated",
      body: { phase_idx: 0 },
    });
    await PhaseHelper.deleteTypeTasks(0, PT, "plugin");
    expect(
      await FakeMetaData.findOne({ type: PT, name: "phase_plugin_generated" })
    ).toBeUndefined();
  });
});

describe("PhaseHelper.cardData", () => {
  it("is not done with no tasks and no generated-empty markers", async () => {
    expect((await PhaseHelper.cardData(0, PT)).allDone).toBe(false);
  });

  it("is done once every task type is Done or marked as not needed", async () => {
    await makeTask({ task_type: "feature", status: "Done" });
    await FakeMetaData.create({
      type: PT,
      name: "phase_plugin_generated",
      body: { phase_idx: 0 },
    });
    await FakeMetaData.create({
      type: PT,
      name: "phase_data_model_generated",
      body: { phase_idx: 0 },
    });
    expect((await PhaseHelper.cardData(0, PT)).allDone).toBe(true);
  });

  it("reports hasFeedback from feedback_pending rows scoped to the phase", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "feedback_pending",
      body: { phase_idx: 0 },
    });
    expect((await PhaseHelper.cardData(0, PT)).hasFeedback).toBe(true);
    expect((await PhaseHelper.cardData(1, PT)).hasFeedback).toBe(false);
  });
});

describe("PhaseHelper.saveRequirement / deleteRequirement", () => {
  beforeEach(async () => {
    await FakeMetaData.create({
      type: PT,
      name: "phases",
      body: { phases: [{ name: "Phase 1", requirements: [] }] },
    });
  });

  it("appends a new requirement", async () => {
    const result = await PhaseHelper.saveRequirement(0, PT, -1, "Do X", 3, 1);
    expect(result).toEqual({ success: true });
    const phasesMd = await FakeMetaData.findOne({ type: PT, name: "phases" });
    expect(phasesMd.body.phases[0].requirements).toEqual([
      { requirement: "Do X", priority: 3 },
    ]);
  });

  it("updates an existing requirement in place", async () => {
    await PhaseHelper.saveRequirement(0, PT, -1, "Do X", 3, 1);
    await PhaseHelper.saveRequirement(0, PT, 0, "Do X better", 5, 1);
    const phasesMd = await FakeMetaData.findOne({ type: PT, name: "phases" });
    expect(phasesMd.body.phases[0].requirements).toEqual([
      { requirement: "Do X better", priority: 5 },
    ]);
  });

  it("marks the phase stale only when it already has tasks", async () => {
    await PhaseHelper.saveRequirement(0, PT, -1, "Do X", 3, 1);
    expect(
      await FakeMetaData.findOne({ type: PT, name: "phase_reqs_changed" })
    ).toBeUndefined();

    await makeTask();
    await PhaseHelper.saveRequirement(0, PT, -1, "Do Y", 2, 1);
    expect(
      await FakeMetaData.findOne({ type: PT, name: "phase_reqs_changed" })
    ).toBeDefined();
  });

  it("errors when the phase does not exist", async () => {
    expect(await PhaseHelper.saveRequirement(5, PT, -1, "Do X", 3, 1)).toEqual({
      error: "Phase not found",
    });
  });

  it("removes a requirement by index", async () => {
    await PhaseHelper.saveRequirement(0, PT, -1, "Do X", 3, 1);
    await PhaseHelper.saveRequirement(0, PT, -1, "Do Y", 2, 1);
    await PhaseHelper.deleteRequirement(0, PT, 0, 1);
    const phasesMd = await FakeMetaData.findOne({ type: PT, name: "phases" });
    expect(phasesMd.body.phases[0].requirements).toEqual([
      { requirement: "Do Y", priority: 2 },
    ]);
  });
});

describe("PhaseHelper.allPhasesStatus", () => {
  it("is inactive with no all_phases_chain row", async () => {
    expect(await PhaseHelper.allPhasesStatus(PT)).toEqual({ active: false });
  });

  it("names the phase and active task type the chain is currently on", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "phases",
      body: { phases: [{ name: "Phase 1" }, { name: "Phase 2" }] },
    });
    await FakeMetaData.create({
      type: PT,
      name: "all_phases_chain",
      body: { phaseIdx: 1, stopped: false },
    });
    await FakeMetaData.create({
      type: PT,
      name: "phase_running_1_data_model",
      body: {},
    });

    const status = await PhaseHelper.allPhasesStatus(PT);
    expect(status).toMatchObject({
      active: true,
      stopped: false,
      idx: 1,
      phaseName: "Phase 2",
      taskType: "data_model",
    });
  });
});
