const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");

const workflowSystemPrompt = () => {
  const actionExplainers = WorkflowStep.builtInActionExplainers();
  let stateActions = getState().actions;
  const stateActionList = Object.entries(stateActions).filter(
    ([k, v]) => !v.disableInWorkflow
  );

  return `You are an expert in constructing computational workflows according to specifications. You must create 
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
${stateActionList.map(([k, v]) => `* ${k}: ${v.description || ""}`).join("\n")}

Most of them are areplained by their parameter descriptions. Here are some additional information for some
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
in the loop body can access this current aray items in the context by the context item_variable name.
When all items have been iterated, the for loop will continue from the step indicated by its next_step. 

`;
};

const survey_questions = {
  type: "array",
  description:
    "The questions to ask the user in the form, if step_type is Form",
  items: {
    type: "object",
    properties: {
      question_title: {
        description: "The question to ask the user",
        type: "string",
      },
      question_type: {
        description: "The type of question",
        type: "string",
        enum: ["Yes/No", "Free text", "Multiple choice", "Integer"],
      },
      variable_name: {
        description:
          "a valid JavaScript identifier as a variable name in which the answer will be stored in the Workflow context",
        type: "string",
      },
      multiple_choice_answer: {
        description:
          "The list of possible answers for multiple choice questions",
        type: "array",
        items: {
          type: "string",
          description: "A possible answer to a multiple choice question",
        },
      },
    },
  },
};
const toArrayOfStrings = (opts) => {
  if (typeof opts === "string") return opts.split(",").map((s) => s.trim());
  if (Array.isArray(opts))
    return opts.map((o) => (typeof o === "string" ? o : o.value || o.name));
};
const fieldProperties = (field) => {
  const props = {};
  const typeName = field.type?.name || field.type || field.input_type;
  if (field.isRepeat) {
    props.type = "array";
    const properties = {};
    field.fields.map((f) => {
      properties[f.name] = {
        description: f.sublabel || f.label,
        ...fieldProperties(f),
      };
    });
    props.items = {
      type: "object",
      properties,
    };
  }
  switch (typeName) {
    case "String":
      props.type = "string";
      if (field.attributes?.options)
        props.enum = toArrayOfStrings(field.attributes.options);
      break;
    case "Boolean":
      props.type = "boolean";
      break;
    case "Integer":
      props.type = "integer";
      break;
    case "Float":
      props.type = "number";
      break;
    case "select":
      props.type = "string";
      if (field.options) props.enum = toArrayOfStrings(field.options);
      break;
  }
  return props;
};

const steps = async () => {
  const actionExplainers = WorkflowStep.builtInActionExplainers();
  const actionFields = await WorkflowStep.builtInActionConfigFields();

  let stateActions = getState().actions;
  const stateActionList = Object.entries(stateActions).filter(
    ([k, v]) => !v.disableInWorkflow
  );

  const stepTypeAndCfg = Object.keys(actionExplainers).map((actionName) => {
    const properties = { step_type: { const: actionName } };
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
      const properties = { step_type: { const: actionName } };
      const cfgFields = await getActionConfigFields(action, null, {
        mode: "workflow",
      });
      const required = ["step_type"];
      cfgFields.forEach((f) => {

        if (f.required) required.push(f.name);
        properties[f.name] = {
          description: f.sublabel || f.label,
          ...fieldProperties(f),
        };
      });
      stepTypeAndCfg.push({
        type: "object",
        description: actionExplainers[actionName],
        properties,
        required,
      });
    } catch (e) {}
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
const workflow_function = async () => ({
  type: "function",
  function: {
    name: "generate_workflow",
    description: "Generate the steps in a workflow",
    parameters: {
      type: "object",
      properties: {
        workflow_steps: await steps(),
      },
    },
  },
});

module.exports = {
  run: async (description) => {
    const rnd = Math.round(100 * Math.random());
    const systemPrompt = workflowSystemPrompt();
    console.log(systemPrompt);

    const toolargs = {
      tools: [await workflow_function()],
      tool_choice: {
        type: "function",
        function: { name: "generate_workflow" },
      },
      systemPrompt,
    };
    const prompt = `Design a workflow to implement a workflow accorfing to the following specification: ${description}`;
    console.log(prompt);
    console.log(JSON.stringify(toolargs, null, 2));

    const answer = await getState().functions.llm_generate.run(
      prompt,
      toolargs
    );
    const resp = JSON.parse(answer.tool_calls[0].function.arguments);
    console.log(JSON.stringify(resp, null, 2));
    const scsteps = resp.workflow_steps.map(to_saltcorn_step);
    console.log("scteps", scsteps);

    return scsteps;
  },
  isAsync: true,
  description: "Generate a workflow",
  arguments: [{ name: "description", type: "String" }],
};

const to_saltcorn_step = (llm_step) => {
  const { step_type, ...configuration } = llm_step.step_configuration;
  return {
    name: llm_step.step_name,
    action_name: step_type,
    next_step: llm_step.next_step,
    only_if: llm_step.only_if,
    configuration,
  };
};
