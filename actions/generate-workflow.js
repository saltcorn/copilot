const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");
const { a, pre, script, div } = require("@saltcorn/markup/tags");
const { fieldProperties } = require("../common");

const steps = async () => {
  const actionExplainers = WorkflowStep.builtInActionExplainers();
  const actionFields = await WorkflowStep.builtInActionConfigFields();

  let stateActions = getState().actions;
  const stateActionList = Object.entries(stateActions).filter(
    ([k, v]) => !v.disableInWorkflow
  );

  const stepTypeAndCfg = Object.keys(actionExplainers).map((actionName) => {
    const properties = { 
      step_type: { type: "string", enum: [actionName] }
    };
    const myFields = actionFields.filter(
      (f) => f.showIf?.wf_action_name === actionName
    );
    const required = ["step_type"];
    myFields.forEach((f) => {
      if (f.required) required.push(f.name);
      properties[f.name] = {
        description: f.sublabel || f.label,
        ...fieldProperties(f),
      };
    });
    return {
      type: "object",
      description: actionExplainers[actionName],
      properties,
      required,
    };
  });
  for (const [actionName, action] of stateActionList) {
    try {
      const properties = { 
        step_type: { type: "string", enum: [actionName] }
      };
      const cfgFields = await getActionConfigFields(action, null, {
        mode: "workflow",
        copilot: true,
      });
      const required = ["step_type"];
      cfgFields.forEach((f) => {
        if (f.input_type === "section_header") return;
        if (f.required) required.push(f.name);
        properties[f.name] = {
          description: f.sublabel || f.label,
          ...fieldProperties(f),
        };
      });
      stepTypeAndCfg.push({
        type: "object",
        description:
          actionExplainers[actionName] ||
          `${actionName}.${action.description ? ` ${action.description}` : ""}`,
        properties,
        required,
      });
    } catch (e) {
      //ignore
    }
  }
  const triggers = Trigger.find({
    when_trigger: { or: ["API call", "Never"] },
  }).filter((tr) => tr.description && tr.name && tr !== "Workflow");
  //TODO workflows
  for (const trigger of triggers) {
    const properties = {
      step_type: { 
        type: "string",
        enum: [trigger.name],  
      },
    };
    if (trigger.table_id) {
      const table = Table.findOne({ id: trigger.table_id });
      const fieldSpecs = [];
      table.fields.forEach((f) => {
        // TODO fkeys dereferenced.
        fieldSpecs.push(`${f.name} with ${f.pretty_type} type`);
      });
      properties.row_expr = {
        type: "string",
        description: `JavaScript expression for the input to the action. This should be an expression for an object, with the following field name and types: ${fieldSpecs.join(
          "; "
        )}.`,
      };
    }
    const required = ["step_type"];
    stepTypeAndCfg.push({
      type: "object",
      description: `${trigger.name}: ${trigger.description}`,
      properties,
      required,
    });
  }
  const properties = {
    step_name: {
      description: "The name of this step as a valid Javascript identifier",
      type: "string",
    },
    only_if: {
      description:
        "Optional JavaScript expression based on the context. If given, the chosen action will only be executed if evaluates to true",
      type: "string",
    },
    /*step_type: {
        description: "The type of workflow step",
        type: "string",
        enum: Object.keys(actionExplainers),
      },*/
    next_step: {
      description:
        "The next step in the workflow, as a JavaScript expression based on the context.",
      type: "string",
    },
    step_configuration: { anyOf: stepTypeAndCfg },
  };
  return {
    type: "array",
    items: {
      type: "object",
      properties,
    },
  };
};

class GenerateWorkflow {
  static title = "Generate Workflow";
  static function_name = "generate_workflow";
  static description = "Generate the steps in a workflow";

  static async json_schema() {
    return {
      type: "object",
      properties: {
        workflow_steps: await steps(),
        workflow_name: {
          description:
            "The name of the workflow. Can include spaces and mixed case, should be 1-5 words.",
          type: "string",
        },
        when_trigger: {
          description:
            "When the workflow should trigger. Optional, leave blank if unspecified or workflow will be run on button click",
          type: "string",
          enum: ["Insert", "Delete", "Update", "Daily", "Hourly", "Weekly"],
        },
        trigger_table: {
          description:
            "If the workflow trigger is Insert, Delete or Update, the name of the table that triggers the workflow",
          type: "string",
        },
      },
    };
  }

  static async system_prompt() {
    const actionExplainers = WorkflowStep.builtInActionExplainers();
    let stateActions = getState().actions;
    const stateActionList = Object.entries(stateActions).filter(
      ([k, v]) => !v.disableInWorkflow
    );

    return `Use the generate_workflow tool to construct computational workflows according to specifications. You must create 
  the workflow by calling the generate_workflow tool, with the step required to implement the specification.
  
  The steps are specified as JSON objects. Each step has a name, specified in the step_name key in the JSON object. 
  The step name should be a valid JavaScript identifier.
  
  Each run of the workflow is executed in the presence of a context, which is a JavaScript object that individual
  steps can read values from and write values to. This context is a state that is persisted on disk for each workflow 
  run. 
  
  Each step can have a next_step key which is the name of the next step, or a JavaScript expression which evaluates 
  to the name of the next step based on the context. In the evaluation of the next step, each value in the context is 
  in scope and can be addressed directly. Identifiers for the step names are also in scope, the name of the next step 
  can be used directly without enclosing it in quotes to form a string. 
  
  For example, if the context contains a value x which is an integer and you have steps named "too_low" and "too_high",
  and you would like the next step to be too_low if x is less than 10 and too_high otherwise,
  use this as the next_step expression: x<10 ? too_low : too_high
  
  If the next_step is omitted then the workflow terminates.
  
  Each step has a step_configuration object which contains the step type and the specific parameters of 
  that step type. You should specify the step type in the step_type subfield of the step_configuration
  field. The available step types are:
  
  ${Object.entries(actionExplainers)
    .map(([k, v]) => `* ${k}: ${v}`)
    .join("\n")}
  ${stateActionList
    .map(([k, v]) => `* ${k}: ${v.description || ""}`)
    .join("\n")}
  
  Most of them are are explained by their parameter descriptions. Here are some additional information for some
  step types:
  
  run_js_code: if the step_type is "run_js_code" then the step object should include the JavaScript code to be executed in the "code"
  key. You can use await in the code if you need to run asynchronous code. The values in the context are directly in scope and can be accessed using their name. In addition, the variable 
  "context" is also in scope and can be used to address the context as a whole. To write values to the context, return an
  object. The values in this object will be written into the current context. If a value already exists in the context 
  it will be overwritten. For example, If the context contains values x and y which are numbers and you would like to push
  the value "sum" which is the sum of x and y, then use this as the code: return {sum: x+y}. You cannot set the next step in the 
  return object or by returning a string from a run_js_code step, this will not work. To set the next step from a code action, always use the next_step property of the step object.
  This expression for the next step can depend on value pushed to the context (by the return object in the code) as these values are in scope.  
  
  ForLoop: ForLoop steps loop over an array which is specified by the array_expression JavaScript expression. Execution of the workflow steps is temporarily diverted to another set
  of steps, starting from the step specified by the loop_body_inital_step value, and runs until it encounters a
  step with nothing specified for next_step at which point the next iteration (over the next item in the array) is started. When all items have
  been iterated over, the for loop is complete and execution continues with the next_step of the ForLoop step. During each iteration 
  of the loop, the current array item is temporarily set to a variable in the context specified by the item_variable variable. The steps between
  in the loop body can access this current array items in the context by the context item_variable name.
  When all items have been iterated, the for loop will continue from the step indicated by its next_step. 
  
  llm_generate: use a llm_generate step to consult an artificial intelligence language processor to ask a question in natural language in which the answer is given in natural language. The answer is based on a 
  question, specified as a string in the step conmfiguration "prompt_template" key in which you can user interpolation ({{ }}) to access context variables. Running the step will provide an answer by a 
  highly capable artificial intelligence processor who however does not have in-depth knowledge of the subject matter or any case specifics at hand - you
  must provide all these details in the question string, which should concatenate multiple background documents before asking the
  actual question. You must also provide a variable name (in the answer_field key in the step definition) where the answer
  will be pushed to the context as a string. If you specificy a variable name in chat_history_field, the invocation of subsequent llm_generate
  steps in the same workflow will contain the interaction history of previous invocations, so you don't have to repeat information in the prompt and can
  maintain a conversational interaction.
  
  llm_generate_json: use llm_generate_json steps to extract structured information from text. llm_generate_json uses natural language processing to read a document, 
  and to generate JSON objects with specified fields. A llm_generate_json step requires four settings in the step object:  gen_description,
  a general description of what it is that should be extracted; fields, which is an array of the fields in each object that is 
  extracted from the text, each with a name, a type and a description; multiple a boolean and that indicates whether exactly one object 
  or an array with any number of objects should be extracted; and answer_field, the name of the variable should be written to in the
  context (as an object if multiple is false and as an array if multiple is true).`;
  }

  static async execute(
    { workflow_steps, workflow_name, when_trigger, trigger_table },
    req
  ) {
    const steps = this.process_all_steps(workflow_steps);
    let table_id;
    if (trigger_table) {
      const table = Table.findOne({ name: trigger_table });
      if (!table) return { postExec: `Table not found: ${trigger_table}` };
      table_id = table.id;
    }
    const trigger = await Trigger.create({
      name: workflow_name,
      when_trigger: when_trigger || "Never",
      table_id,
      action: "Workflow",
      configuration: {},
    });
    for (const step of steps) {
      step.trigger_id = trigger.id;
      await WorkflowStep.create(step);
    }
    Trigger.emitEvent("AppChange", `Trigger ${trigger.name}`, req?.user, {
      entity_type: "Trigger",
      entity_name: trigger.name,
    });
    return {
      postExec:
        "Workflow created. " +
        a(
          { target: "_blank", href: `/actions/configure/${trigger.id}` },
          "Configure workflow."
        ),
    };
  }

  static render_html({
    workflow_steps,
    workflow_name,
    when_trigger,
    trigger_table,
  }) {
    const steps = this.process_all_steps(workflow_steps);

    if (WorkflowStep.generate_diagram) {
      steps.forEach((step, ix) => {
        step.id = ix + 1;
      });
      const mmdia = WorkflowStep.generate_diagram(
        steps.map((s) => new WorkflowStep(s))
      );
      return (
        div(
          `${workflow_name}${when_trigger ? `: ${when_trigger}` : ""}${
            trigger_table ? ` on ${trigger_table}` : ""
          }`
        ) +
        pre({ class: "mermaid" }, mmdia) +
        script(`mermaid.run({querySelector: 'pre.mermaid'});`)
      );
    }

    return `A workflow! Step names: ${workflow_steps.map(
      (s) => s.step_name
    )}. Upgrade Saltcorn to see diagrams in copilot`;
  }

  //specific methods

  static process_all_steps(steps) {
    const scsteps = steps.map((s) => this.to_saltcorn_step(s));
    if (scsteps.length) scsteps[0].initial_step = true;
    return scsteps;
  }

  static to_saltcorn_step(llm_step) {
    const { step_type, ...configuration } = llm_step.step_configuration;
    return {
      name: llm_step.step_name,
      action_name: step_type,
      next_step: llm_step.next_step,
      only_if: llm_step.only_if,
      configuration,
    };
  }
}

module.exports = GenerateWorkflow;
