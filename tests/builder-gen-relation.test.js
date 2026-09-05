const { describe, it, expect } = require("@jest/globals");

// normalizeLayoutCandidate is the pure post-LLM repair step - stand in for the LLM by handing it the JSON shape it would have produced.
jest.mock(
  "@saltcorn/data/db/state",
  () => ({ getState: () => ({ functions: {} }) }),
  { virtual: true }
);
jest.mock("@saltcorn/data/models/table", () => ({}), { virtual: true });
jest.mock("@saltcorn/data/models/trigger", () => ({}), { virtual: true });
jest.mock("@saltcorn/data/models/view", () => ({}), { virtual: true });
jest.mock(
  "@saltcorn/data/viewable_fields",
  () => ({ edit_build_in_actions: [] }),
  { virtual: true }
);
jest.mock(
  "@saltcorn/data/plugin-helper",
  () => ({ build_schema_data: async () => ({ tables: [], views: [] }) }),
  { virtual: true }
);
// Stubbed out because they pull in Field/Form/View/Trigger models that
// normalizeLayoutCandidate never touches - only ./relation-paths (real,
// backed by the real @saltcorn/common-code RelationsFinder) matters here.
jest.mock("../builder-schema", () => ({ buildBuilderSchema: () => ({}) }));
jest.mock("../common", () => ({
  getLlmConfigurationSafe: async () => null,
  canUseResponseFormat: () => false,
}));

const { normalizeLayoutCandidate } = require("../builder-gen");
const { zookeeperAppSchema } = require("./helpers/fake-schema");

// A ctx shaped like buildContext("show", "zookeepers") would produce, minus
// the parts normalizeLayoutCandidate doesn't read.
const zookeeperShowCtx = (overrides = {}) => ({
  mode: "show",
  table: { name: "zookeepers" },
  fields: [],
  fieldMap: {},
  actions: [],
  viewNames: ["tasks_list", "zookeeper_show"],
  schemaData: zookeeperAppSchema(),
  ...overrides,
});

// A missing relation on an embedded view/view_link must reject the candidate, not get guessed.
describe("embedding a relation-scoped list (zookeeper -> tasks) requires an explicit relation", () => {
  it("view_link throws when the LLM omits relation", () => {
    const candidate = {
      above: [
        { type: "view_link", view: "tasks_list", view_label: "Tasks" },
      ],
    };
    expect(() =>
      normalizeLayoutCandidate(candidate, zookeeperShowCtx())
    ).toThrow(/relation/i);
  });

  it("embedded 'view' segment throws when the LLM omits relation", () => {
    const candidate = {
      above: [{ type: "view", view: "tasks_list", state: {} }],
    };
    expect(() =>
      normalizeLayoutCandidate(candidate, zookeeperShowCtx())
    ).toThrow(/relation/i);
  });

  it("still throws in page mode, where there is no table to guess a relation from", () => {
    // agent-skills/pagegen.js always calls builderGen.run(prompt, "page", null, ...),
    // so ctx.table is null for every page generation - the check must not
    // depend on ctx.table being set to catch a missing relation here too.
    const candidate = {
      above: [{ type: "view", view: "tasks_list", state: {} }],
    };
    const pageCtx = zookeeperShowCtx({ mode: "page", table: null });
    expect(() => normalizeLayoutCandidate(candidate, pageCtx)).toThrow(
      /relation/i
    );
  });

  it("view_link keeps an explicit relation the LLM already set", () => {
    const candidate = {
      above: [
        {
          type: "view_link",
          view: "tasks_list",
          view_label: "Tasks",
          relation: ".zookeepers.tasks$zookeeper_id",
        },
      ],
    };
    const layout = normalizeLayoutCandidate(candidate, zookeeperShowCtx());
    expect(layout.above[0].relation).toBe(".zookeepers.tasks$zookeeper_id");
  });

  it("embedded 'view' segment keeps an explicit relation the LLM already set", () => {
    const candidate = {
      above: [
        {
          type: "view",
          view: "tasks_list",
          state: {},
          relation: ".zookeepers.tasks$zookeeper_id",
        },
      ],
    };
    const layout = normalizeLayoutCandidate(candidate, zookeeperShowCtx());
    expect(layout.above[0].relation).toBe(".zookeepers.tasks$zookeeper_id");
  });
});

// A view name outside ctx.viewNames must reject the candidate, not silently fall back to ctx.viewNames[0].
describe("embedding a view outside ctx.viewNames is rejected, not silently substituted", () => {
  it("view_link throws when the view name is unknown", () => {
    const candidate = {
      above: [
        {
          type: "view_link",
          view: "not_a_real_view",
          view_label: "Tasks",
          relation: ".zookeepers.tasks$zookeeper_id",
        },
      ],
    };
    expect(() =>
      normalizeLayoutCandidate(candidate, zookeeperShowCtx())
    ).toThrow(/unknown view/i);
  });

  it("embedded 'view' segment throws when the view name is unknown", () => {
    const candidate = {
      above: [
        {
          type: "view",
          view: "not_a_real_view",
          state: {},
          relation: ".zookeepers.tasks$zookeeper_id",
        },
      ],
    };
    expect(() =>
      normalizeLayoutCandidate(candidate, zookeeperShowCtx())
    ).toThrow(/unknown view/i);
  });
});
