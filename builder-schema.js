const { getState } = require("@saltcorn/data/db/state");

const ACTION_SIZES = ["btn-sm", "btn-lg"];
const BG_TYPES = ["None", "Color", "Image", "Gradient"];
const IMAGE_LOCATIONS = ["Top", "Card", "Body"];
const IMAGE_SIZES = ["cover", "contain", "repeat"];
const TEXT_STYLE_OPTIONS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "fst-italic",
  "text-muted",
  "fw-bold",
  "text-underline",
  "small",
  "font-monospace",
];

const TOOLBOX_BY_MODE = {
  show: [
    "blank",
    "columns",
    "field",
    "line_break",
    "join_field",
    "view_link",
    "action",
    "link",
    "aggregation",
    "view",
    "container",
    "card",
    "tabs",
    "image",
    "dropdown_menu",
    "table",
    "page",
  ],
  list: [
    "blank",
    "field",
    "join_field",
    "view_link",
    "action",
    "link",
    "aggregation",
    "view",
    "container",
    "dropdown_menu",
    "line_break",
  ],
  filter: [
    "blank",
    "columns",
    "field",
    "line_break",
    "dropdown_filter",
    "toggle_filter",
    "search_bar",
    "action",
    "aggregation",
    "container",
    "card",
    "tabs",
    "view",
    "link",
    "table",
    "dropdown_menu",
    "page",
  ],
  edit: [
    "blank",
    "columns",
    "field",
    "line_break",
    "action",
    "container",
    "card",
    "tabs",
    "link",
    "image",
    "view",
    "join_field",
    "dropdown_menu",
    "table",
    "view_link",
  ],
  page: [
    "blank",
    "columns",
    "line_break",
    "card",
    "image",
    "link",
    "view",
    "search_bar",
    "action",
    "container",
    "tabs",
    "dropdown_menu",
    "page",
    "table",
  ],
};

const makeEnum = (values, description) => {
  if (!values || !values.length) {
    return { type: "string", description };
  }
  return { type: "string", enum: values, description };
};

const buildSegmentDef = ({
  type,
  description,
  properties,
  required = [],
  additionalProperties = true,
}) => ({
  type: "object",
  description,
  required: ["type", ...required],
  properties: {
    type: { const: type, description: `Segment type: ${type}.` },
    ...properties,
  },
  additionalProperties,
});

const buildBuilderSchema = ({ mode, ctx }) => {
  console.log({ ctx });
  const normalizedMode = (mode || ctx?.mode || "show").toLowerCase();
  const fields = ctx?.fields || [];
  const actions = ctx?.actions || [];
  const views = ctx?.viewNames || [];
  const rawIcons = getState().icons || [];
  const icons = (
    Array.isArray(rawIcons) ? rawIcons : Object.keys(rawIcons)
  ).slice(0, 15);

  const fieldNames = fields.map((f) => f.name).filter(Boolean);
  const fieldviewOptions = Array.from(
    new Set(fields.flatMap((f) => f.fieldviews || []).filter(Boolean)),
  );

  const defs = {
    segment: { anyOf: [] },
    any_value: {
      type: ["string", "number", "boolean", "object", "array", "null"],
      description: "Any JSON value.",
    },
  };

  if (fieldNames.length) {
    defs.field_name_enum = makeEnum(fieldNames, "Field name.");
  }
  if (fieldviewOptions.length) {
    defs.fieldview_enum = makeEnum(fieldviewOptions, "Field view name.");
  }
  if (actions.length) {
    defs.action_name_enum = makeEnum(actions, "Action name.");
  }
  if (views.length) {
    defs.view_name_enum = makeEnum(views, "View name.");
  }
  if (icons.length) {
    defs.icon_enum = makeEnum(icons, "Icon name.");
  }
  defs.text_style_enum = makeEnum(TEXT_STYLE_OPTIONS, "Text style class name.");

  defs.stack = {
    type: "object",
    description: "Vertical stack of segments.",
    required: ["above"],
    properties: {
      above: {
        type: "array",
        minItems: 1,
        items: { $ref: "#/$defs/segment" },
        description: "Stacked segments (top to bottom).",
      },
    },
  };

  defs.columns = {
    type: "object",
    description: "Horizontal columns of segments.",
    required: ["besides"],
    properties: {
      besides: {
        type: "array",
        minItems: 2,
        items: { anyOf: [{ $ref: "#/$defs/segment" }, { type: "null" }] },
        description: "Column segments (left to right).",
      },
      widths: {
        type: "array",
        items: { type: "integer", minimum: 1, maximum: 12 },
        description: "Bootstrap column widths (sum to 12).",
      },
      breakpoints: {
        type: "array",
        items: { type: "string" },
        description: "Responsive breakpoints per column.",
      },
      style: {
        type: "object",
        description: "Inline style overrides for the row.",
        additionalProperties: true,
      },
      gx: { type: "number", description: "Horizontal gutter size." },
      gy: { type: "number", description: "Vertical gutter size." },
      customClass: { type: "string", description: "Extra CSS class names." },
    },
    additionalProperties: true,
  };

  const textStyleSchema = defs.text_style_enum
    ? {
        anyOf: [
          { $ref: "#/$defs/text_style_enum" },
          { type: "array", items: { $ref: "#/$defs/text_style_enum" } },
        ],
        description: "Text styles (single or list).",
      }
    : { type: ["string", "array"], description: "Text styles." };

  const backgroundProps = {
    bgType: makeEnum(BG_TYPES, "Background type."),
    bgColor: {
      type: "string",
      description: "Background color (hex).",
    },
    bgFileId: {
      type: ["number", "string"],
      description: "Background file id for images.",
    },
    imageLocation: makeEnum(
      IMAGE_LOCATIONS,
      "Image location for card/container backgrounds.",
    ),
    imageSize: makeEnum(
      IMAGE_SIZES,
      "Image sizing for Card or Body locations.",
    ),
    gradStartColor: {
      type: "string",
      description: "Gradient start color (hex).",
    },
    gradEndColor: {
      type: "string",
      description: "Gradient end color (hex).",
    },
    gradDirection: {
      type: ["number", "string"],
      description: "Gradient direction (degrees).",
    },
  };

  const blankDef = buildSegmentDef({
    type: "blank",
    description: "Plain text block.",
    properties: {
      contents: { type: "string", description: "Text contents." },
      block: { type: "boolean", description: "Render as block element." },
      inline: { type: "boolean", description: "Render inline." },
      textStyle: textStyleSchema,
      labelFor: { type: "string", description: "Label for field name." },
      customClass: { type: "string", description: "Extra CSS class names." },
      style: {
        type: "object",
        description: "Inline style overrides.",
        additionalProperties: true,
      },
      icon: defs.icon_enum
        ? { $ref: "#/$defs/icon_enum", description: "Optional icon." }
        : { type: "string", description: "Optional icon." },
      font: { type: "string", description: "Font family name." },
    },
  });

  const fieldDef = buildSegmentDef({
    type: "field",
    description: "Field segment.",
    properties: {
      field_name: defs.field_name_enum
        ? { $ref: "#/$defs/field_name_enum", description: "Field name." }
        : { type: "string", description: "Field name." },
      fieldview: defs.fieldview_enum
        ? { $ref: "#/$defs/fieldview_enum", description: "Field view." }
        : { type: "string", description: "Field view." },
      configuration: {
        type: "object",
        description: "Fieldview configuration.",
        additionalProperties: true,
      },
      textStyle: textStyleSchema,
      block: { type: "boolean", description: "Render as block element." },
      inline: { type: "boolean", description: "Render inline." },
      class: { type: "string", description: "Extra CSS class names." },
    },
  });

  const actionDef = buildSegmentDef({
    type: "action",
    description: "Action button segment.",
    properties: {
      action_name: defs.action_name_enum
        ? { $ref: "#/$defs/action_name_enum", description: "Action name." }
        : { type: "string", description: "Action name." },
      action_label: { type: "string", description: "Button label." },
      action_style: { type: "string", description: "Button style class." },
      action_size: {
        type: "string",
        enum: ACTION_SIZES,
        description: "Button size class.",
      },
      action_icon: defs.icon_enum
        ? { $ref: "#/$defs/icon_enum", description: "Optional icon." }
        : { type: "string", description: "Optional icon." },
      action_class: { type: "string", description: "Extra CSS class names." },
      action_title: { type: "string", description: "Button title text." },
      action_bgcol: { type: "string", description: "Button background color." },
      action_bordercol: {
        type: "string",
        description: "Button border color.",
      },
      action_textcol: { type: "string", description: "Button text color." },
      confirm: { type: "string", description: "Confirmation prompt." },
      minRole: { type: "number", description: "Minimum role id." },
      nsteps: { type: "number", description: "Number of workflow steps." },
      configuration: {
        type: "object",
        description: "Action configuration.",
        additionalProperties: true,
      },
    },
  });

  const viewDef = buildSegmentDef({
    type: "view",
    description: "Embedded view.",
    properties: {
      view: defs.view_name_enum
        ? { $ref: "#/$defs/view_name_enum", description: "View name." }
        : { type: "string", description: "View name." },
      state: {
        type: "object",
        description: "View state overrides.",
        additionalProperties: true,
      },
      relation: { type: "string", description: "Relation name." },
      order_field: { type: "string", description: "Order field name." },
      view_name: { type: "string", description: "View name override." },
      name: { type: "string", description: "View instance name." },
      configuration: {
        type: "object",
        description: "View configuration.",
        additionalProperties: true,
      },
      extra_state_fml: {
        type: "string",
        description: "Extra state formula.",
      },
    },
  });

  const viewLinkDef = buildSegmentDef({
    type: "view_link",
    description: "Link to a view.",
    properties: {
      view: defs.view_name_enum
        ? { $ref: "#/$defs/view_name_enum", description: "View name." }
        : { type: "string", description: "View name." },
      view_label: { type: "string", description: "Link label." },
      link_style: { type: "string", description: "Link style class." },
      class: { type: "string", description: "Extra CSS class names." },
    },
  });

  const containerDef = buildSegmentDef({
    type: "container",
    description: "Container wrapper.",
    properties: {
      contents: { $ref: "#/$defs/segment", description: "Nested contents." },
      class: { type: "string", description: "Extra CSS class names." },
      customClass: { type: "string", description: "Custom CSS class names." },
      style: {
        type: "object",
        description: "Inline style overrides.",
        additionalProperties: true,
      },
      ...backgroundProps,
    },
  });

  const cardDef = buildSegmentDef({
    type: "card",
    description: "Card wrapper.",
    properties: {
      title: { type: "string", description: "Card title." },
      contents: { $ref: "#/$defs/segment", description: "Card contents." },
      class: { type: "string", description: "Extra CSS class names." },
      customClass: { type: "string", description: "Custom CSS class names." },
      style: {
        type: "object",
        description: "Inline style overrides.",
        additionalProperties: true,
      },
      shadow: { type: "boolean", description: "Enable card shadow." },
      noPadding: { type: "boolean", description: "Disable card padding." },
      hasFooter: { type: "boolean", description: "Enable footer area." },
      ...backgroundProps,
    },
  });

  const tabsDef = buildSegmentDef({
    type: "tabs",
    description: "Tabbed content.",
    properties: {
      contents: {
        type: "array",
        items: { $ref: "#/$defs/segment" },
        description: "Tab contents array.",
      },
      titles: {
        type: "array",
        items: { type: "object" },
        description: "Tab titles array.",
      },
      tabs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            contents: { $ref: "#/$defs/segment" },
          },
        },
        description: "Tabs with explicit titles and contents.",
      },
      class: { type: "string", description: "Extra CSS class names." },
    },
  });

  const imageDef = buildSegmentDef({
    type: "image",
    description: "Image segment.",
    properties: {
      url: { type: "string", description: "Image URL or file path." },
      src: { type: "string", description: "Image src alias." },
      alt: { type: "string", description: "Alt text." },
      class: { type: "string", description: "Extra CSS class names." },
      style: {
        type: "object",
        description: "Inline style overrides.",
        additionalProperties: true,
      },
    },
  });

  const linkDef = buildSegmentDef({
    type: "link",
    description: "Link segment.",
    properties: {
      url: { type: "string", description: "Link URL." },
      text: { type: "string", description: "Link text." },
      link_style: { type: "string", description: "Link style class." },
      class: { type: "string", description: "Extra CSS class names." },
      icon: defs.icon_enum
        ? { $ref: "#/$defs/icon_enum", description: "Optional icon." }
        : { type: "string", description: "Optional icon." },
    },
  });

  const lineBreakDef = buildSegmentDef({
    type: "line_break",
    description: "Line break / divider.",
    properties: {
      class: { type: "string", description: "Extra CSS class names." },
    },
  });

  const searchBarDef = buildSegmentDef({
    type: "search_bar",
    description: "Search bar segment.",
    properties: {
      class: { type: "string", description: "Extra CSS class names." },
    },
  });

  const tableDef = buildSegmentDef({
    type: "table",
    description: "Table layout segment.",
    properties: {
      rows: { type: "integer", description: "Number of rows." },
      columns: { type: "integer", description: "Number of columns." },
      contents: {
        type: "array",
        items: {
          type: "array",
          items: { $ref: "#/$defs/segment" },
        },
        description: "Row/column contents as nested segments.",
      },
      bs_style: { type: "string", description: "Bootstrap table style." },
      bs_small: { type: "boolean", description: "Small table style." },
      bs_striped: { type: "boolean", description: "Striped rows." },
      bs_bordered: { type: "boolean", description: "Bordered table." },
      bs_borderless: { type: "boolean", description: "Borderless table." },
      bs_wauto: { type: "boolean", description: "Auto width table." },
      customClass: { type: "string", description: "Extra CSS class names." },
    },
  });

  const aggregationDef = buildSegmentDef({
    type: "aggregation",
    description: "Aggregation segment.",
    properties: {
      agg_relation: { type: "string", description: "Aggregation relation." },
      agg_field: { type: "string", description: "Aggregation field." },
      agg_func: { type: "string", description: "Aggregation function." },
      label: { type: "string", description: "Label text." },
    },
  });

  const dropdownFilterDef = buildSegmentDef({
    type: "dropdown_filter",
    description: "Dropdown filter segment.",
    properties: {
      field_name: defs.field_name_enum
        ? { $ref: "#/$defs/field_name_enum", description: "Field name." }
        : { type: "string", description: "Field name." },
      label: { type: "string", description: "Label text." },
    },
  });

  const toggleFilterDef = buildSegmentDef({
    type: "toggle_filter",
    description: "Toggle filter segment.",
    properties: {
      field_name: defs.field_name_enum
        ? { $ref: "#/$defs/field_name_enum", description: "Field name." }
        : { type: "string", description: "Field name." },
      label: { type: "string", description: "Label text." },
    },
  });

  const dropdownMenuDef = buildSegmentDef({
    type: "dropdown_menu",
    description: "Dropdown menu segment.",
    properties: {
      label: { type: "string", description: "Menu label." },
      class: { type: "string", description: "Extra CSS class names." },
    },
  });

  const joinFieldDef = buildSegmentDef({
    type: "join_field",
    description: "Join field segment.",
    properties: {
      field_name: defs.field_name_enum
        ? { $ref: "#/$defs/field_name_enum", description: "Field name." }
        : { type: "string", description: "Field name." },
      view: defs.view_name_enum
        ? { $ref: "#/$defs/view_name_enum", description: "View name." }
        : { type: "string", description: "View name." },
      label: { type: "string", description: "Label text." },
    },
  });

  const listColumnDef = buildSegmentDef({
    type: "list_column",
    description: "List column segment.",
    properties: {
      contents: { $ref: "#/$defs/segment", description: "Column contents." },
      col_width: { type: "number", description: "Column width value." },
      col_width_units: { type: "string", description: "Width units." },
      alignment: { type: "string", description: "Text alignment." },
      header_label: { type: "string", description: "Header label." },
      showif: { type: "string", description: "Show-if formula." },
    },
  });

  const listColumnsDef = buildSegmentDef({
    type: "list_columns",
    description: "List columns wrapper.",
    properties: {
      besides: {
        type: "array",
        items: { $ref: "#/$defs/segment" },
        description: "List column segments.",
      },
      list_columns: {
        type: "boolean",
        description: "Marks list columns container.",
      },
    },
  });

  const pageDef = buildSegmentDef({
    type: "page",
    description: "Page embed segment.",
    properties: {
      page: { type: "string", description: "Page name." },
      title: { type: "string", description: "Page title." },
    },
  });

  defs.segment.anyOf.push(
    { $ref: "#/$defs/stack" },
    { $ref: "#/$defs/columns" },
    { $ref: "#/$defs/blank" },
    { $ref: "#/$defs/field" },
    { $ref: "#/$defs/action" },
    { $ref: "#/$defs/view" },
    { $ref: "#/$defs/view_link" },
    { $ref: "#/$defs/container" },
    { $ref: "#/$defs/card" },
    { $ref: "#/$defs/tabs" },
    { $ref: "#/$defs/image" },
    { $ref: "#/$defs/link" },
    { $ref: "#/$defs/line_break" },
    { $ref: "#/$defs/search_bar" },
    { $ref: "#/$defs/table" },
    { $ref: "#/$defs/aggregation" },
    { $ref: "#/$defs/dropdown_filter" },
    { $ref: "#/$defs/toggle_filter" },
    { $ref: "#/$defs/dropdown_menu" },
    { $ref: "#/$defs/join_field" },
    { $ref: "#/$defs/list_column" },
    { $ref: "#/$defs/list_columns" },
    { $ref: "#/$defs/page" },
  );

  Object.assign(defs, {
    blank: blankDef,
    field: fieldDef,
    action: actionDef,
    view: viewDef,
    view_link: viewLinkDef,
    container: containerDef,
    card: cardDef,
    tabs: tabsDef,
    image: imageDef,
    link: linkDef,
    line_break: lineBreakDef,
    search_bar: searchBarDef,
    table: tableDef,
    aggregation: aggregationDef,
    dropdown_filter: dropdownFilterDef,
    toggle_filter: toggleFilterDef,
    dropdown_menu: dropdownMenuDef,
    join_field: joinFieldDef,
    list_column: listColumnDef,
    list_columns: listColumnsDef,
    page: pageDef,
  });

  return {
    schema: {
      type: "object",
      required: ["layout"],
      properties: {
        layout: { $ref: "#/$defs/segment" },
      },
      $defs: defs,
    },
    meta: {
      mode: normalizedMode,
      table: ctx?.table ? { id: ctx.table.id, name: ctx.table.name } : null,
      allowedComponents: TOOLBOX_BY_MODE[normalizedMode] || [],
      fields: fields.map((f) => ({ name: f.name, label: f.label })),
      actions,
      views,
    },
  };
};

module.exports = {
  buildBuilderSchema,
  TOOLBOX_BY_MODE,
};
