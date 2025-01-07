const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");

const workflowSystemPrompt = () => {
  const actionExplainers = WorkflowStep.builtInActionExplainers();

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
  const typeName = field.type.name || field.type;
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
  }
  return props;
};

const steps = async () => {
  const actionExplainers = WorkflowStep.builtInActionExplainers();
  const actionFields = await WorkflowStep.builtInActionConfigFields();

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
