const { eval_expression } = require("@saltcorn/data/models/expression");
const MetaData = require("@saltcorn/data/models/metadata");
const { interpolate } = require("@saltcorn/data/utils");

module.exports = {
  description: "Provide user feedback to the construction manager",
  configFields: ({ table, mode }) => {
    if (mode === "workflow") {
      return [
        {
          name: "title",
          label: "Title",
          sublabel:
            "Feedback title. Use interpolations {{ }} to access variables in the context",
          type: "String",
        },
        {
          name: "description",
          label: "Description",
          sublabel:
            "Feedback description. Use interpolations {{ }} to access variables in the context",
          type: "String",
        },
        {
          name: "url",
          label: "URL",
          sublabel:
            "Feedback URL. Use interpolations {{ }} to access variables in the context",
          type: "String",
        },
      ];
    } else if (table) {
      const textFields = table.fields
        .filter((f) => f.type?.sql_name === "text")
        .map((f) => f.name);
      return [
        {
          name: "title_field",
          label: "Title field",
          type: "String",
          attributes: { options: textFields },
        },
        {
          name: "description_field",
          label: "Description field",
          type: "String",
          attributes: { options: textFields },
        },
        {
          name: "url_field",
          label: "URL field",
          type: "String",
          attributes: { options: textFields },
        },
      ];
    }
  },
  run: async ({
    row,
    table,
    user,
    mode,
    configuration: {
      title,
      description,
      url,
      title_field,
      description_field,
      url_field,
    },
  }) => {
    const use_title =
      mode === "workflow" ? interpolate(title, row, user) : row[title_field];
    const use_description =
      mode === "workflow"
        ? interpolate(description, row, user)
        : row[description_field];
    const use_url =
      mode === "workflow" ? interpolate(url, row, user) : row[url_field];
    await MetaData.create({
      type: "CopilotConstructMgr",
      name: "feedback",
      body: { title: use_title, description: use_description, url: use_url },
      user_id: user?.id,
    });
  },
};
