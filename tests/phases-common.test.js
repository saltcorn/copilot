const { describe, it, expect, afterEach } = require("@jest/globals");

const mockGetState = jest.fn();
jest.mock(
  "@saltcorn/data/db/state",
  () => ({ getState: (...args) => mockGetState(...args) }),
  { virtual: true }
);
jest.mock("@saltcorn/data/db", () => ({ getTenantSchema: () => "public" }), {
  virtual: true,
});

const {
  tasksOfType,
  allTasksDone,
  unmetDeps,
  emitChainUpdate,
  emitOverviewUpdate,
} = require("../app-constructor/phases/common");

const task = (task_type, status) => ({ body: { task_type, status } });

describe("tasksOfType", () => {
  it("filters tasks by task_type", () => {
    const tasks = [task("plugin"), task("feature"), task("data_model")];
    expect(tasksOfType(tasks, "plugin")).toEqual([tasks[0]]);
    expect(tasksOfType(tasks, "data_model")).toEqual([tasks[2]]);
  });

  it("treats a missing task_type as 'feature'", () => {
    const untyped = task(undefined);
    expect(tasksOfType([untyped], "feature")).toEqual([untyped]);
  });
});

describe("allTasksDone", () => {
  it("is false for an empty list - nothing to do is not 'done'", () => {
    expect(allTasksDone([])).toBe(false);
  });

  it("is true only when every task is Done", () => {
    expect(
      allTasksDone([task("feature", "Done"), task("feature", "Done")])
    ).toBe(true);
  });

  it("is false when any task is not Done", () => {
    expect(
      allTasksDone([task("feature", "Done"), task("feature", "To do")])
    ).toBe(false);
  });
});

describe("unmetDeps", () => {
  it("returns dependency names that are not yet done", () => {
    expect(unmetDeps(["a", "b", "c"], new Set(["a"]))).toEqual(["b", "c"]);
  });

  it("returns an empty list when there are no dependencies", () => {
    expect(unmetDeps(undefined, new Set())).toEqual([]);
    expect(unmetDeps([], new Set(["a"]))).toEqual([]);
  });

  it("returns nothing once every dependency is done", () => {
    expect(unmetDeps(["a", "b"], new Set(["a", "b"]))).toEqual([]);
  });

  it("with restrictTo, only deps in that set can block", () => {
    // Mirrors the automatic queue's same-type-only rule: "b" is unmet but
    // belongs to a different task type, so it's not allowed to block.
    expect(unmetDeps(["a", "b"], new Set(), new Set(["a"]))).toEqual(["a"]);
  });
});

describe("emitChainUpdate / emitOverviewUpdate", () => {
  afterEach(() => mockGetState.mockReset());

  it("pushes a dynamic update naming the phase index", () => {
    const emitDynamicUpdate = jest.fn();
    mockGetState.mockReturnValue({ emitDynamicUpdate });
    emitChainUpdate(2);
    expect(emitDynamicUpdate).toHaveBeenCalledWith(
      "public",
      expect.objectContaining({
        eval_js: expect.stringContaining("copilotPhaseChainUpdate(2)"),
      })
    );
  });

  it("never throws, even if getState is unavailable", () => {
    mockGetState.mockImplementation(() => {
      throw new Error("no state yet");
    });
    expect(() => emitChainUpdate(0)).not.toThrow();
    expect(() => emitOverviewUpdate("CopilotConstructMgr:1")).not.toThrow();
  });
});
