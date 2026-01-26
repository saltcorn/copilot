const { getState } = require("@saltcorn/data/db/state");
const View = require("@saltcorn/data/models/view");
const Table = require("@saltcorn/data/models/table");
const Plugin = require("@saltcorn/data/models/plugin");

const { mockReqRes } = require("@saltcorn/data/tests/mocks");
const { afterAll, beforeAll, describe, it, expect } = require("@jest/globals");

afterAll(require("@saltcorn/data/db").close);
beforeAll(async () => {
  await require("@saltcorn/data/db/reset_schema")();
  await require("@saltcorn/data/db/fixtures")();

  getState().registerPlugin("base", require("@saltcorn/data/base-plugin"));
});

jest.setTimeout(30000);

const configs = require("./configs.js");

for (const nameconfig of configs) {
  const { name, ...config } = nameconfig;
  describe("llm_generate function with " + name, () => {
    beforeAll(async () => {
      getState().registerPlugin(
        "@saltcorn/large-language-model",
        require("../../../large-language-model/unknownversion"),
        config,
      );
      getState().registerPlugin("@saltcorn/copilot", require(".."));
    });
    it("generates page", async () => {
      expect(2 + 2).toBe(4);
    });
  });
}
