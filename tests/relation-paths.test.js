let mockRelations = [];
const mockFinderDepths = [];

jest.mock("@saltcorn/common-code", () => ({
  RelationType: {
    OWN: "Own",
    INDEPENDENT: "Independent",
    PARENT_SHOW: "ParentShow",
    ONE_TO_ONE_SHOW: "OneToOneShow",
    CHILD_LIST: "ChildList",
  },
  RelationsFinder: class {
    constructor(_tables, _views, maxDepth) {
      mockFinderDepths.push(maxDepth);
    }

    findRelations() {
      return mockRelations;
    }
  },
}));

const {
  getRelationPathsForPairs,
  selectRelationPaths,
} = require("../relation-paths");

const relation = (relationString, type = "ChildList") => ({
  relationString,
  type,
});

const schemaData = {
  tables: [{ name: "articles" }, { name: "photos" }],
  views: [{ name: "photos_list", table_name: "photos" }],
};

describe("relation path result bounds", () => {
  beforeEach(() => {
    mockRelations = [];
    mockFinderDepths.length = 0;
  });

  test("starts relation searches at depth two", () => {
    getRelationPathsForPairs(
      [{ source_table: "articles", target_view: "photos_list" }],
      schemaData,
    );

    expect(mockFinderDepths).toEqual([2]);
  });

  test("uses an explicitly requested search depth", () => {
    getRelationPathsForPairs(
      [{ source_table: "articles", target_view: "photos_list" }],
      schemaData,
      4,
    );

    expect(mockFinderDepths).toEqual([4]);
  });

  test("keeps the shortest 40 paths and reports omissions", () => {
    mockRelations = Array.from({ length: 200 }, (_, ix) =>
      relation(`.articles.long_${ix}.branch.more.photos$article_id`),
    );
    mockRelations.push(relation(".articles.photos$article_id"));

    const [result] = getRelationPathsForPairs(
      [{ source_table: "articles", target_view: "photos_list" }],
      schemaData,
      6,
    );

    expect((result.match(/ — /g) || []).length).toBe(40);
    expect(result).toContain('".articles.photos$article_id"');
    expect(result).toContain("161 additional paths omitted");
  });

  test("retains candidates from different relation types", () => {
    const relations = Array.from({ length: 80 }, (_, ix) =>
      relation(`.articles.child_${ix}.photos$article_id`),
    );
    relations.push(relation(".articles.owner_id", "ParentShow"));

    const { selected } = selectRelationPaths(relations, 10);

    expect(selected.some((r) => r.type === "ParentShow")).toBe(true);
  });
});
