const { getState } = require("@saltcorn/data/db/state");
const WorkflowStep = require("@saltcorn/data/models/workflow_step");
const Trigger = require("@saltcorn/data/models/trigger");
const Table = require("@saltcorn/data/models/table");
const { getActionConfigFields } = require("@saltcorn/data/plugin-helper");
const { getPromptFromTemplate } = require("./common");

const scTypeToTsType = (type, field) => {
  if (field?.is_fkey) {
    if (field.reftype) return scTypeToTsType(field.reftype);
  }
  return (
    {
      String: "string",
      Integer: "number",
      Float: "number",
      Bool: "boolean",
      Date: "Date",
      HTML: "string",
    }[type?.name || type] || "any"
  );
};

module.exports = {
  run: async ({ table, language, has_table, has_functions }) => {
    if (language === "javascript") {
      let prompts = [``];
      if (has_table)
        prompts.push(await getPromptFromTemplate("action-builder.txt", ""));
      if (!has_table)
        prompts.push(`Your code can can manipulate rows in the database, manipulate files, interact 
with remote APIs, or issue directives for the user's display.

Your code can use await at the top level, and should do so whenever calling 
database queries or other aynchronous code (see examples below)
`);
      if (has_functions) {
        const ds = [];
        for (const [nm, f] of Object.entries(getState().functions)) {
          const comment = f.description ? " // " + f.description : "";
          const returns =
            f.returns || f.tsreturns
              ? ": " + (f.tsreturns || scTypeToTsType(f.returns))
              : "";
          if (nm === "today") {
            ds.push(
              `function today(offset_days?: number | {startOf:  "year" | "quarter" | "month" | "week" | "day" | "hour"} | {endOf:  "year" | "quarter" | "month" | "week" | "day" | "hour"}): Date`,
            );
          }
          if (nm === "slugify") {
            ds.push(`function slugify(s: string): string`);
          } else if (f.run) {
            if (f["arguments"]) {
              const args = (f["arguments"] || []).map(
                ({ name, type, tstype, required }) =>
                  `${name}${required ? "" : "?"}: ${tstype || scTypeToTsType(type)}`,
              );
              ds.push(
                `${f.isAsync ? "async " : ""}function ${nm}(${args.join(", ")})${returns}${comment}`,
              );
            } else
              ds.push(
                `declare var ${nm}: ${f.isAsync ? "AsyncFunction" : "Function"}${comment}`,
              );
          } else ds.push(`declare const ${nm}: Function;${comment}`);
        }
        prompts.push(`You can also call some functions, here with TypeScript declarations (although you are writing JavaScript): 

${ds.join("\n")}`);
      }
      return prompts.join("\n");
    }
  },
  isAsync: true,
  description: "Return a standard prompt for writing code",
  arguments: [
    {
      name: "options",
      type: "JSON",
      tstype: `{language: "javascript", table?:string, has_table?: boolean, has_functions?:boolean}`,
    },
  ],
};
