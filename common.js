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

const getCompletion = async (config, language, prompt) => {
  const client = axios.create({
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + config.api_key,
    },
  });
  const params = {
    //prompt: "How are you?",
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: `You are a helpful code assistant. Your language of choice is ${language}. Do not include any explanation, just generate the code block itself.`,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
  };

  const results = await client.post(
    "https://api.openai.com/v1/chat/completions",
    params
  );

  return results;
};

module.exports = { getCompletion, getPromptFromTemplate };
