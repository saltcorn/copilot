const { describe, it, expect, afterEach } = require("@jest/globals");

const mockGetState = jest.fn();
jest.mock(
  "@saltcorn/data/db/state",
  () => ({ getState: (...args) => mockGetState(...args) }),
  { virtual: true }
);

const {
  tool_choice,
  TaskType,
  TASK_TYPE_ORDER,
  projectType,
  BASE_TYPE,
  getPt,
  genErrorToastMsg,
  missingToolCallError,
} = require("../app-constructor/common");

describe("tool_choice", () => {
  it("forces a specific function tool", () => {
    expect(tool_choice("plan_tasks")).toEqual({
      tool_choice: { type: "function", function: { name: "plan_tasks" } },
    });
  });
});

describe("projectType / getPt", () => {
  it("namespaces a project id under the base type", () => {
    expect(projectType(7)).toBe(`${BASE_TYPE}:7`);
  });

  it("prefers project_id from the POST body over the query string", () => {
    expect(getPt({ project_id: 3 }, { query: { project_id: 9 } })).toBe(
      projectType(3)
    );
  });

  it("falls back to the query string when the body has none", () => {
    expect(getPt({}, { query: { project_id: 9 } })).toBe(projectType(9));
  });
});

describe("TASK_TYPE_ORDER", () => {
  it("runs plugin, then data model, then feature", () => {
    expect(TASK_TYPE_ORDER).toEqual([
      TaskType.PLUGIN,
      TaskType.DATA_MODEL,
      TaskType.FEATURE,
    ]);
  });
});

describe("genErrorToastMsg", () => {
  it("reports the HTTP status code for an API error", () => {
    expect(genErrorToastMsg({ statusCode: 503 }, "Task run")).toBe(
      "Task run failed: API error (HTTP 503)"
    );
  });

  it("reads the status code from a nested lastError", () => {
    expect(
      genErrorToastMsg({ lastError: { statusCode: 429 } }, "Task run")
    ).toBe("Task run failed: API error (HTTP 429)");
  });

  it("reads the status code from an errors[] array", () => {
    expect(
      genErrorToastMsg({ errors: [{ statusCode: 400 }] }, "Task run")
    ).toBe("Task run failed: API error (HTTP 400)");
  });

  it("collapses whitespace in a plain error message", () => {
    expect(
      genErrorToastMsg(new Error("boom\n  with   spaces"), "Task run")
    ).toBe("Task run failed: boom with spaces");
  });

  it("truncates a long message to 120 characters", () => {
    const msg = genErrorToastMsg(new Error("x".repeat(200)), "Task run");
    expect(msg).toBe(`Task run failed: ${"x".repeat(120)}`);
  });
});

describe("missingToolCallError", () => {
  afterEach(() => mockGetState.mockReset());

  it("blames an unset max_tokens for an Anthropic AI SDK config", () => {
    mockGetState.mockReturnValue({
      plugin_cfgs: {
        "large-language-model": {
          backend: "AI SDK",
          ai_sdk_provider: "Anthropic",
        },
      },
    });
    const msg = missingToolCallError();
    expect(msg).toMatch(/ran out of output tokens/);
    expect(msg).toMatch(/currently not set/);
  });

  it("blames a too-low max_tokens for an Anthropic AI SDK config", () => {
    mockGetState.mockReturnValue({
      plugin_cfgs: {
        "large-language-model": {
          backend: "AI SDK",
          ai_sdk_provider: "Anthropic",
          max_tokens: 2048,
        },
      },
    });
    expect(missingToolCallError()).toMatch(/currently 2048/);
  });

  it("does not blame the token budget once max_tokens is high enough", () => {
    mockGetState.mockReturnValue({
      plugin_cfgs: {
        "large-language-model": {
          backend: "AI SDK",
          ai_sdk_provider: "Anthropic",
          max_tokens: 32000,
        },
      },
    });
    expect(missingToolCallError()).toBe(
      "The model returned no tool call (empty response)."
    );
  });

  it("gives a generic message for a non-Anthropic provider", () => {
    mockGetState.mockReturnValue({
      plugin_cfgs: {
        "large-language-model": {
          backend: "AI SDK",
          ai_sdk_provider: "OpenAI",
        },
      },
    });
    expect(missingToolCallError()).toBe(
      "The model returned no tool call (empty response)."
    );
  });

  it("finds the config under the scoped plugin name too", () => {
    mockGetState.mockReturnValue({
      plugin_cfgs: {
        "@saltcorn/large-language-model": {
          backend: "AI SDK",
          ai_sdk_provider: "Anthropic",
        },
      },
    });
    expect(missingToolCallError()).toMatch(/ran out of output tokens/);
  });

  it("does not throw when no plugin config is present at all", () => {
    mockGetState.mockReturnValue({ plugin_cfgs: {} });
    expect(() => missingToolCallError()).not.toThrow();
  });
});
