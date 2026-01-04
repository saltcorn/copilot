const fsp = require("fs").promises;
const _ = require("underscore");
const path = require("path");
const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const { getState } = require("@saltcorn/data/db/state");

const parseCSS = require("style-to-object").default;
const MarkdownIt = require("markdown-it"),
  md = new MarkdownIt();
const HTMLParser = require("node-html-parser");

const boxHandledStyles = new Set([
  "margin",
  "margin-top",
  "margin-bottom",
  "margin-right",
  "margin-left",
  "padding",
  "padding-top",
  "padding-bottom",
  "padding-right",
  "padding-left",
  "border-color",
  "border-color",
  "border-width",
  "border-radius",
  "height",
  "min-height",
  "max-height",
  "width",
  "min-width",
  "max-width",
]);

const containerHandledStyles = new Set([
  ...boxHandledStyles,
  "opacity",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "flex-grow",
  "flex-shrink",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "align-content",
  "display",
  "overflow",
]);

const splitContainerStyle = (styleStr) => {
  const style = parseCSS(styleStr);
  const customStyles = [];
  Object.keys(style || {}).forEach((k) => {
    if (containerHandledStyles.has(k)) {
      customStyles.push(`${k}: ${style[k]}`);
      delete style[k];
    }
  });
  const ns = { style, customStyle: customStyles.join("; ") };
  if (ns.style.display) {
    ns.display = ns.style.display;
    delete ns.style.display;
  }
  if (ns.style.overflow) {
    ns.overflow = ns.style.overflow;
    delete ns.style.overflow;
  }

  return ns;
};

const getPromptFromTemplate = async (tmplName, userPrompt, extraCtx = {}) => {
  const tables = await Table.find({});
  const context = {
    Table,
    tables,
    View,
    userTable: Table.findOne("users"),
    scState: getState(),
    userPrompt,
    ...extraCtx,
  };
  const fp = path.join(__dirname, "prompts", tmplName);
  const fileBuf = await fsp.readFile(fp);
  const tmpl = fileBuf.toString();
  const template = _.template(tmpl, {
    evaluate: /\{\{#(.+?)\}\}/g,
    interpolate: /\{\{([^#].+?)\}\}/g,
  });
  const prompt = template(context);
  //console.log("Full prompt:\n", prompt);
  return prompt;
};

const getCompletion = async (language, prompt) => {
  return getState().functions.llm_generate.run(prompt, {
    systemPrompt: `You are a helpful code assistant. Your language of choice is ${language}. Do not include any explanation, just generate the code block itself.`,
  });
};

const incompleteCfgMsg = () => {
  const plugin_cfgs = getState().plugin_cfgs;

  if (
    !plugin_cfgs["@saltcorn/large-language-model"] &&
    !plugin_cfgs["large-language-model"]
  ) {
    const modName = Object.keys(plugin_cfgs).find((m) =>
      m.includes("large-language-model")
    );
    if (modName)
      return `LLM module not configured. Please configure <a href="/plugins/configure/${encodeURIComponent(
        modName
      )}">here<a> before using copilot.`;
    else
      return `LLM module not configured. Please install and configure <a href="/plugins">here<a> before using copilot.`;
  }
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
    case "Bool":
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
  if (!props.type) {
    switch (field.input_type) {
      case "code":
        props.type = "string";
        break;
    }
  }
  return props;
};

function walk_response(segment) {
  let go = walk_response;
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

function parseHTML(str, processAll) {
  const strHtml = str.includes("```html")
    ? str.split("```html")[1].split("```")[0]
    : str;
  const body = processAll
    ? HTMLParser.parse(strHtml)
    : HTMLParser.parse(strHtml).querySelector("body");
  const btnSizeClasses = new Set(["btn-sm", "btn-xs", "btn-lg"]);

  const go = (node) => {
    //console.log("go node", node.toString());

    if (node.constructor.name === "HTMLElement") {
      switch (node.rawTagName) {
        case "body":
          return { above: node.childNodes.map(go).filter(Boolean) };
        case "script":
          return null;
        case "style":
          return {
            type: "blank",
            isHTML: true,
            contents: `<style>${node.childNodes
              .map((n) => n.toString())
              .join("")}</style>`,
            text_strings: [node.childNodes.map((n) => n.toString()).join("")],
          };
        case "input":
          return {
            type: "blank",
            isHTML: true,
            contents: node.toString(),
            text_strings: [],
          };
        case "a":
          return {
            type: "link",
            url: node.getAttribute("href"),
            text: node.childNodes.map((n) => n.toString()).join(""),
            link_class: (node.classList.value || []).join(" "),
            link_src: "URL",
          };
        case "img":
          return {
            alt: node.getAttribute("alt") || "",
            url: node.getAttribute("src") || "",
            type: "image",
            block: false,
            style: {
              "object-fit": "none",
            },
            srctype: "URL",
            isFormula: {},
            customClass: (node.classList.value || []).join(" "),
          };
        case "button":
          return {
            type: "action",
            block: false,
            rndid: Math.floor(Math.random() * 16777215).toString(16),
            nsteps: 1,
            confirm: false,
            minRole: 100,
            spinner: true,
            isFormula: {},
            action_icon: "",
            action_name: "run_js_code",
            action_label: node.childNodes.map((n) => n.toString()).join(""),
            action_style:
              (node.classList?.value || []).find(
                (c) => c.startsWith("btn-") && !btnSizeClasses.has(c)
              ) || "btn-primary",
            action_size: (node.classList?.value || []).find((c) =>
              btnSizeClasses.has(c)
            ),
            configuration: {
              run_where: "Server",
              code: "return {notify: 'Press button'}",
            },
          };

        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
          return {
            type: "blank",
            contents: node.childNodes.map((n) => n.toString()).join(""),
            customClass: (node.classList.value || []).join(" "),
            textStyle: [node.rawTagName],
          };
        default:
          const containerContents = !node.childNodes.length
            ? ""
            : node.childNodes.length === 1
            ? go(node.childNodes[0]) || ""
            : { above: node.childNodes.map(go).filter(Boolean) };
          return {
            type: "container",
            ...(node.rawTagName && node.rawTagName !== "div"
              ? { htmlElement: node.rawTagName }
              : {}),
            ...(node.id ? { customId: node.id } : {}),
            customClass: (node.classList.value || []).join(" "),
            contents: containerContents,
          };
      }
    } else if (node.constructor.name === "TextNode") {
      if (!node._rawText || !node._rawText.trim()) return null;
      else return { type: "blank", contents: node._rawText };
    }
  };
  //console.log(body.constructor.name);

  //console.log(JSON.stringify(go(body.childNodes[3]), null, 2));
  return go(body);
}

module.exports = {
  getCompletion,
  getPromptFromTemplate,
  incompleteCfgMsg,
  fieldProperties,
  boxHandledStyles,
  containerHandledStyles,
  splitContainerStyle,
  walk_response,
  parseHTML,
};
