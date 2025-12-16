const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Page = require("@saltcorn/data/models/page");
const Table = require("@saltcorn/data/models/table");
const User = require("@saltcorn/data/models/user");
const Field = require("@saltcorn/data/models/field");
const { apply, removeAllWhiteSpace } = require("@saltcorn/data/utils");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");
const { a, pre, script, div, code } = require("@saltcorn/markup/tags");
const {
  fieldProperties,
  getPromptFromTemplate,
  splitContainerStyle,
  containerHandledStyles,
  parseHTML,
} = require("../common");
const MarkdownIt = require("markdown-it"),
  md = new MarkdownIt();

class GeneratePage {
  static title = "Generate Page";
  static function_name = "generate_page";
  static description = "Generate Page";

  static async json_schema() {
    const allPageNames = (await Page.find({})).map((p) => p.page);
    let namedescription = `The name of the page, this should be a short name which is part of the url. `;
    if (allPageNames.length) {
      namedescription += `These are the names of the exising pages: ${allPageNames.join(
        ", "
      )}. Do not pick a name that is identical but follow the same naming convention.`;
    }
    const roles = await User.get_roles();
    return {
      type: "object",
      required: ["name", "title", "min_role", "page_type"],
      properties: {
        name: {
          description: namedescription,
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
        min_role: {
          description:
            "The minimum role needed to access the page. For pages accessible only by admin, use 'admin', pages with min_role 'public' is publicly accessible and also available to all users",
          type: "string",
          enum: roles.map((r) => r.role),
        },
        page_type: {
          description:
            "The type of page to generate: a Marketing page if for promotional purposes, such as a landing page or a brouchure, with an appealing design. An Application page is simpler and an integrated part of the application",
          type: "string",
          enum: ["Marketing page", "Application page"],
        },
      },
    };
  }
  static async system_prompt() {
    return `Use the generate_page to generate a page.`;
  }
  static async follow_on_generate({ name, page_type }) {
    if (page_type === "Marketing page") {
      return {
        prompt:
          "Generate the HTML for the web page using the Bootstrap 5 CSS framework.",
      };
    }
    const prompt = `Now generate the contents of the ${name} page`;
    const response_schema = {
      type: "object",
      properties: {
        element: {
          anyOf: [
            {
              type: "object",
              description: "Position items next to each other in grid columns",
              //required: ["name", "title", "min_role"],
              properties: {
                besides: {
                  type: "array",
                  items: {
                    type: "object",
                    $ref: "#",
                  },
                },
                widths: {
                  type: "array",
                  items: {
                    type: "integer",
                    description:
                      "The width of each column 1-12. The sum of all columns must equal 12",
                  },
                },
              },
            },
            {
              type: "object",
              //required: ["name", "title", "min_role"],
              description: "Position items vertically, each above the next",
              properties: {
                above: {
                  type: "array",
                  items: {
                    type: "object",
                    $ref: "#",
                  },
                },
              },
            },
            {
              type: "object",
              required: ["type", "isHTML", "contents"],
              description: "An element containing HTML",
              properties: {
                type: { const: "blank" },
                isHTML: { const: true },
                contents: {
                  type: "string",
                  description: "The HTML contents of this element",
                },
              },
            },
            {
              type: "object",
              required: ["type", "contents"],
              description: "An element containing text",
              properties: {
                type: { const: "blank" },
                contents: {
                  type: "string",
                  description: "The plain text contents of this element",
                },
                style: {
                  type: "object",
                  description:
                    "Some CSS properties that can be applied to the text element",
                  properties: {
                    "font-size": {
                      type: "string",
                      description:
                        "CSS size identifier, for example 12px or 2rem",
                    },
                    color: {
                      type: "string",
                      description:
                        "CSS color specifier, for example #15d48a or rgb(0, 255, 0)",
                    },
                  },
                },
                textStyle: {
                  type: "array",
                  description: "The style to apply to the text",
                  items: {
                    type: "string",
                    description:
                      "h1-h6 to put in a header element. fst-italic for italic, text-muted for muted color, fw-bold for bold, text-underline for underline, small for smaller size, font-monospace for monospace font",
                    enum: [
                      "h1",
                      "h2",
                      "h3",
                      "h4",
                      "h5",
                      "h6",
                      "fst-italic",
                      "text-muted",
                      "fw-bold",
                      "text-underline",
                      "small",
                      "font-monospace",
                    ],
                  },
                },
              },
            },
            {
              type: "object",
              required: ["type", "contents"],
              description: "An container element that can set various styles",
              properties: {
                type: { const: "container" },
                contents: {
                  type: "object",
                  $ref: "#",
                },
                style: {
                  type: "string",
                  description:
                    "CSS properties to set on the container formatted as the html style attribute, with no CSS selector and separated by semi-colons. Example: color: #00ff00; margin-top: 5px",
                },
                customClass: {
                  type: "string",
                  description:
                    "Custom class to set. You can use bootstrap 5 utility classes here as bootstrap 5 is loaded",
                },
                htmlElement: {
                  type: "string",
                  description: "The HTML element to use for the container",
                  enum: [
                    "div",
                    "span",
                    "article",
                    "section",
                    "header",
                    "nav",
                    "main",
                    "aside",
                    "footer",
                  ],
                },
              },
            },
            {
              type: "object",
              description: "An image",
              properties: {
                type: { const: "image" },
                description: {
                  type: "string",
                  description: "A description of the contents of the image",
                },
                width: {
                  type: "integer",
                  description: "The width of the image in px",
                },
                height: {
                  type: "integer",
                  description: "The height of the image in px",
                },
              },
            },
          ],
        },
      },
    };
    return { response_schema, prompt };
  }

  static walk_response(segment) {
    let go = GeneratePage.walk_response;
    if (!segment) return segment;
    if (typeof segment === "string") return segment;
    if (segment.element) return go(segment.element);
    if (Array.isArray(segment)) {
      return segment.map(go);
    }
    if (typeof segment.contents === "string") {
      return { ...segment, contents: md.render(segment.contents) };
    }
    if (segment.type === "image") {
      return {
        type: "container",
        style: {
          height: `${segment.height}px`,
          width: `${segment.width}px`,
          "border-style": "solid",
          "border-color": "#808080",
          "border-width": "3px",
          vAlign: "middle",
          hAlign: "center",
        },
        contents: segment.description,
      };
    }
    if (segment.type === "container") {
      const { customStyle, style, display, overflow } = splitContainerStyle(
        segment.style
      );
      return {
        ...segment,
        customStyle,
        display,
        overflow,
        style,
        contents: go(segment.contents),
      };
    }
    if (segment.contents) {
      return { ...segment, contents: go(segment.contents) };
    }
    if (segment.above) {
      return { ...segment, above: go(segment.above) };
    }
    if (segment.besides) {
      return { ...segment, besides: go(segment.besides) };
    }
  }

  static render_html(attrs, contents) {
    if (attrs.page_type === "Marketing page") {
      return (
        pre(code(JSON.stringify(attrs, null, 2))) +
        pre(code(escapeHtml(contents || "")))
      );
    }

    return (
      pre(code(JSON.stringify(attrs, null, 2))) +
      pre(
        code(
          escapeHtml(
            JSON.stringify(
              GeneratePage.walk_response(JSON.parse(contents)),
              null,
              2
            )
          )
        )
      )
    );
  }
  static async execute(
    { name, title, description, min_role, page_type },
    req,
    contents
  ) {
    console.log("execute", name, contents);
    const roles = await User.get_roles();
    const min_role_id = roles.find((r) => r.role === min_role).id;
    let layout;
    if (page_type === "Marketing page") {
      layout = parseHTML(contents);
    } else layout = GeneratePage.walk_response(JSON.parse(contents));
    await Page.create({
      name,
      title,
      description,
      min_role: min_role_id,
      layout,
    });
    return {
      postExec:
        "Page created. " +
        a(
          { target: "_blank", href: `/page/${name}`, class: "me-1" },
          "Go to page"
        ) +
        " | " +
        a(
          { target: "_blank", href: `/pageedit/edit/${name}`, class: "ms-1" },
          "Configure page"
        ),
    };
  }
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = GeneratePage;
