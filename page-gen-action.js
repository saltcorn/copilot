const { eval_expression } = require("@saltcorn/data/models/expression");
const { interpolate } = require("@saltcorn/data/utils");
const { getState } = require("@saltcorn/data/db/state");
const File = require("@saltcorn/data/models/file");
const Page = require("@saltcorn/data/models/page");

const GeneratePage = require("./actions/generate-page");
const { parseHTML } = require("./common");

module.exports = {
  description: "Generate page with AI copilot",
  configFields: ({ table, mode }) => {
    if (mode === "workflow") {
      return [
        {
          name: "page_name",
          label: "Page name",
          sublabel:
            "Leave blank to not save a Saltcorn page. Use interpolations {{ }} to access variables in the context",
          type: "String",
        },
        {
          name: "prompt_template",
          label: "Prompt",
          sublabel:
            "Prompt text. Use interpolations {{ }} to access variables in the context",
          type: "String",
          fieldview: "textarea",
          required: true,
        },
        {
          name: "image_prompt",
          label: "Prompt image files",
          sublabel:
            "Optional. An expression, based on the context, for file path or array of file paths for prompting",
          class: "validate-expression",
          type: "String",
        },
        {
          name: "answer_field",
          label: "Answer variable",
          sublabel: "Optional. Set the generated HTML to this context variable",
          class: "validate-identifier",
          type: "String",
        },
        {
          name: "convert_to_saltcorn",
          label: "Editable format",
          sublabel: "Convert to Saltcorn editable pages",
          type: "Bool",
        },
        //   ...override_fields,
        {
          name: "model",
          label: "Model",
          sublabel: "Override default model name",
          type: "String",
        },
      ];
    } else if (table) {
      const textFields = table.fields
        .filter((f) => f.type?.sql_name === "text")
        .map((f) => f.name);

      return [
        {
          name: "prompt_field",
          label: "Prompt field",
          sublabel: "Field with the text of the prompt",
          type: "String",
          required: true,
          attributes: { options: [...textFields, "Formula"] },
        },
        {
          name: "prompt_formula",
          label: "Prompt formula",
          type: "String",
          showIf: { prompt_field: "Formula" },
        },
        {
          name: "answer_field",
          label: "Answer field",
          sublabel: "Output field will be set to the generated answer",
          type: "String",
          required: true,
          attributes: { options: textFields },
        },
        //  ...override_fields,
      ];
    }
  },
  run: async ({
    row,
    table,
    user,
    mode,
    configuration: {
      page_name,
      prompt_field,
      prompt_formula,
      prompt_template,
      answer_field,
      image_prompt,
      chat_history_field,
      convert_to_saltcorn,
      model,
    },
  }) => {
    let prompt;
    if (mode === "workflow") prompt = interpolate(prompt_template, row, user);
    else if (prompt_field === "Formula" || mode === "workflow")
      prompt = eval_expression(
        prompt_formula,
        row,
        user,
        "copilot_generate_page prompt formula"
      );
    else prompt = row[prompt_field];
    const opts = {};

    if (model) opts.model = model;
    const tools = [];
    const systemPrompt = await GeneratePage.system_prompt();
    tools.push({
      type: "function",
      function: {
        name: GeneratePage.function_name,
        description: GeneratePage.description,
        parameters: await GeneratePage.json_schema(),
      },
    });
    const { llm_generate } = getState().functions;
    let chat;
    if (image_prompt) {
      const from_ctx = eval_expression(
        image_prompt,
        row,
        user,
        "copilot_generate_page image prompt"
      );

      chat = [];
      for (const image of Array.isArray(from_ctx) ? from_ctx : [from_ctx]) {
        const file = await File.findOne({ name: image });
        const imageurl = await file.get_contents("base64");

        chat.push({
          role: "user",
          content: [
            {
              type: "image",
              image: `data:${file.mimetype};base64,${imageurl}`,
            },
          ],
        });
      }
    }
    const initial_ans = await llm_generate.run(prompt, {
      tools,
      chat,
      systemPrompt,
    });
    const initial_info = initial_ans.tool_calls[0].input;
    const full = await GeneratePage.follow_on_generate(initial_info);
    const prompt_part_2 = convert_to_saltcorn
      ? `Only generate the inner part of the body. 
      Do not include the top menu. The outer tag of the generated HTML should be a <div class="container"> or a simlar container element.
      if you want to change the overall styling of the page, include a <style> element where you can change styles with CSS rules or CSS variables.`
      : `If you need to include the standard bootstrap CSS and javascript files, they are available as:

      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB" crossorigin="anonymous">

      and 

      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js" integrity="sha384-FKyoEForCGlyvwx9Hj09JcYn3nv7wiPVlz7YYwJrWVcXK/BmnVDxM+D2scQbITxI" crossorigin="anonymous"></script>`;
    const page_html = await getState().functions.llm_generate.run(
      `${prompt}. 
      
      The page title is: ${initial_info.title}. 
      Further page description: ${initial_info.description}. 

      Generate the HTML for the web page using the Bootstrap 5 CSS framework. 
      
      ${prompt_part_2}
      
      Just generate HTML code, do not wrap in markdown code tags`,
      {
        debugResult: true,
        chat,
        response_format: full.response_schema
          ? {
              type: "json_schema",
              json_schema: {
                name: "generate_page",
                schema: full.response_schema,
              },
            }
          : undefined,
      }
    );

    const use_page_name = page_name ? interpolate(page_name, row, user) : "";
    if (use_page_name) {
      let layout;
      if (convert_to_saltcorn) {
        layout = parseHTML(page_html, true);
        //console.log("got layout", JSON.stringify(layout, null, 2));
      } else {
        const file = await File.from_contents(
          `${use_page_name}.html`,
          "text/html",
          page_html,
          user.id,
          100
        );
        layout = { html_file: file.path_to_serve };
      }
      //save to a file

      //create page
      await Page.create({
        name: use_page_name,
        title: initial_info.title,
        description: initial_info.description,
        min_role: 100,
        layout,
      });
      getState().refresh_pages();
    }
    const upd = answer_field ? { [answer_field]: page_html } : {};
    if (mode === "workflow") return upd;
    else if (answer_field) await table.updateRow(upd, row[table.pk_name]);
  },
};
