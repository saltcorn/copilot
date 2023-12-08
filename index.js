const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const { Configuration, OpenAIApi } = require("./openai/index");
const fsp = require("fs").promises;

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "API key",
        form: async (context) => {
          return new Form({
            fields: [
              {
                name: "api_key",
                label: "API key",
                sublabel: "From your OpenAI account",
                type: "String",
              },
            ],
          });
        },
      },
    ],
  });

const functions = ({ api_key }) => ({
  gpt_generate: {
    run: async (prompt, options = {}) => {
      const configuration = new Configuration({
        apiKey: api_key,
      });
      const openai = new OpenAIApi(configuration);

      const completion = await openai.createCompletion({
        model: "text-davinci-003",
        ...options,
        prompt,
      });
      return completion;
    },
    isAsync: true,
    description: "Generate text with GPT",
    arguments: [{ name: "prompt", type: "String" }],
  },
  delete_tmp_images: {
    run: async (images) => {
      if (Array.isArray(images))
        for (const img of images) {
          await fsp.unlink(img.filePath);
        }
      else if (images.filePath) await fsp.unlink(images.filePath);
    },
    isAsync: true,
    description: "Delete generated temporary files",
  },
});
module.exports = {
  sc_plugin_api_version: 1,
  configuration_workflow,
  viewtemplates: (config) => [require("./action-builder")(config)],
};
