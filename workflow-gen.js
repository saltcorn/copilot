const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");

const workflowSystemPrompt = () => {
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

The workflow steps can have different types according to what each step should accomplish. The available step types, 
set in the "step_type" key in the step object, are Code, Form, Output, AskAI, Extract, Retrieve, ForLoop, EndForLoop and Stop. Here are some details of each step type:

Code: if the step_type is "Code" then the step object should include the JavaScript code to be executed in the "code"
key. You can use await in the code if you need to run asynchronous code. The values in the context are directly in scope and can be accessed using their name. In addition, the variable 
"context" it's also in scope and can be used to address the context as a whole. To write values to the context, return an
object. The values in this object will be written into the current context. If a value already exists in the context 
it will be overridden. For example, If the context contains values x and x which are numbere and you would like to push
the value "sum" which is the sum of x and y, then use this as the code: return {sum: x+y}. You cannot set the next step in the 
return object or by returning a string from a Code step, this will not work. To set the next step from a code action, always use the next_step property of the step object.
This expression for the next step can depend on value pushed to the context (by the return object in the code) as these values are in scope.  

Form: Use a step with step_type of "Form" to ask questions or obtain information from the user. The execution of the 
workflow is suspended until the user answers the questions by filling in the form. 

Output: steps with step_type of "Output" can output data from the context to the user. It can do so by writing html, with 
handlebars interpolations to access the context, or by displaying a table from arrays of objects. To output HTML,
put the HTML you want to be displayed in the html key of 
the step object. This HTML can use handlebars (starting with {{ and ending with }}) to access variables in the context. 
For example if the context includes a value x, you can output this by {{ x }}, for example with this HTML: 
<div>x={{x}}</div>. To output a table, out a JavaScript expression for the data to be displayed in the stop key 
table_expression. For the table_expression exprssion, the variables in the 
context are in scope, as well as the context as a whole by the identifier context.

AskAI: use a AskAI step to consult an artificial intelligence language processor to ask a question in natural language in which the answer is given in natural language. The answer is based on a 
question, specified as a JavaScript expression in the step object "ask_question_expression" key. Running the step will provide an answer by a 
highly capable artificial intelligence processor who however does not have in-depth knowledge of the subject matter or any case specifics at hand - you
must provide all these details in the question string, which should concatenate multiple background documents before asking the
actual question. You must also provide a variable name (in the answer_variable key in the step definition) where the answer
will be pushed to the context as a string.

Extract: use Extract steps to extract structured information from text. Extract uses natural language processing to read a document, 
and to generate JSON objects with specified fields. An Extract step requires four settings in the step object:  extract_description,
a general description of what it is that should be extracted; extract_fields, which is an array of the fields in each object that is 
extracted from the text, each with a name, a type and a description; extract_multiple a bully and that indicates whether exactly one object 
or an array with any number of objects should be extracted; and extract_to_variable, the name of the variable should be written to in the
context (as an object if extract_multiple is false and as an array if extract_multiple is true). 

Retrieve: Retrieve steps will search a document database for a search term, and will push any matching documents to a variable in the 
context. An Retrieve step requires two settings in the step object. Firstly, retrieve_term_expression is a JavaScript expression for the term to 
search for. This expression can be based on the context, each of which values are directly in scope as well as the term context for the context as a whole).
Secondly, retrieve_to_variable is the name of the variable containing an array any retrieved documents will be appended to. Each document will be
appended to the array denoted by retrieve_to_variable as an object containing these fields: id, an integer, which is a unique identifier for the document;
contents, a string, which is the main content of the document; title, a string containing the title; and url, a string containing a URL link to the original document.
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

const steps = async () => {
  const actionExplainers = WorkflowStep.actionExplainers();
  const actionFields = await WorkflowStep.builtInActionConfigFields();
  const stepTypeAndCfg = Object.keys(actionExplainers).map((actionName) => {
    const properties = { step_type: { const: actionName } };
    actionFields
      .filter((f) => f.wf_step_name === actionName)
      .forEach((f) => {
        properties[f.name] = {
          description: f.sublabel || f.label,
        };
      });
    return {
      type: "object",
      description: actionExplainers[actionName],
      properties,
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
    step_type: {
      description: "The type of workflow step",
      type: "string",
      enum: Object.keys(actionExplainers),
    },
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
    const toolargs = {
      tools: [await workflow_function],
      tool_choice: {
        type: "function",
        function: { name: "generate_workflow" },
      },
      systemPrompt: workflowSystemPrompt(),
    };
    const prompt = `Design a workflow to implement a workflow accorfing to the following specification: ${description}`;
    console.log(prompt);
    const answer = await getState().functions.llm_generate.run(
      prompt,
      toolargs
    );
    const resp = JSON.parse(answer.tool_calls[0].function.arguments);
    console.log(JSON.stringify(resp, null, 2));
    return [
      {
        name: "step1",
        next_step: "",
        only_if: "",
        action_name: "SetContext",
        initial_step: true,
        configuration: {
          ctx_values: `{x: ${rnd}}`,
        },
      },
    ];
  },
  isAsync: true,
  description: "Generate a workflow",
  arguments: [{ name: "description", type: "String" }],
};
