const SHOW_LAYOUT_GUIDANCE = `**Show view layout schema:**
When adding or replacing standard segments in a Show view, use only these runtime segment types: blank, field, join_field, aggregation, action, view_link, view, link, image, card, tabs, container, table, breadcrumbs, dropdown_menu, line_break, search_bar, page, pageHeader, or prompt. Objects containing above or besides are structural layout containers and may have no type. Preserve any pre-existing plugin-specific segments unchanged.

Use these exact data-display patterns:
* Static label or other literal text: {"type":"blank","contents":"Category"}. Omit isFormula or set it to false. There is no "text" segment type; never emit {"type":"text"}.
* Direct table field: put {"type":"field","field_name":"title","fieldview":"show"} in the layout and a matching {"type":"Field","field_name":"title","fieldview":"show"} entry in configuration.columns.
* Related field reached through a foreign key: put {"type":"join_field","join_field":"category_id.description"} in the layout and a matching {"type":"JoinField","join_field":"category_id.description"} entry in configuration.columns. Both entries are required, and the join_field path must be identical in both. Use this native pair instead of writing {{category_id.description}} in a blank segment.

Keep every existing configuration.columns entry unless the requested change explicitly removes it, and add any Field or JoinField entries required by newly added layout segments.`;

module.exports = { SHOW_LAYOUT_GUIDANCE };
