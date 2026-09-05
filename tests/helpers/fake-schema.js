// Minimal table/view fixtures shaped the way @saltcorn/common-code's
// RelationsFinder expects (see RelationsFinder + buildTableCaches): tables
// need {id, name, foreign_keys: [{name, table_id, reftable_name, is_unique}]},
// views need {name, table_id, viewtemplate, display_type}.
// display_type "NO_ROW_LIMIT" = List-like (multi-row), "ROW_REQUIRED" = Show-like.

/**
 * A small "zookeeper app" schema: a zookeeper table and a task table with an
 * inbound FK (zookeeper_id) to it, plus a List view over tasks and a Show
 * view over zookeepers - the shape needed to exercise "embed a list on a
 * page, scoped to the current zookeeper via a relation path".
 */
const zookeeperAppSchema = () => {
  const tables = [
    { id: 1, name: "zookeepers", foreign_keys: [] },
    {
      id: 2,
      name: "tasks",
      foreign_keys: [
        {
          name: "zookeeper_id",
          id: 100,
          table_id: 2,
          reftable_name: "zookeepers",
          is_unique: false,
        },
      ],
    },
  ];
  const views = [
    {
      name: "zookeeper_show",
      table_id: 1,
      viewtemplate: "Show",
      display_type: "ROW_REQUIRED",
    },
    {
      name: "tasks_list",
      table_id: 2,
      viewtemplate: "List",
      display_type: "NO_ROW_LIMIT",
    },
  ];
  return { tables, views };
};

module.exports = { zookeeperAppSchema };
