// gen workflow code page from prototype

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

const steps = {
  type: "array",
  items: {
    type: "object",
    properties: {
      step_name: {
        description: "The name of this step as a valid Javascript identifier",
        type: "string",
      },
      step_type: {
        description: "The type of workflow step",
        type: "string",
        enum: [
          "Code",
          "Form",
          "Output",
          "Stop",
          "AskAI",
          "Extract",
          "Retrieve",
          "ForLoop",
          "EndForLoop",
        ],
      },
      next_step: {
        description: "The next step in the workflow",
        type: "string",
      },
      code: {
        description:
          "JavaScript code to run, if step_type is Code. The workflow context is in scope, return an object of value to add to the context.",
        type: "string",
      },
      html: {
        description:
          "Html code to output to user, if step_type is Output. Use handlebars to access variables in the workflow context",
        type: "string",
      },
      table_expression: {
        description:
          "Expression for array of objects to output to user, if step_type is Output. Use this to output data from the context in a tabular format",
        type: "string",
      },
      form_questions: survey_questions,
      form_title: {
        description:
          "The title of the form to show to the user, if step_type is Form",
        type: "string",
      },
      ask_question_expression: {
        description:
          "A JavaScript expression for the question to ask (which may be based on variables from the context) if step_type is AskAI. The question should include all relevant context in one long string. Include any relevant information as the person asking the quesiotn is not up-to-date on any specifics",
        type: "string",
      },
      answer_variable: {
        description:
          "The variable in the context to which the answer will be written as a string, if step_type is AskAI",
        type: "string",
      },
      retrieve_term_expression: {
        description:
          "A JavaScript expression for the string containing the term to search for, if step_type is Retrieve. The variables in the context are directly in scope, and the context as a whole can be addressed with the identifier context.",
        type: "string",
      },
      retrieve_to_variable: {
        description:
          "The variable in the context to which the retrieved documents will be appended, if step_type is Retrieve. The variable will be set to be a list of objects each with fields id (an integer), contents (the document contents as a string), title (a shorter string) and url (a link to the document, as a string).",
        type: "string",
      },
      for_loop_array_expression: {
        description:
          "The JavaScript expression for the array to iterate over, if step_type is ForLoop. User this to iterate over an array in the context",
        type: "string",
      },
      for_loop_step_name: {
        description:
          "The name of the step that starts the inner execution of the for loop, if step_type is ForLoop. Each iteration of the loop starts with this step and runs until a step with type EndForLoop is encountered",
        type: "string",
      },
      for_loop_variable: {
        description:
          "The variable name each item in the array will be written as in the context, if step_type is ForLoop. During the execution of the loop, the current item in the array being iterated over can be accessed by this variable name",
        type: "string",
      },
      extract_multiple: {
        description:
          "If true, extract multiple objects with the specified fields pushed as a list. If false, extract a single object with the specified fields. Set if step_type is Extract.",
        type: "boolean",
      },
      extract_to_variable: {
        description:
          "The variable in the context to which the extracted data will be written, if step_type is Extract. The data will be pushed as an object, or an array of objects if extract_multiple is true",
        type: "string",
      },
      extract_from_string_expresssion: {
        description:
          "A JavaScript expression for the string from which information should be extracted, if step_type is Extract. The variables in the context are directly in scope, and the context as a whole can be addressed with the identifier context.",
        type: "string",
      },
      extract_description: {
        description:
          "A general description of what it is that should be extracted, if step_type is Extract.",
        type: "string",
      },
      extract_fields: {
        description:
          "The fields to extract from the text, if step_type is Extract.",
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              description: "The field name, as a valid JavaScript identifier",
              type: "string",
            },
            description: {
              description: "A description of the field",
              type: "string",
            },
            type: {
              description: "The field type",
              type: "string",
              enum: ["string", "integer", "number", "boolean"],
            },
          },
        },
      },
    },
  },
};

const workflow_function = {
  type: "function",
  function: {
    name: "generate_workflow",
    description: "Generate the steps in a workflow",
    parameters: {
      type: "object",
      properties: {
        workflow_steps: steps,
      },
    },
  },
};

const workflowSystemPrompt = `You are an expert in constructing computational workflows according to specifications. You must create 
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

If the next_step is omitted then the next step is the following step in the array of steps.

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

ForLoop: ForLoop steps loop over an array which is specified by the for_loop_array_expression JavaScript expression. Execution of the workflow steps is temporarily diverted to another set
of steps, starting from the step specified by the for_loop_step_name value, and runs until it encounters an
EndForLoop step at which point the next iteration (over the next item in the array) is started. When all items have
been iterated over, the for loop is complete and execution continues with the next_step of the ForLoop step. During each iteration 
of the loop, the current array item is temporarily set to a variable in the context specified by the for_loop_variable varaible. The steps between
the for_loop_step_name and the EndForLoop can access this current aray items in the context by the context for_loop_variable name.
When all items have been iterated, the for loop will continue from the step indicated by its next_step property of the EndForLoop step. 

EndForLoop: Finish the current iteration of the for loop. The execution goes to the next iteration of the loop, or if 
there are no more items in the list, goes to the next_step of the this, the EndForLoop, step. The next_step of the ForLoop step is ignored.

Stop: Stop executing the workflow, the workflow is completed.
`;

async function genWorkflow(row) {
  const toolargs = {
    tools: [workflow_function],
    tool_choice: { type: "function", function: { name: "generate_workflow" } },
    systemPrompt: workflowSystemPrompt,
  };
  const prompt = `Design a workflow to implement a workflow accorfing to the following specification: ${row.description}`;
  console.log(prompt);
  const answer = await llm_generate(prompt, toolargs);
  const resp = JSON.parse(answer.tool_calls[0].function.arguments);
  console.log(JSON.stringify(resp, null, 2));
  const stepTable = Table.findOne("Workflow Steps");
  let ix = 0;
  const db_steps = [];
  for (const step of resp.workflow_steps) {
    ix += 1;
    const { step_name, step_type, next_step, ...config } = step;
    const db_step = {
      name: step_name,
      type: step_type,
      number: ix,
      workflow: row.id,
      next_step: next_step,
      configuration: config,
    };
    db_step.id = await stepTable.insertRow(db_step);

    db_steps.push(db_step);
  }
  const diagram = genWorkflowDiagram(db_steps);
  await Table.findOne("Workflows").updateRow({ diagram }, row.id);
}

function genWorkflowDiagram(steps) {
  const stepNames = steps.map((s) => s.name);
  const nodeLines = steps
    .map(
      (s) => `  ${s.name}["\`**${s.name}**
  ${s.type}\`"]:::wfstep${s.id}`
    )
    .join("\n");
  const linkLines = [];
  let step_ix = 0;
  for (const step of steps) {
    if (step.type === "ForLoop") {
      linkLines.push(
        `  ${step.name} --> ${step.configuration.for_loop_step_name}`
      );
    } else if (stepNames.includes(step.next_step)) {
      linkLines.push(`  ${step.name} --> ${step.next_step}`);
    } else if (!step.next_step && steps[step_ix + 1])
      linkLines.push(`  ${step.name} --> ${steps[step_ix + 1].name}`);
    else if (step.next_step) {
      for (otherStep of stepNames)
        if (step.next_step.includes(otherStep))
          linkLines.push(`  ${step.name} --> ${otherStep}`);
    }
    if (step.type === "EndForLoop") {
      // TODO this is not correct. improve.
      let forStep;
      for (let i = step_ix; i >= 0; i -= 1) {
        if (steps[i].type === "ForLoop") {
          forStep = steps[i];
          break;
        }
      }
      if (forStep) linkLines.push(`  ${step.name} --> ${forStep.name}`);
    }
    step_ix += 1;
  }
  return "flowchart TD\n" + nodeLines + "\n" + linkLines.join("\n");
}
