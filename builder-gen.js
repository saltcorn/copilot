const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");

module.exports = {
  run: async (prompt, mode, table) => {
    const str = await getState().functions.llm_generate.run(
      `Generate an HTML snippet according to the requirement below. Your snippet will be 
placed inside a page which has loaded the Bootstrap 5 CSS framework, so you can use any 
Bootstrap 5 classes.

If you need to run javascript in script tag that depends on external reosurces, you wrap this
in a DOMContentLoaded event handler as external javascript resources may be loaded after your HTML snippet is included.

Include only the HTML snippet with no explanation before or after the code snippet.
      
Generate the HTML5 snippet for this request: ${prompt}
`,
    );
    const strHtml = str.includes("```html")
      ? str.split("```html")[1].split("```")[0]
      : str;
    return {
      type: "blank",
      isHTML: true,
      contents: strHtml,
      text_strings: [],
    };
  },
  isAsync: true,
  description: "Generate a builder layout",
  arguments: [
    { name: "prompt", type: "String" },
    { name: "mode", type: "String" },
    { name: "table", type: "String" },
  ],
};
