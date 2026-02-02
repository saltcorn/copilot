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

jest.setTimeout(60000);

const configs = require("./configs.js");

for (const nameconfig of configs) {
  const { name, ...config } = nameconfig;
  describe("llm_generate function with " + name, () => {
    beforeAll(async () => {
      getState().registerPlugin(
        "@saltcorn/large-language-model",
        require("@saltcorn/large-language-model"),
        config,
      );
      getState().registerPlugin("@saltcorn/copilot", require(".."));
    });
    it("generates page", async () => {
      const trigger = await Trigger.create({
        action: "Workflow",
        when_trigger: "Never",
        name: "genpagewf",
      });
      await WorkflowStep.create({
        trigger_id: trigger.id,
        name: "first_step",
        next_step: "second_step",
        action_name: "SetContext",
        initial_step: true,
        configuration: {
          ctx_values: `{prompt:"Generate a page for a rural bakery located in a big city"}`,
        },
      });
      await WorkflowStep.create({
        trigger_id: trigger.id,
        name: "second_step",
        next_step: "",
        action_name: "copilot_generate_page",
        configuration: {
          prompt_template: `{{ prompt }}`,
          answer_field: "pagecode",
        },
      });
      const wfrun = await WorkflowRun.create({
        trigger_id: trigger.id,
      });
      const result = await wfrun.run({ user: { role_id: 1 } });
      //console.log("result", result, wfrun.context);
      expect(result.pagecode).toContain("<!DOCTYPE html>");
    });
  });
}
