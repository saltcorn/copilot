const axios = require("axios");
const fsp = require("fs").promises;
const _ = require("underscore");
const path = require("path");
const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const { getState } = require("@saltcorn/data/db/state");

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
  console.log("Full prompt:\n", prompt);
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

module.exports = { getCompletion, getPromptFromTemplate, incompleteCfgMsg };
