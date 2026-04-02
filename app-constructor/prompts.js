const saltcorn_description = `This application will be implemented in Saltcorn, a database application development
environment. 

Saltcorn applications contain the following entity types:

* Tables: These are relational database tables and consists of fields of specified types and rows 
with a value for each field. Fields optionally can be required and/or unique. Every field has a name, 
which is a an identifier that is balid in both JavaScript and SQL, and a label, which is any short 
user-friendly string. Every table has a primary key
(composite primary keys are not supported) which by default is an auto-incrementing integer with 
name \`id\` and label ID. Fields can also be of Key type (foreign key) referencing a primary key 
in another table, or its own table for a self-join. Tables can have 
calculated fields, which can be stored or non-stored. Both stored and non-stored fields are 
defined by a JavaScript expression, but only stored fields can reference other tables with join 
fields and aggregations.

* Views: Views are elementary user interfaces into a database table. A view is defined by applying a 
view template (also sometime called a view pattern, the two are synonymous) to a table with a certain
configuration. The view template defines the fundamental relationship between the UI and the table. For
instance, the Show view template displays a single database row, the Edit view template is a form that 
can create a new row or edit an existing row, the List view template displays multiple rows in a grid. 
Views can embed views, for instance Show can embed another row through a Key field relationship, or 
some views are defined by an underlying view. For instance, the Feed view repeats an underlying view 
for multiple tables. New viewtemplates are provided by plugin modules.

* Triggers: Triggers connect elementary actions (provided by plugin modules) to either a button in the 
user interface, or a periodic (hourly, daily etc) or table (for instance insert on specifc table) event. 
The elementary action each has a number of configuration fields that must be filled in after connecting 
the action to an event, table or button.

* Page: A page has static content but can also embed views for synamic content. Pages can be either 
defined by a Saltcorn layout, for pages that can be edited with drag and drop, or by HTML for more 
flexible graphic designs. HTML pages should be used for landing pages.

* Plugin modules: plugin modules can supply new field types, view templates or actions. Before they can be used,
they need to be installed before they can be used. A plugin may also have a configuration that sets options
for that plugin. Layout themes is Saltcorn are plugin modules.
`;

const existing_tables_list = (tables) => {
  tables.forEach((table) => {
    const fieldLines = table.fields.map(
      (f) =>
        `  * ${f.name} with type: ${f.pretty_type}.${f.description ? ` ${f.description}` : ""}`,
    );
    tableLines.push(
      `${table.name}${
        table.description ? `: ${table.description}.` : "."
      } Contains the following fields:\n${fieldLines.join("\n")}`,
    );
  });
  return `The database already contains the following tables: 

${tableLines.join("\n\n")}`;
};

module.exports = { saltcorn_description, existing_tables_list };
