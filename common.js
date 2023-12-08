const axios = require("axios");
const fsp = require("fs").promises;

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
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
  };

  const results = await client.post(
    "https://api.openai.com/v1/chat/completions",
    params
  );

  return results;
};

module.exports = { getCompletion };
