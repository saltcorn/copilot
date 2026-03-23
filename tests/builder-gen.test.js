const { getState } = require("@saltcorn/data/db/state");
const View = require("@saltcorn/data/models/view");
const Table = require("@saltcorn/data/models/table");
const Plugin = require("@saltcorn/data/models/plugin");
const Trigger = require("@saltcorn/data/models/trigger");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const WorkflowRun = require("@saltcorn/data/models/workflow_run");

const { mockReqRes } = require("@saltcorn/data/tests/mocks");
const { afterAll, beforeAll, describe, it, expect } = require("@jest/globals");

afterAll(require("@saltcorn/data/db").close);
beforeAll(async () => {
  await require("@saltcorn/data/db/reset_schema")();
  await require("@saltcorn/data/db/fixtures")();

  getState().registerPlugin("base", require("@saltcorn/data/base-plugin"));
});

/* 
 
 RUN WITH:
  saltcorn dev:plugin-test -d ~/copilot -o ~/large-language-model/
 
 */

jest.setTimeout(60000);

const configs = require("./configs.js");

for (const nameconfig of configs) {
  const { name, ...config } = nameconfig;
  describe("copilot_generate_layout with " + name, () => {
    beforeAll(async () => {
      getState().registerPlugin(
        "@saltcorn/large-language-model",
        require("@saltcorn/large-language-model"),
        config,
      );
      getState().registerPlugin("@saltcorn/copilot", require(".."));
    });
    for (const mode of ["page", "show", "edit", "filter"])
      it("generates simple layout in mode " + mode, async () => {
        const genres = await getState().functions.copilot_generate_layout.run(
          "A container with a text element that says Hello World in H3",
          mode,
          mode === "page" ? null : "books",
        );
        expect(genres.type).toBe("container");
        expect(genres.contents.type).toBe("blank");
        expect(genres.contents.contents).toBe("Hello World");
        expect(genres.contents.textStyle).toBe("h3");
      });
  });
}
