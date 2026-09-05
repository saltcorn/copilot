const { describe, it, expect, beforeEach } = require("@jest/globals");

// Same fake-DB approach as phase-helper.test.js: ChainHelper only touches
// MetaData via simple {type, name}/{id} where-clauses.
jest.mock(
  "@saltcorn/data/models/metadata",
  () => require("./helpers/fake-metadata").FakeMetaData,
  { virtual: true }
);

let mockLlmRun = jest.fn();
jest.mock(
  "@saltcorn/data/db/state",
  () => ({
    getState: () => ({
      log: () => {},
      emitDynamicUpdate: () => {},
      functions: { llm_generate: { run: (...args) => mockLlmRun(...args) } },
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
  "../app-constructor/prompts/prompt-generator",
  () => ({
    PromptGenerator: {
      createInstance: async () => ({
        taskPlanPrompt: () => "prompt",
        taskPlanSystemPrompt: () => "system",
      }),
    },
  }),
  { virtual: true }
);

const { ChainHelper } = require("../app-constructor/phases/chain-helper");
const { FakeMetaData } = require("./helpers/fake-metadata");

const PT = "CopilotConstructMgr:1";
const phase = { idx: 0, name: "Phase 1" };

const toolCallAnswer = (tasks) => ({
  getToolCalls: () => [{ input: { tasks } }],
  total_usage: { total_tokens: 42 },
});

beforeEach(() => {
  FakeMetaData.reset();
  mockLlmRun = jest.fn();
});

describe("ChainHelper.typeGenerationState", () => {
  it("has no tasks and is not marked empty by default", async () => {
    expect(await ChainHelper.typeGenerationState(0, "feature", PT)).toEqual({
      hasTasks: false,
      markedEmpty: false,
    });
  });

  it("reports hasTasks true once a task of that type exists", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "task",
      body: { phase_idx: 0, task_type: "feature" },
    });
    expect(
      (await ChainHelper.typeGenerationState(0, "feature", PT)).hasTasks
    ).toBe(true);
  });

  it.each(["plugin", "data_model", "feature"])(
    "reports markedEmpty true for %s once its generated-empty marker exists",
    async (taskType) => {
      const markerName = `phase_${taskType}_generated`;
      await FakeMetaData.create({
        type: PT,
        name: markerName,
        body: { phase_idx: 0 },
      });
      expect(
        await ChainHelper.typeGenerationState(0, taskType, PT)
      ).toEqual({ hasTasks: false, markedEmpty: true });
    }
  );

  it("does not see another phase's marker", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "phase_feature_generated",
      body: { phase_idx: 1 },
    });
    expect(
      (await ChainHelper.typeGenerationState(0, "feature", PT)).markedEmpty
    ).toBe(false);
  });
});

describe("ChainHelper.generateTasks", () => {
  it("saves only tasks matching the requested task_type, dropping any leaked others", async () => {
    mockLlmRun.mockResolvedValue(
      toolCallAnswer([
        { name: "a", task_type: "feature" },
        { name: "b", task_type: "plugin" },
      ])
    );
    await ChainHelper.generateTasks(phase, 1, "feature", PT);

    const tasks = await FakeMetaData.find({ type: PT, name: "task" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].body.name).toBe("a");
  });

  it("stamps saved tasks with phase_idx, phase_name and project_id", async () => {
    mockLlmRun.mockResolvedValue(
      toolCallAnswer([{ name: "a", task_type: "data_model" }])
    );
    await ChainHelper.generateTasks(phase, 1, "data_model", PT);

    const [task] = await FakeMetaData.find({ type: PT, name: "task" });
    expect(task.body).toMatchObject({
      phase_idx: 0,
      phase_name: "Phase 1",
      project_id: 1,
    });
  });

  it.each(["plugin", "data_model", "feature"])(
    "marks %s as generated-empty when the plan returns zero matching tasks",
    async (taskType) => {
      mockLlmRun.mockResolvedValue(toolCallAnswer([]));
      await ChainHelper.generateTasks(phase, 1, taskType, PT);

      expect(
        await FakeMetaData.findOne({
          type: PT,
          name: `phase_${taskType}_generated`,
        })
      ).toBeDefined();
    }
  );

  it("does not create a generated-empty marker when tasks were produced", async () => {
    mockLlmRun.mockResolvedValue(
      toolCallAnswer([{ name: "a", task_type: "feature" }])
    );
    await ChainHelper.generateTasks(phase, 1, "feature", PT);

    expect(
      await FakeMetaData.findOne({
        type: PT,
        name: "phase_feature_generated",
      })
    ).toBeUndefined();
  });

  it("clears a stale generated-empty marker once new tasks are produced", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "phase_feature_generated",
      body: { phase_idx: 0 },
    });
    mockLlmRun.mockResolvedValue(
      toolCallAnswer([{ name: "a", task_type: "feature" }])
    );
    await ChainHelper.generateTasks(phase, 1, "feature", PT);

    expect(
      await FakeMetaData.findOne({
        type: PT,
        name: "phase_feature_generated",
      })
    ).toBeUndefined();
  });

  it("replaces existing same-type tasks for the phase rather than appending", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "task",
      body: { phase_idx: 0, task_type: "feature", name: "old" },
    });
    mockLlmRun.mockResolvedValue(
      toolCallAnswer([{ name: "new", task_type: "feature" }])
    );
    await ChainHelper.generateTasks(phase, 1, "feature", PT);

    const tasks = await FakeMetaData.find({ type: PT, name: "task" });
    expect(tasks.map((t) => t.body.name)).toEqual(["new"]);
  });

  it("leaves a different phase's same-type tasks untouched", async () => {
    await FakeMetaData.create({
      type: PT,
      name: "task",
      body: { phase_idx: 1, task_type: "feature", name: "other-phase" },
    });
    mockLlmRun.mockResolvedValue(
      toolCallAnswer([{ name: "new", task_type: "feature" }])
    );
    await ChainHelper.generateTasks(phase, 1, "feature", PT);

    const tasks = await FakeMetaData.find({ type: PT, name: "task" });
    expect(tasks.map((t) => t.body.name).sort()).toEqual([
      "new",
      "other-phase",
    ]);
  });

  it("records a progress row with the token usage from the answer", async () => {
    mockLlmRun.mockResolvedValue(
      toolCallAnswer([{ name: "a", task_type: "feature" }])
    );
    await ChainHelper.generateTasks(phase, 1, "feature", PT);

    const progress = await FakeMetaData.findOne({ type: PT, name: "progress" });
    expect(progress.body.token_usage).toEqual({ total_tokens: 42 });
  });

  it("records a failed progress state and does not save tasks when the model returns no tool call", async () => {
    mockLlmRun.mockResolvedValue({ getToolCalls: () => [] });
    await ChainHelper.generateTasks(phase, 1, "feature", PT);

    expect(await FakeMetaData.find({ type: PT, name: "task" })).toHaveLength(
      0
    );
    expect(
      await FakeMetaData.findOne({ type: "CopilotConstructMgr", name: "error" })
    ).toBeDefined();
  });
});
