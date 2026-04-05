const viewname = "Saltcorn AppConstructor (experimental)";

const tool_choice = (tool_name) => ({
  tool_choice: {
    type: "function",
    function: {
      name: tool_name,
    },
  },
});

module.exports = { viewname, tool_choice };
