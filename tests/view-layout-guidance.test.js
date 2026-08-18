const { SHOW_LAYOUT_GUIDANCE } = require("../view-layout-guidance");
const { implementation_rules } = require("../app-constructor/fixed-prompts");

describe("Show view layout guidance", () => {
  test("uses blank segments for literal labels and rejects text segments", () => {
    expect(SHOW_LAYOUT_GUIDANCE).toContain(
      '{"type":"blank","contents":"Category"}',
    );
    expect(SHOW_LAYOUT_GUIDANCE).toContain('no "text" segment type');
    expect(SHOW_LAYOUT_GUIDANCE).toContain('never emit {"type":"text"}');
  });

  test("documents both sides of direct and related field pairs", () => {
    expect(SHOW_LAYOUT_GUIDANCE).toContain('"type":"field"');
    expect(SHOW_LAYOUT_GUIDANCE).toContain('"type":"Field"');
    expect(SHOW_LAYOUT_GUIDANCE).toContain('"type":"join_field"');
    expect(SHOW_LAYOUT_GUIDANCE).toContain('"type":"JoinField"');
    expect(SHOW_LAYOUT_GUIDANCE).toContain(
      '"join_field":"category_id.description"',
    );
  });

  test("is included in App Constructor implementation rules", () => {
    expect(implementation_rules).toContain(SHOW_LAYOUT_GUIDANCE);
  });
});
