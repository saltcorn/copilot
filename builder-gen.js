const { getState } = require("@saltcorn/data/db/state");
const Table = require("@saltcorn/data/models/table");
const Trigger = require("@saltcorn/data/models/trigger");
const View = require("@saltcorn/data/models/view");
const { edit_build_in_actions } = require("@saltcorn/data/viewable_fields");
const { buildBuilderSchema } = require("./builder-schema");

const ACTION_SIZES = ["btn-sm", "btn-lg"];
const MODE_GUIDANCE = {
  edit: "Layout is a form for editing a single row. Include required inputs with edit fieldviews, group related inputs, and finish with a Save action.",
  show: "Layout displays one record read-only. Use show fieldviews, blank headings, and optional follow-up actions.",
  list: "Layout represents a single row in a list. Highlight key fields, keep actions compact, and support filtering if requested.",
  filter:
    "Layout lets users define filters. Provide appropriate filter inputs plus an action to run or reset filters.",
  page: "Layout builds a general app page. Combine hero text, cards, containers, and call-to-action buttons.",
  default:
    "Use Saltcorn layout primitives (above, besides, container, card, tabs, blank, field, action, view_link, view). Do not return HTML snippets.",
};

const stripCodeFences = (text) => text.replace(/```(?:json)?/gi, "").trim();

const stripHtmlTags = (text) =>
  String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const attrValue = (node, key) => {
  if (!node) return undefined;
  if (Object.prototype.hasOwnProperty.call(node, key)) return node[key];
  if (
    node.attributes &&
    Object.prototype.hasOwnProperty.call(node.attributes, key)
  )
    return node.attributes[key];
  return undefined;
};

const pickAttrValue = (node, keys) => {
  for (const key of keys) {
    const val = attrValue(node, key);
    if (val !== undefined) return val;
  }
  return undefined;
};

const firstItem = (value) => (Array.isArray(value) ? value[0] : value);

const findBalancedBlock = (text, openChar, closeChar) => {
  const start = text.indexOf(openChar);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

const extractJsonStructure = (text) => {
  if (!text) return null;
  const cleaned = stripCodeFences(String(text));
  const attempt = (candidate) => {
    if (!candidate) return null;
    try {
      return JSON.parse(candidate);
    } catch (err) {
      return null;
    }
  };

  const trimmed = cleaned.trim();
  let parsed = attempt(trimmed);
  if (parsed) return parsed;

  const eqIdx = trimmed.indexOf("=");
  if (eqIdx !== -1) {
    parsed = attempt(trimmed.slice(eqIdx + 1).trim());
    if (parsed) return parsed;
  }

  const arrayBlock = findBalancedBlock(trimmed, "[", "]");
  if (arrayBlock) {
    parsed = attempt(arrayBlock);
    if (parsed) return parsed;
  }
  const objectBlock = findBalancedBlock(trimmed, "{", "}");
  if (objectBlock) {
    parsed = attempt(objectBlock);
    if (parsed) return parsed;
  }
  return null;
};

const randomId = () =>
  Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");

const ensureArray = (value) =>
  Array.isArray(value) ? value : value == null ? [] : [value];

const prettifyActionName = (name) =>
  (name || "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

// Picks a valid fieldview from the field's available fieldviews only.
// Never returns a fieldview that doesn't exist in field.fieldviews
const pickFieldview = (field, mode, requestedFieldview = null) => {
  const availableViews = field?.fieldviews || [];

  // If no available fieldviews, return the first one or a safe default
  if (!availableViews.length) {
    // Return the first available or fall back based on mode
    return mode === "edit" || mode === "filter" ? "edit" : "show";
  }

  // Helper to validate and return a fieldview only if it exists
  const validateAndReturn = (candidate) => {
    if (!candidate) return null;
    const lower = String(candidate).toLowerCase();
    // Exact match
    const exact = availableViews.find(
      (fv) => String(fv).toLowerCase() === lower,
    );
    if (exact) return exact;
    // Fuzzy match (contains)
    const fuzzy = availableViews.find((fv) =>
      String(fv).toLowerCase().includes(lower),
    );
    if (fuzzy) return fuzzy;
    return null;
  };

  // If a specific fieldview was requested by the user, try to honor it
  // but ONLY if it actually exists in available views
  if (requestedFieldview) {
    const validated = validateAndReturn(requestedFieldview);
    if (validated) return validated;
    // Requested fieldview not available for this field - fall through to defaults
  }

  // Get the field's configured default fieldview
  const defaultFieldview =
    field?.default_fieldview || field?.defaultFieldview || field?.fieldview;

  if (defaultFieldview) {
    const validated = validateAndReturn(defaultFieldview);
    if (validated) return validated;
  }

  // Mode-based selection from available fieldviews
  if (mode === "show" || mode === "list") {
    // For show mode, prefer simple text-based views, but only from available views
    const showPreferences = ["as_text", "show", "as_string", "text", "showas"];
    for (const pref of showPreferences) {
      const match = availableViews.find((fv) =>
        String(fv).toLowerCase().includes(pref),
      );
      if (match) return match;
    }
  } else if (mode === "edit" || mode === "filter") {
    // For edit mode, prefer edit-capable fieldviews from available views
    const editPreferences = ["edit", "input", "select", "textarea"];
    for (const pref of editPreferences) {
      const match = availableViews.find((fv) =>
        String(fv).toLowerCase().includes(pref),
      );
      if (match) return match;
    }
  }

  // Fall back to first available fieldview - this is always valid
  return availableViews[0];
};

const evenWidths = (count) => {
  if (!count) return [];
  const widths = Array(count).fill(Math.max(1, Math.floor(12 / count)));
  let total = widths.reduce((sum, n) => sum + n, 0);
  let idx = 0;
  while (total < 12) {
    widths[idx] += 1;
    total += 1;
    idx = (idx + 1) % count;
  }
  while (total > 12 && widths.some((w) => w > 1)) {
    if (widths[idx] > 1) {
      widths[idx] -= 1;
      total -= 1;
    }
    idx = (idx + 1) % count;
  }
  return widths;
};

const normalizeWidths = (current, count) => {
  if (!count) return [];
  if (Array.isArray(current) && current.length === count) {
    const sanitized = current.map((val) => {
      const num = Number(val);
      return Number.isFinite(num) && num > 0
        ? Math.min(12, Math.round(num))
        : null;
    });
    if (sanitized.every((n) => n && n > 0)) {
      const total = sanitized.reduce((sum, n) => sum + n, 0);
      if (total === 12) return sanitized;
    }
  }
  return evenWidths(count);
};

const parseJsonPayload = (raw) => {
  if (raw == null) throw new Error("Empty response from LLM");
  if (typeof raw === "object") return raw;
  const cleaned = stripCodeFences(String(raw));
  const extracted = extractJsonStructure(cleaned);
  if (extracted) return extracted;
  throw new Error("Could not parse JSON payload from LLM response");
};

const normalizeChild = (value, ctx) => {
  if (value == null) return null;
  if (typeof value === "string") return { type: "blank", contents: value };
  return normalizeSegment(value, ctx);
};

const normalizeTabs = (tabs, ctx) =>
  ensureArray(tabs)
    .map((tab) => ({ ...tab, contents: normalizeChild(tab?.contents, ctx) }))
    .filter((tab) => tab?.title && tab.contents)
    .map((tab) => ({ ...tab, class: tab.class || "" }));

const normalizeSegment = (segment, ctx) => {
  if (segment == null) return null;
  if (typeof segment === "string") return { type: "blank", contents: segment };
  if (Array.isArray(segment)) {
    const arr = segment
      .map((child) => normalizeSegment(child, ctx))
      .filter(Boolean);
    return arr.length ? arr : null;
  }
  if (typeof segment !== "object") return null;

  const clone = { ...segment };
  if (clone.type === "prompt") return null;

  if (!clone.type && clone.above) {
    const above = ensureArray(clone.above)
      .map((child) => normalizeSegment(child, ctx))
      .filter(Boolean);
    return above.length ? { ...clone, above } : null;
  }
  if (!clone.type && clone.besides) {
    const besides = ensureArray(clone.besides).map((child) =>
      child == null ? null : normalizeSegment(child, ctx),
    );
    if (!besides.some((child) => child)) return null;
    return {
      ...clone,
      besides,
      widths: normalizeWidths(clone.widths, besides.length),
    };
  }

  switch (clone.type) {
    case "container": {
      const contents = normalizeChild(clone.contents, ctx);
      return contents
        ? {
            ...clone,
            contents,
            class: clone.class || "",
            customClass: clone.customClass || "",
          }
        : null;
    }
    case "card": {
      const contents = normalizeChild(clone.contents, ctx);
      return contents
        ? {
            ...clone,
            contents,
            title: clone.title || "",
            class: clone.class || "",
          }
        : null;
    }
    case "tabs": {
      const tabs = normalizeTabs(clone.tabs, ctx);
      return tabs.length ? { ...clone, tabs, class: clone.class || "" } : null;
    }
    case "blank":
      return {
        ...clone,
        contents: typeof clone.contents === "string" ? clone.contents : "",
        class: clone.class || "",
      };
    case "line_break":
      return { type: "line_break", class: clone.class || "" };
    case "image":
      return clone.url || clone.src
        ? {
            ...clone,
            url: clone.url || clone.src || "",
            alt: clone.alt || "",
            class: clone.class || "",
          }
        : null;
    case "link":
      return clone.url
        ? {
            ...clone,
            text: clone.text || clone.url,
            link_style: clone.link_style || "",
            class: clone.class || "",
          }
        : null;
    case "search_bar":
      return { ...clone, class: clone.class || "" };
    case "view":
      if (!ctx.viewNames.length) return null;
      return {
        ...clone,
        view: ctx.viewNames.includes(clone.view)
          ? clone.view
          : ctx.viewNames[0],
        state: clone.state || {},
        class: clone.class || "",
      };
    case "view_link":
      if (!ctx.viewNames.length) return null;
      return {
        ...clone,
        view: ctx.viewNames.includes(clone.view)
          ? clone.view
          : ctx.viewNames[0],
        view_label: clone.view_label || clone.view,
        link_style: clone.link_style || "",
        class: clone.class || "",
      };
    case "field": {
      if (!ctx.fields.length) return null;
      const fieldMeta = ctx.fieldMap[clone.field_name] || ctx.fields[0];
      // Use pickFieldview which validates that the fieldview exists in fieldMeta.fieldviews
      // If clone.fieldview is invalid, pickFieldview will return a valid alternative
      const validFieldview = pickFieldview(
        fieldMeta,
        ctx.mode,
        clone.fieldview,
      );
      return {
        ...clone,
        field_name: fieldMeta.name,
        fieldview: validFieldview,
        configuration: clone.configuration || {},
        class: clone.class || "",
      };
    }
    case "action": {
      if (!ctx.actions.length) return null;
      const actionName = ctx.actions.includes(clone.action_name)
        ? clone.action_name
        : ctx.actions[0];
      return {
        ...clone,
        action_name: actionName,
        action_label: clone.action_label || prettifyActionName(actionName),
        action_style: clone.action_style || "btn-primary",
        action_size: ACTION_SIZES.includes(clone.action_size)
          ? clone.action_size
          : undefined,
        rndid: clone.rndid || randomId(),
        minRole: clone.minRole || 100,
        nsteps: clone.nsteps || 1,
        isFormula: clone.isFormula || {},
        configuration: clone.configuration || {},
        class: clone.class || "",
      };
    }
    default: {
      if (clone.children) {
        const childSegments = ensureArray(clone.children)
          .map((child) => normalizeSegment(child, ctx))
          .filter(Boolean);
        if (childSegments.length === 1) return childSegments[0];
        if (childSegments.length > 1) return { above: childSegments };
      }
      if (clone.contents) {
        const contents = normalizeChild(clone.contents, ctx);
        return contents ? { ...clone, contents } : null;
      }
      return null;
    }
  }
};

const collectSegments = (segment, out = []) => {
  if (segment == null) return out;
  if (Array.isArray(segment)) {
    segment.forEach((s) => collectSegments(s, out));
    return out;
  }
  if (typeof segment !== "object") return out;
  out.push(segment);
  if (segment.above) collectSegments(segment.above, out);
  if (segment.besides) collectSegments(segment.besides, out);
  if (segment.contents) collectSegments(segment.contents, out);
  if (segment.tabs) {
    ensureArray(segment.tabs).forEach((tab) =>
      collectSegments(tab.contents, out),
    );
  }
  return out;
};

const sanitizeNoHtmlSegments = (segment) => {
  if (segment == null) return segment;
  if (Array.isArray(segment))
    return segment
      .map((child) => sanitizeNoHtmlSegments(child))
      .filter(Boolean);
  if (typeof segment !== "object") return segment;

  const clone = { ...segment };
  if (clone.type === "blank") {
    const usedHtml = !!clone.isHTML;
    delete clone.isHTML;
    delete clone.text_strings;
    if (usedHtml && typeof clone.contents === "string") {
      clone.contents = stripHtmlTags(clone.contents);
    }
  }

  if (clone.contents !== undefined)
    clone.contents = sanitizeNoHtmlSegments(clone.contents);
  if (clone.above !== undefined)
    clone.above = sanitizeNoHtmlSegments(clone.above);
  if (clone.besides !== undefined)
    clone.besides = sanitizeNoHtmlSegments(clone.besides);
  if (clone.tabs !== undefined)
    clone.tabs = ensureArray(clone.tabs)
      .map((tab) => ({
        ...tab,
        contents: sanitizeNoHtmlSegments(tab?.contents),
      }))
      .filter((tab) => tab?.contents);
  return clone;
};

const buildPromptText = (userPrompt, ctx, schema) => {
  const parts = [
    `You are an expert Saltcorn layout builder assistant. Your task is to generate a layout for mode "${ctx.mode}" that precisely fulfills the user's request.`,
    'CRITICAL: You must return ONLY a single valid JSON object. Do not include introductory text, explanations, markdown formatting (like ```json), or any pseudo-markup. The output must strictly follow this shape: {"layout": <layout-object>}.',
    'The "layout" object MUST conform entirely to the provided JSON Schema. Do not invent properties, types, or structure not defined in the schema.',
  ];
  parts.push(
    "When a card or container background is requested, set bgType explicitly (None, Color, Image, or Gradient). For Color use bgColor, for Image use bgFileId plus imageLocation (Top, Card, Body) and optionally imageSize (cover, contain, repeat using cover as default) when location is Card or Body, and for Gradient use gradStartColor, gradEndColor, and numeric gradDirection. Use hex color codes when specifying colors.",
  );
  parts.push(
    `Here is the strict Saltcorn layout JSON schema you MUST follow to construct the layout. Do not deviate from these definitions:\n${JSON.stringify(schema)}`,
  );
  parts.push(
    `Based on the schema above, process the following user request and generate the layout JSON. Reminder: ONLY output valid JSON starting with { and ending with }, no markdown fences.\nUser request:\n"${userPrompt}"`,
  );
  return parts.join("\n\n");
};

const convertChildList = (children, ctx) => {
  const segments = ensureArray(children)
    .map((child) => convertForeignLayout(child, ctx))
    .filter(Boolean);
  if (!segments.length) return null;
  if (segments.length === 1) return segments[0];
  return { above: segments };
};

const convertChildrenArray = (children, ctx) =>
  ensureArray(children)
    .map((child) => convertForeignLayout(child, ctx))
    .filter(Boolean);

const convertForeignField = (node, ctx) => {
  const fieldName = pickAttrValue(node, ["field", "field_name", "name"]);
  if (!fieldName && !ctx.fields.length) return null;
  const fieldMeta = ctx.fieldMap[fieldName] || ctx.fields[0];
  if (!fieldMeta) return null;
  let userView = pickAttrValue(node, ["fieldview", "view"]);
  const viewsAttr = attrValue(node, "views");
  if (!userView && viewsAttr !== undefined) userView = firstItem(viewsAttr);
  const typeHint = attrValue(node, "type");
  if (
    !userView &&
    typeof typeHint === "string" &&
    typeHint.toLowerCase() === "textarea"
  ) {
    userView = "textarea";
  }
  // Use pickFieldview to validate userView against field's available fieldviews
  const validFieldview = pickFieldview(fieldMeta, ctx.mode, userView);
  return {
    type: "field",
    field_name: fieldMeta.name,
    fieldview: validFieldview,
    configuration: node.configuration || {},
  };
};

const convertForeignAction = (node, ctx) => {
  const actionName =
    pickAttrValue(node, ["action", "action_name", "name"]) || ctx.actions[0];
  if (!actionName) return null;
  const style = pickAttrValue(node, ["style", "action_style"]);
  const label = pickAttrValue(node, ["label", "action_label"]);
  const size = pickAttrValue(node, ["size", "action_size"]);
  const confirm = attrValue(node, "confirm");
  return {
    type: "action",
    action_name: actionName,
    action_label: label || prettifyActionName(actionName),
    action_style: style || "btn-primary",
    action_size: ACTION_SIZES.includes(size) ? size : undefined,
    confirm,
    rndid: randomId(),
    minRole: 100,
    nsteps: 1,
    isFormula: {},
    configuration: node.configuration || {},
  };
};

const convertForeignLayout = (node, ctx) => {
  if (!node && node !== 0) return null;
  if (Array.isArray(node)) {
    const segments = node
      .map((child) => convertForeignLayout(child, ctx))
      .filter(Boolean);
    if (!segments.length) return null;
    if (segments.length === 1) return segments[0];
    return { above: segments };
  }
  if (typeof node === "string") return { type: "blank", contents: node };
  if (typeof node !== "object") return null;
  if (node.layout) return convertForeignLayout(node.layout, ctx);

  const type = node.type || node.kind;
  switch (type) {
    case "container": {
      const contents =
        convertForeignLayout(node.contents, ctx) ||
        convertChildList(node.children, ctx);
      return contents ? { type: "container", contents } : null;
    }
    case "card": {
      const contents =
        convertForeignLayout(node.contents, ctx) ||
        convertChildList(node.children, ctx);
      return contents ? { type: "card", title: node.title, contents } : null;
    }
    case "columns": {
      const columns = convertChildrenArray(node.columns || node.children, ctx);
      return columns.length
        ? {
            besides: columns,
            widths: normalizeWidths(node.widths, columns.length),
          }
        : null;
    }
    case "column":
      return (
        convertForeignLayout(node.contents, ctx) ||
        convertChildList(node.children, ctx)
      );
    case "row":
    case "section":
    case "stack":
    case "group":
    case "form":
    case "form_group":
    case "formgroup":
    case "form-row":
    case "form-group":
      return convertChildList(node.children, ctx);
    case "tabs": {
      const tabs = ensureArray(node.tabs || node.children)
        .map((tab) => ({
          title: tab.title || tab.label || "Tab",
          contents: convertForeignLayout(tab.contents || tab.children, ctx),
        }))
        .filter((tab) => tab.contents);
      return tabs.length ? { type: "tabs", tabs } : null;
    }
    case "actions":
      return convertChildList(node.children, ctx);
    case "fieldview":
    case "field":
    case "input":
    case "textarea":
    case "select":
      return convertForeignField(node, ctx);
    case "action":
    case "button":
      return convertForeignAction(node, ctx);
    case "label":
    case "heading":
    case "title":
      return {
        type: "blank",
        contents: node.text || node.value || node.contents || "",
      };
    case "text":
      return {
        type: "blank",
        contents: node.text || node.value || node.contents || "",
      };
    case "html":
      return {
        type: "blank",
        contents: stripHtmlTags(node.html || node.contents || ""),
      };
    case "image":
      return {
        type: "image",
        url: node.url || node.src || "",
        alt: node.alt || "",
      };
    default:
      if (node.children) return convertChildList(node.children, ctx);
      if (node.contents) return convertForeignLayout(node.contents, ctx);
      if (node.text) return { type: "blank", contents: node.text };
      return null;
  }
};

const splitNodeText = (text) => {
  const attrs = {};
  const body = [];
  (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1).trim();
        if (key) attrs[key] = value;
        else body.push(line);
      } else body.push(line);
    });
  return { attrs, text: body.join(" ").trim() };
};

const buildBracketObject = (node) => {
  if (!node || !node.tag) return null;
  const children = (node.children || [])
    .map((child) => buildBracketObject(child))
    .filter(Boolean);
  const { attrs, text } = splitNodeText(node.text || "");
  const obj = { type: node.tag };
  if (children.length) obj.children = children;
  if (Object.keys(attrs).length) obj.attributes = attrs;
  if (text) obj.text = text;
  return obj;
};

const buildContext = async (mode, tableName) => {
  const normalizedMode = (mode || "show").toLowerCase();
  const ctx = {
    mode: normalizedMode,
    modeGuidance: MODE_GUIDANCE[normalizedMode] || MODE_GUIDANCE.default,
    table: null,
    fields: [],
    fieldMap: {},
    actions: [],
    viewNames: [],
  };

  // Global actions and views are useful even when no table is specified (page builder)
  const stateActions = Object.keys(getState().actions || {});
  try {
    const allViews = await View.find();
    ctx.viewNames = allViews.map((v) => v.name).filter(Boolean);
  } catch (err) {
    ctx.viewNames = [];
  }

  if (!tableName) {
    const triggers = Trigger.find({
      when_trigger: { or: ["API call", "Never"] },
    }).filter((tr) => tr.name && !tr.table_id);

    ctx.actions = Array.from(
      new Set([...stateActions, ...triggers.map((tr) => tr.name)]),
    ).filter(Boolean);
    return ctx;
  }

  const lookup =
    typeof tableName === "number" || /^[0-9]+$/.test(String(tableName))
      ? { id: Number(tableName) }
      : { name: tableName };
  const table = Table.findOne(lookup);
  if (!table) return ctx;

  let rawFields = [];
  try {
    rawFields = table.getFields ? table.getFields() : table.fields || [];
  } catch (err) {
    rawFields = table.fields || [];
  }
  if (rawFields?.then) rawFields = await rawFields;
  const fields = (rawFields || []).map((field) => {
    const fieldviews = Object.keys(field.type?.fieldviews || {});
    const isPkName =
      table.pk_name &&
      typeof field.name === "string" &&
      field.name === table.pk_name;

    // Capture the default fieldview from various possible sources
    // Priority: field-level configured > field's attributes > type default
    const defaultFieldview =
      field.fieldview ||
      field.default_fieldview ||
      (field.attributes && field.attributes.fieldview) ||
      field.type?.default_fieldview ||
      null;

    return {
      name: field.name,
      label: field.label || field.name,
      type: field.type?.name || field.type || field.input_type || "String",
      required: !!field.required,
      primary_key: !!field.primary_key,
      calculated: !!field.calculated,
      is_pk_name: !!isPkName,
      default_fieldview: defaultFieldview,
      fieldviews: fieldviews.length ? fieldviews : ["show"],
    };
  });

  const triggers = Trigger.find({
    when_trigger: { or: ["API call", "Never"] },
  }).filter((tr) => tr.name && (!tr.table_id || tr.table_id === table.id));

  let viewNames = [];
  try {
    const views = await View.find_table_views_where(table.id, () => true);
    viewNames = views.map((v) => v.name);
  } catch (err) {
    viewNames = [];
  }

  const builtIns =
    ctx.mode === "edit" || ctx.mode === "filter"
      ? edit_build_in_actions || []
      : ["Delete", "GoBack"];
  const actions = Array.from(
    new Set([...builtIns, ...stateActions, ...triggers.map((tr) => tr.name)]),
  ).filter(Boolean);

  ctx.table = table;
  ctx.fields = fields;
  ctx.fieldMap = Object.fromEntries(fields.map((f) => [f.name, f]));
  ctx.actions = actions;
  ctx.viewNames = viewNames;
  return ctx;
};

const buildErrorLayout = ({ message, mode, table }) => {
  const trimmedMessage = String(message || "Unknown error").slice(0, 500);
  const contextLine = table
    ? `Mode: ${mode || "show"} | Table: ${table}`
    : `Mode: ${mode || "show"}`;
  return {
    above: [
      {
        type: "container",
        customClass: "p-3 border rounded",
        style: {
          backgroundColor: "#fff3cd",
          borderColor: "#ffecb5",
          color: "#000000",
        },
        contents: {
          above: [
            {
              type: "blank",
              contents: "Builder generation failed",
              textStyle: ["h4", "fw-bold"],
              block: true,
              inline: false,
            },
            {
              type: "blank",
              contents: contextLine,
              textStyle: ["small"],
              block: true,
              inline: false,
            },
            {
              type: "blank",
              contents:
                "We could not generate a layout from your request. Please try rephrasing or simplifying the prompt.",
              block: true,
              inline: false,
            },
            {
              type: "blank",
              contents: `Error: ${trimmedMessage}`,
              textStyle: ["font-monospace", "small"],
              block: true,
              inline: false,
            },
          ],
        },
      },
    ],
  };
};

module.exports = {
  run: async (prompt, mode, table) => {
    // Remove any leading "container:" or similar so as to remain with only the user prompt.
    prompt = prompt.trim().replace(/^\[\w+\]:\s*/, "");

    console.log({ prompt, mode, table });

    const ctx = await buildContext(mode, table);
    const schema = buildBuilderSchema({ mode, ctx });
    const llm = getState().functions.llm_generate;
    if (!llm?.run) throw new Error("LLM generator not configured");

    const llmPrompt = buildPromptText(prompt, ctx, schema);
    const options = {
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "saltcorn_layout",
          schema,
        },
      },
    };

    // const deterministicLayout = buildDeterministicLayout(ctx, prompt);

    let payload;
    let rawResponse;
    try {
      if (!schema || !schema.schema) {
        throw new Error("Builder schema unavailable");
      }
      // console.log(llmPrompt)
      // console.log(JSON.stringify({ schema }, null, 2));
      console.log(`llmPrompt: ${llmPrompt}`);
      rawResponse = await llm.run(llmPrompt, options);
      console.log(JSON.stringify({ rawResponse }, null, 2));
      payload = parseJsonPayload(rawResponse);
      console.log(JSON.stringify({ payload }, null, 2));
      const candidate = payload.layout ?? payload;
      return candidate;
    } catch (err) {
      console.warn("Copilot layout generation failed", err);
      const errorLayout = buildErrorLayout({
        message: err?.message || String(err),
        mode,
        table,
      });
      return errorLayout;
    }
  },
  isAsync: true,
  description: "Generate a builder layout",
  arguments: [
    { name: "prompt", type: "String" },
    { name: "mode", type: "String" },
    { name: "table", type: "String" },
  ],
};
