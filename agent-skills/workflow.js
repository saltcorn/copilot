const {
  div,
  pre,
  code,
  a,
  text,
  escape,
  iframe,
  text_attr,
} = require("@saltcorn/markup/tags");
const Workflow = require("@saltcorn/data/models/workflow");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Form = require("@saltcorn/data/models/form");
const File = require("@saltcorn/data/models/file");
const Table = require("@saltcorn/data/models/table");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const FieldRepeat = require("@saltcorn/data/models/fieldrepeat");
const { getState } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const { eval_expression } = require("@saltcorn/data/models/expression");
const { interpolate } = require("@saltcorn/data/utils");
const { features } = require("@saltcorn/data/db/state");
const GenerateWorkflow = require("../actions/generate-workflow");

//const { fieldProperties } = require("./helpers");

class GenerateWorkflowSkill {
  static skill_name = "Generate Workflow";

  get skill_label() {
    return "Generate Workflow";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt() {
    return `If the user asks to generate a workflow, run the generate_workflow tool to enter workflow generating model`;
  }

  static async configFields() {
    return [];
  }
  get userActions() {
    return {
      async build_copilot_workflow_gen({
        user,
        name,
        title,
        description,
        html,
      }) {
        const file = await File.from_contents(
          `${name}.html`,
          "text/html",
          html,
          user.id,
          100,
        );

        await Page.create({
          name,
          title,
          description,
          min_role: 100,
          layout: { html_file: file.path_to_serve },
        });
        setTimeout(() => getState().refresh_pages(), 200);
        return {
          notify: `Page saved: <a target="_blank" href="/page/${name}">${name}</a>`,
        };
      },
    };
  }
  provideTools = () => {
    return {
      type: "function",
      process: async ({ name, existing_workflow_name }) => {
        if (existing_workflow_name) {
          const trigger = Trigger.findOne({ name: existing_workflow_name });

          if (!trigger)
            return `Existing workflow ${existing_workflow_name} not found. Unable to provide definition for this workflow`;
          const pack = trigger.toJson;
          const steps = await WorkflowStep.find(
            { trigger_id: trig.id },
            { orderBy: "id" },
          );
          pack.steps = steps.map((s) => s.toJson);
          return (
            `The definition for the ${existing_page_name} workflow is:` +
            "\n```json\n" +
            JSON.stringify(pack, null, 2) +
            "\n```\n"
          );
        } else return "Metadata received";
      },
      postProcess: async ({ tool_call, generate }) => {
        const genres = await generate();
        const html = str.includes("```html")
          ? str.split("```html")[1].split("```")[0]
          : str;

        return {
          stop: true,
          add_response: iframe({
            srcdoc: text_attr(html),
            width: 500,
            height: 800,
          }),
          add_system_prompt: `If the user asks you to regenerate the page, 
          you must run the generate_page tool again. After running this tool 
          you will be prompted to generate the html again. You should repeat 
          the html from the previous answer except for the changes the user 
          is requesting.`,
          add_user_action: {
            name: "build_copilot_page_gen",
            type: "button",
            label: "Save page " + tool_call.input.name,
            input: { html },
          },
        };
      },

      /*renderToolCall({ phrase }, { req }) {
        return div({ class: "border border-primary p-2 m-2" }, phrase);
      },*/
      renderToolResponse: async (response, { req }) => {
        if (
          typeof response === "string" &&
          response.includes("Unable to provide HTML for this page")
        )
          return response;
        if (
          typeof response === "string" &&
          response.includes("The HTML code for the ")
        )
          return `Existing page retrieved...`;
        return null;
      },
      function: {
        name: "generate_workflow",
        description:
          "Generate a workflow. Run this tool to start generating a workflow",
        parameters: {
          type: "object",
          required: [],
          properties: {
            existing_workflow_name: {
              description: `If the user asks to modify or change a workflow, or create a new workflow based on an existing workflow, set this to retrieve the contents of the existing workflow.`,
              type: "string",
            },
            name: {
              description: `The name of the workflow to generate this should be a short name. If an existing workflow name if given, set this to the same name to modify the existing workflow, and a different name to create a new workflow based on the existing workflow`,
              type: "string",
            },
          },
        },
      },
    };
  };
}

module.exports = GenerateWorkflowSkill;
