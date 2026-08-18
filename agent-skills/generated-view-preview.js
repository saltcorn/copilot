const {
  genericElement,
  pre,
  code,
  escape,
} = require("@saltcorn/markup/tags");

const renderGeneratedViewConfiguration = (configuration) =>
  genericElement(
    "details",
    { class: "mb-3" },
    genericElement(
      "summary",
      {
        class: "small fw-semibold text-secondary",
        style: { cursor: "pointer", userSelect: "none" },
      },
      "Generated view configuration",
    ),
    pre(
      {
        class: "mt-2 mb-0 p-2 border rounded",
        style: {
          maxHeight: "32rem",
          overflow: "auto",
          whiteSpace: "pre",
        },
      },
      code(escape(JSON.stringify(configuration, null, 2))),
    ),
  );

module.exports = { renderGeneratedViewConfiguration };
