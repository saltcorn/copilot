jest.mock("@saltcorn/markup/tags", () => {
  const escapeText = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const renderAttributes = (attributes = {}) =>
    Object.entries(attributes)
      .map(([key, value]) => {
        if (key === "style") {
          const style = Object.entries(value)
            .map(([name, setting]) =>
              `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${setting}`,
            )
            .join(";");
          return ` style="${style}"`;
        }
        return ` ${key}="${value}"`;
      })
      .join("");
  const tag = (name) => (attributes, ...children) => {
    if (typeof attributes !== "object") return `<${name}>${attributes}</${name}>`;
    return `<${name}${renderAttributes(attributes)}>${children.join("")}</${name}>`;
  };
  return {
    genericElement: (name, attributes, ...children) =>
      `<${name}${renderAttributes(attributes)}>${children.join("")}</${name}>`,
    pre: tag("pre"),
    code: tag("code"),
    escape: escapeText,
  };
});

const {
  renderGeneratedViewConfiguration,
} = require("../agent-skills/generated-view-preview");

describe("generated view configuration preview", () => {
  test("renders a collapsed details disclosure by default", () => {
    const html = renderGeneratedViewConfiguration({ layout: { above: [] } });

    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Generated view configuration");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[=\s>])/);
  });

  test("renders formatted JSON only inside the disclosure", () => {
    const html = renderGeneratedViewConfiguration({ name: "example" });

    expect(html.indexOf("<summary")).toBeLessThan(html.indexOf("<pre"));
    expect(html).toContain("&quot;name&quot;: &quot;example&quot;");
    expect(html).toContain("max-height:32rem");
    expect(html).toContain("overflow:auto");
  });

  test("escapes generated values before inserting them into HTML", () => {
    const html = renderGeneratedViewConfiguration({
      contents: '<script>alert("x")</script>',
    });

    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
  });
});
