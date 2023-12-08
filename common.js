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

const getPromptFromTemplate = async (tmplName, userPrompt) => {
  const context = {
    Table,
    View,
    scState: getState(),
    userPrompt,
  };
  const fp = path.join(__dirname, "prompts", tmplName);
  const fileBuf = await fsp.readFile(fp);
  const tmpl = fileBuf.toString();
  const template = _.template(tmpl, {
    evaluate: /\{\{#(.+?)\}\}/g,
    interpolate: /\{\{([^#].+?)\}\}/g,
  });
  const prompt = template(context);
  return prompt;
};

const getCompletion = async (config, prompt) => {
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
        content:
          "You are a helpful code assistant that can teach a junior developer how to code. Your language of choice is JavaScript. Don't explain the code, just generate the code block itself.",
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
