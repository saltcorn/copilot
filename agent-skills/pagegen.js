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
const Form = require("@saltcorn/data/models/form");
const File = require("@saltcorn/data/models/file");
const Table = require("@saltcorn/data/models/table");
const View = require("@saltcorn/data/models/view");
const Page = require("@saltcorn/data/models/page");
const Trigger = require("@saltcorn/data/models/trigger");
const FieldRepeat = require("@saltcorn/data/models/fieldrepeat");
const { getState } = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const { eval_expression } = require("@saltcorn/data/models/expression");
const { interpolate } = require("@saltcorn/data/utils");
const { features } = require("@saltcorn/data/db/state");
const GeneratePage = require("../actions/generate-page");

//const { fieldProperties } = require("./helpers");

class GeneratePageSkill {
  static skill_name = "Generate Page";

  get skill_label() {
    return "Generate Page";
  }

  constructor(cfg) {
    Object.assign(this, cfg);
  }

  async systemPrompt() {
    return await GeneratePage.system_prompt();
  }

  static async configFields() {
    return [
      {
        name: "convert_to_saltcorn",
        label: "Editable format",
        sublabel: "Convert to Saltcorn editable pages",
        type: "Bool",
      },
    ];
  }
  get userActions() {
    return {
      async build_copilot_page_gen({ user, name, title, description, html }) {
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
    let properties = {};
    (this.toolargs || []).forEach((arg) => {
      properties[arg.name] = {
        description: arg.description,
        type: arg.argtype,
      };
      if (arg.options && arg.argtype === "string")
        properties[arg.name].enum = arg.options.split(",").map((s) => s.trim());
    });

    return {
      type: "function",
      process: async ({ name, existing_page_name }) => {
        if (existing_page_name) {
          const page = Page.findOne({ name: existing_page_name });

          if (!page)
            return `Existing page ${existing_page_name} not found. Unable to provide HTML for this page`;
          if (!page.layout.html_file)
            return `Existing page ${existing_page_name} is not HTML-based. Unable to provide HTML for this page`;
          const file = await File.findOne(page.layout.html_file);
          const html = await file.get_contents("utf8");
          return (
            `The HTML code for the ${existing_page_name} page is:` +
            "\n```html\n" +
            html +
            "\n```\n"
          );
        } else return "Metadata recieved";
      },
      postProcess: async ({ tool_call, generate }) => {
        const str = await generate(
          `Now generate the contents of the ${tool_call.input.name} HTML page. If I asked you to embed a view, 
 use the <embed-view> self-closing tag to do so, setting the view name in the viewname attribute. For example, 
 to embed the view LeadForm inside a div, write: <div><embed-view viewname="LeadForm"></div>
 
 If you need to include the standard bootstrap CSS and javascript files, they are available as:

   <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB" crossorigin="anonymous">

 and 
  <script src="/static_assets/js/jquery-3.6.0.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js" integrity="sha384-FKyoEForCGlyvwx9Hj09JcYn3nv7wiPVlz7YYwJrWVcXK/BmnVDxM+D2scQbITxI" crossorigin="anonymous"></script>

 If you are embedding views with <embed-view>, you should also embed the following script sources at the end of the <body> tag to make sure the content inside those views works:

 <script src="/static_assets/js/saltcorn-common.js"></script>
 <script src="/static_assets/js/saltcorn.js">
`,
        );
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
            label: "Save page "+tool_call.input.name,
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
        name: "generate_page",
        description: "Generate a page with HTML.",
        parameters: {
          type: "object",
          required: ["name", "title", "min_role", "page_type"],
          properties: {
            existing_page_name: {
              description: `If the user asks to modify or change a page, or create a new page based on an existing page, set this to retrieve the contents of the existing page.`,
              type: "string",
            },
            name: {
              description: `The name of the new page to generate, this should be a short name which is part of the url. If an existing page name if given, set this to the same name to modify the existing page, and a different name to create a new page based on the existing page`,
              type: "string",
            },
            title: {
              description: "Page title, this is in the <title> tag.",
              type: "string",
            },
            description: {
              description:
                "A longer description that is not visible but appears in the page header and is indexed by search engines",
              type: "string",
            },
            page_type: {
              description:
                "The type of page to generate: a Marketing page if for promotional purposes, such as a landing page or a brouchure, with an appealing design. An Application page is simpler and an integrated part of the application",
              type: "string",
              enum: ["Marketing page", "Application page"],
            },
          },
        },
      },
    };
  };
}

module.exports = GeneratePageSkill;
