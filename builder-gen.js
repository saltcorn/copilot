const { getState } = require("@saltcorn/data/db/state");
const Table = require("@saltcorn/data/models/table");
const Trigger = require("@saltcorn/data/models/trigger");
const View = require("@saltcorn/data/models/view");
const { edit_build_in_actions } = require("@saltcorn/data/viewable_fields");
const { parseHTML } = require("./common");

const BUTTON_STYLES = [
  "btn-primary",
  "btn-secondary",
  "btn-success",
  "btn-info",
  "btn-warning",
  "btn-danger",
  "btn-outline-primary",
  "btn-outline-secondary",
  "btn-link",
];
const ACTION_SIZES = ["btn-sm", "btn-lg"];
const TEXT_STYLES = [
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

const textFallback = (contents) => ({
  type: "blank",
  contents: String(contents || "").trim(),
});

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

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pickSaveActionName = (actions) => {
  if (!actions?.length) return undefined;
  const exact = actions.find((a) => a === "Save");
  if (exact) return exact;
  const fuzzy = actions.find((a) => /save/i.test(a));
  if (fuzzy) return fuzzy;
  return actions[0];
};

const extractRequestedActions = (prompt, availableActions) => {
  if (!prompt || !availableActions?.length) return [];
  const src = prompt.toLowerCase();
  const requested = [];
  for (const action of availableActions) {
    const actionLower = String(action).toLowerCase();
    const aliasPatterns = [
      actionLower,
      actionLower.replace(/_/g, " "),
      actionLower.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(),
    ];
    for (const alias of aliasPatterns) {
      const re = new RegExp(`(^|[^a-z0-9_])${escapeRegex(alias)}([^a-z0-9_]|$)`, "i");
      if (re.test(src)) {
        requested.push(action);
        break;
      }
    }
  }
  return requested;
};

const isSingleColumnLayout = (prompt) => {
  if (!prompt) return false;
  return /\b(single[- ]?column|one[- ]?column|1[- ]?column|vertical|stacked|no[- ]?columns?)\b/i.test(prompt);
};

const preferEditableFields = (fields) => {
  const editable = (fields || []).filter(
    (f) => !f.primary_key && !f.calculated && !f.is_pk_name && f.name !== "id",
  );
  return editable.length ? editable : fields || [];
};

const fieldAliases = (field) =>
  [field?.name, field?.label]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
    .flatMap((s) => [s, s.replace(/_/g, " "), s.replace(/[-_]/g, " ")]);

const compactAlnum = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const compactIndexMap = (text) => {
  const chars = [];
  const indexMap = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[a-z0-9]/i.test(ch)) {
      chars.push(ch.toLowerCase());
      indexMap.push(i);
    }
  }
  return { compact: chars.join(""), indexMap };
};

const firstAliasIndex = (field, prompt) => {
  const src = (prompt || "").toLowerCase();
  if (!src) return -1;
  let best = -1;
  for (const nm of fieldAliases(field)) {
    if (!nm) continue;
    const re = new RegExp(
      `(^|[^a-z0-9_])${escapeRegex(nm)}([^a-z0-9_]|$)`,
      "i",
    );
    const match = re.exec(src);
    if (!match) continue;
    const idx = match.index + (match[1] ? match[1].length : 0);
    if (best === -1 || idx < best) best = idx;
  }

  const { compact, indexMap } = compactIndexMap(src);
  for (const nm of fieldAliases(field)) {
    const compactAlias = compactAlnum(nm);
    if (!compactAlias || compactAlias.length < 3) continue;
    const cidx = compact.indexOf(compactAlias);
    if (cidx === -1) continue;
    const idx = indexMap[cidx] ?? -1;
    if (idx >= 0 && (best === -1 || idx < best)) best = idx;
  }

  return best;
};

const allAliasIndexes = (field, prompt) => {
  const src = (prompt || "").toLowerCase();
  if (!src) return [];
  const idxs = [];
  for (const nm of fieldAliases(field)) {
    if (!nm) continue;
    const re = new RegExp(
      `(^|[^a-z0-9_])${escapeRegex(nm)}([^a-z0-9_]|$)`,
      "gi",
    );
    let match;
    while ((match = re.exec(src))) {
      idxs.push(match.index + (match[1] ? match[1].length : 0));
      if (re.lastIndex === match.index) re.lastIndex++;
    }
  }

  const { compact, indexMap } = compactIndexMap(src);
  for (const nm of fieldAliases(field)) {
    const compactAlias = compactAlnum(nm);
    if (!compactAlias || compactAlias.length < 3) continue;
    let from = 0;
    while (from < compact.length) {
      const cidx = compact.indexOf(compactAlias, from);
      if (cidx === -1) break;
      const idx = indexMap[cidx];
      if (typeof idx === "number") idxs.push(idx);
      from = cidx + compactAlias.length;
    }
  }

  return Array.from(new Set(idxs)).sort((a, b) => a - b);
};

const mentionedEditableFields = (prompt, ctx) => {
  return preferEditableFields(ctx.fields)
    .map((field) => ({ field, idx: firstAliasIndex(field, prompt) }))
    .filter((m) => m.idx >= 0)
    .sort((a, b) => a.idx - b.idx)
    .map((m) => m.field);
};

// Find best matching fieldview from override preferences
const findOverrideFieldview = (field, override) => {
  if (!override?.preferredFieldviews?.length || !field?.fieldviews?.length) return null;
  for (const preferred of override.preferredFieldviews) {
    const match = field.fieldviews.find(
      (fv) => String(fv).toLowerCase().includes(preferred.toLowerCase())
    );
    if (match) return match;
  }
  return override.preferredFieldviews[0]; // Hint for pickFieldview
};

const requestedFieldOverrides = (prompt, ctx) => {
  const src = (prompt || "").toLowerCase();
  const overrides = {};

  // Fieldview specs for both edit and show modes
  const requestedInputTypes = [
    // Edit mode input types
    {
      inputType: "markdown",
      aliases: ["markdown", "markdown editor", "md editor", "rich text"],
      preferredFieldviews: ["toastui_markdown_edit", "markdown", "textarea"],
    },
    {
      inputType: "textarea",
      aliases: ["text area", "textarea", "multi-line", "multiline"],
      preferredFieldviews: ["textarea"],
    },
    { inputType: "email", aliases: ["email", "email input"] },
    { inputType: "url", aliases: ["url", "link input"] },
    { inputType: "number", aliases: ["number", "numeric", "integer"] },
    { inputType: "date", aliases: ["date", "date picker"] },
    { inputType: "time", aliases: ["time", "time picker"] },
    {
      inputType: "datetime",
      aliases: ["datetime", "date time", "timestamp"],
    },
    { inputType: "checkbox", aliases: ["checkbox", "toggle", "boolean"] },
    { inputType: "color", aliases: ["color", "colour", "color picker"] },
    { inputType: "file", aliases: ["file", "upload", "attachment"] },
    { inputType: "password", aliases: ["password", "secret"] },
    { inputType: "phone", aliases: ["phone", "telephone", "tel"] },
    // Show mode fieldview types
    {
      inputType: "markdown_show",
      aliases: [
        "render as markdown",
        "render markdown",
        "as markdown",
        "show as markdown",
        "display as markdown",
        "markdown format",
      ],
      preferredFieldviews: ["markdown", "show_markdown", "showMarkdown"],
    },
    {
      inputType: "html_show",
      aliases: [
        "render as html",
        "as html",
        "show as html",
        "display as html",
        "html format",
        "render html",
      ],
      preferredFieldviews: ["show_with_html", "html", "showHtml", "unsafe_html"],
    },
    {
      inputType: "code_show",
      aliases: ["as code", "code block", "show as code", "code format"],
      preferredFieldviews: ["code", "show_code", "showCode", "pre"],
    },
    {
      inputType: "link_show",
      aliases: ["as link", "as a link", "show as link", "clickable link"],
      preferredFieldviews: ["as_link", "link", "showLink"],
    },
  ];

  const hasAnyInputTypeCue = requestedInputTypes.some(({ aliases }) =>
    aliases.some((alias) => src.includes(alias.toLowerCase())),
  );
  if (!hasAnyInputTypeCue) return overrides;

  const fieldMentions = [];
  for (const field of preferEditableFields(ctx.fields)) {
    const idxs = allAliasIndexes(field, src);
    for (const idx of idxs) fieldMentions.push({ fieldName: field.name, idx });
  }
  fieldMentions.sort((a, b) => a.idx - b.idx);
  if (!fieldMentions.length) return overrides;

  const typeMentions = [];
  for (const spec of requestedInputTypes) {
    for (const alias of spec.aliases) {
      const escaped = escapeRegex(alias.toLowerCase());
      const re = new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, "gi");
      let match;
      while ((match = re.exec(src))) {
        typeMentions.push({
          idx: match.index + (match[1] ? match[1].length : 0),
          spec,
        });
        if (re.lastIndex === match.index) re.lastIndex++;
      }
    }
  }
  typeMentions.sort((a, b) => a.idx - b.idx);

  for (const t of typeMentions) {
    const candidates = fieldMentions.filter(
      (fm) => fm.idx <= t.idx && t.idx - fm.idx <= 80,
    );
    if (!candidates.length) continue;
    const chosen = candidates[candidates.length - 1];
    overrides[chosen.fieldName] = {
      inputType: t.spec.inputType,
      preferredFieldviews: t.spec.preferredFieldviews || [],
    };
  }

  return overrides;
};

const fieldsFromPrompt = (prompt, ctx) => {
  const preferred = mentionedEditableFields(prompt, ctx);
  if (preferred.length) return preferred;
  return preferEditableFields(ctx.fields).slice(0, 6);
};

const isExplicitSubsetPrompt = (prompt, ctx) => {
  const src = (prompt || "").toLowerCase();
  if (!src.trim()) return false;
  const hasSubsetCue =
    /\bonly\b|\bjust\b|\bthese\s+fields\b|\bfor\s+(the\s+)?fields?\b|\bwith\s+(the\s+)?fields?\b/.test(
      src,
    );
  if (!hasSubsetCue) return false;
  const mentioned = mentionedEditableFields(prompt, ctx);
  const editable = preferEditableFields(ctx.fields);
  return mentioned.length > 0 && mentioned.length < editable.length;
};

const pickFieldview = (field, mode, requestedFieldview = null) => {
  if (!field?.fieldviews?.length)
    return mode === "edit" || mode === "filter" ? "edit" : "show";

  // If a specific fieldview was requested by the user, try to honor it
  if (requestedFieldview) {
    const lowerRequested = String(requestedFieldview).toLowerCase();
    // Exact match
    const exact = field.fieldviews.find(
      (fv) => String(fv).toLowerCase() === lowerRequested
    );
    if (exact) return exact;
    // Fuzzy match (contains)
    const fuzzy = field.fieldviews.find(
      (fv) => String(fv).toLowerCase().includes(lowerRequested)
    );
    if (fuzzy) return fuzzy;
  }

  // Get the field's configured default fieldview
  const defaultFieldview =
    field?.default_fieldview ||
    field?.defaultFieldview ||
    field?.fieldview;
    
  // Case-insensitive check for default fieldview in available views
  if (defaultFieldview) {
    const lowerDefault = String(defaultFieldview).toLowerCase();
    const match = field.fieldviews.find(
      (fv) => String(fv).toLowerCase() === lowerDefault
    );
    if (match) return match;
  }

  // For show mode, prefer the first available fieldview (usually "as_text" or similar simple display)
  // This avoids defaulting to complex views like "show_with_html" when not requested
  if (mode === "show" || mode === "list") {
    // Prefer simple text-based views first
    const simpleViews = ["as_text", "show", "as_string", "text"];
    for (const simple of simpleViews) {
      const match = field.fieldviews.find(
        (fv) => String(fv).toLowerCase() === simple
      );
      if (match) return match;
    }
    // Fall back to first available fieldview
    return field.fieldviews[0];
  }

  // For edit/filter modes, look for edit-capable fieldviews
  const preferred = mode === "edit" || mode === "filter" ? "edit" : "show";
  
  // Try exact match first
  if (field.fieldviews.includes(preferred)) return preferred;
  
  // Try fuzzy match (e.g., "editHTML" contains "edit")
  const fuzzy = field.fieldviews.find((fv) =>
    fv.toLowerCase().includes(preferred),
  );
  if (fuzzy) return fuzzy;
  
  // Fall back to first available fieldview
  return field.fieldviews[0];
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
    .filter((tab) => tab?.title && tab.contents);

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
      return contents ? { ...clone, contents } : null;
    }
    case "card": {
      const contents = normalizeChild(clone.contents, ctx);
      return contents ? { ...clone, contents } : null;
    }
    case "tabs": {
      const tabs = normalizeTabs(clone.tabs, ctx);
      return tabs.length ? { ...clone, tabs } : null;
    }
    case "blank":
      return {
        ...clone,
        contents: typeof clone.contents === "string" ? clone.contents : "",
      };
    case "line_break":
      return { type: "line_break" };
    case "image":
      return clone.url || clone.src ? { ...clone, alt: clone.alt || "" } : null;
    case "link":
      return clone.url
        ? {
            ...clone,
            text: clone.text || clone.url,
            link_style: clone.link_style || "",
          }
        : null;
    case "search_bar":
      return clone;
    case "view":
      if (!ctx.viewNames.length) return null;
      return {
        ...clone,
        view: ctx.viewNames.includes(clone.view)
          ? clone.view
          : ctx.viewNames[0],
        state: clone.state || {},
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
      };
    case "field": {
      if (!ctx.fields.length) return null;
      const fieldMeta = ctx.fieldMap[clone.field_name] || ctx.fields[0];
      return {
        ...clone,
        field_name: fieldMeta.name,
        fieldview: clone.fieldview || pickFieldview(fieldMeta, ctx.mode),
        configuration: clone.configuration || {},
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

const normalizeLayout = (layout, ctx) => {
  if (typeof layout === "string") {
    const trimmed = layout.trim();
    const jsonCandidate = extractJsonStructure(trimmed);
    if (jsonCandidate) {
      const nested = jsonCandidate.layout ?? jsonCandidate;
      return normalizeLayout(nested, ctx);
    }
    if (trimmed.startsWith("<")) {
      try {
        return normalizeLayout(parseHTML(trimmed), ctx);
      } catch (err) {
        return buildDeterministicLayout(ctx, stripHtmlTags(trimmed));
      }
    }
    const bracketCandidate = convertBracketSyntax(trimmed, ctx);
    if (bracketCandidate) return normalizeLayout(bracketCandidate, ctx);
    return buildDeterministicLayout(ctx, trimmed);
  }
  let normalized = normalizeSegment(layout, ctx);
  if (Array.isArray(normalized)) normalized = { above: normalized };
  if (!normalized || typeof normalized !== "object") {
    return buildDeterministicLayout(ctx, "");
  }
  return normalized;
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

const makeEditRow = (field, prompt) => {
  const overrides = requestedFieldOverrides(prompt, { fields: [field] });
  const override = overrides[field.name];
  const overrideFieldview = findOverrideFieldview(field, override);
  const fieldview = overrideFieldview || pickFieldview(field, "edit");
  const cfg = override?.inputType ? { input_type: override.inputType } : {};

  return {
    besides: [
      {
        type: "blank",
        contents: field.label || field.name,
        block: false,
        inline: false,
        textStyle: "",
        isFormula: {},
        labelFor: field.name,
      },
      {
        type: "field",
        field_name: field.name,
        fieldview,
        textStyle: "",
        block: false,
        configuration: cfg,
      },
    ],
    aligns: ["end", "start"],
    breakpoints: ["", ""],
    style: { "margin-bottom": "1.5rem" },
    widths: [2, 10],
    setting_col_n: 0,
  };
};

const buildDeterministicEditLayout = (ctx, prompt) => {
  const selectedFields = fieldsFromPrompt(prompt, ctx);
  const rows = selectedFields.map((field) => makeEditRow(field, prompt));
  
  const saveAction = pickSaveActionName(ctx.actions);
  if (saveAction) {
    rows.push({
      besides: [
        null,
        {
          type: "action",
          block: false,
          configuration: {},
          action_name: saveAction,
          action_label: "",
          action_style: "btn-primary",
          minRole: 100,
          isFormula: {},
          rndid: randomId(),
        },
      ],
      aligns: ["end", "start"],
      breakpoints: ["", ""],
      style: { "margin-bottom": "1.5rem" },
      widths: [2, 10],
      setting_col_n: 0,
    });
  }
  if (!rows.length) {
    return {
      above: [
        { type: "blank", contents: "No editable fields found for this table" },
      ],
    };
  }
  return { above: rows };
};

const mentionedFieldsByMode = (prompt, ctx) => {
  const baseFields =
    ctx.mode === "edit" || ctx.mode === "filter"
      ? preferEditableFields(ctx.fields)
      : ctx.fields || [];
  return baseFields
    .map((field) => ({ field, idx: firstAliasIndex(field, prompt) }))
    .filter((m) => m.idx >= 0)
    .sort((a, b) => a.idx - b.idx)
    .map((m) => m.field);
};

const fieldsFromPromptByMode = (prompt, ctx, limit = 6) => {
  const mentioned = mentionedFieldsByMode(prompt, ctx);
  if (mentioned.length) return mentioned.slice(0, limit);
  const baseFields =
    ctx.mode === "edit" || ctx.mode === "filter"
      ? preferEditableFields(ctx.fields)
      : ctx.fields || [];
  return baseFields.slice(0, limit);
};

const pickFirstActionMatching = (actions, regex) => {
  if (!actions?.length) return undefined;
  return actions.find((a) => regex.test(String(a || "")));
};

const makeDisplayRow = (field, mode, singleColumn = false, requestedFieldview = null) => {
  const fieldview = pickFieldview(field, mode, requestedFieldview);
  
  if (singleColumn) {
    return {
      above: [
        {
          type: "blank",
          contents: field.label || field.name,
          block: false,
          inline: false,
          textStyle: ["fw-bold"],
          isFormula: {},
        },
        {
          type: "field",
          field_name: field.name,
          fieldview,
          textStyle: [],
          block: false,
          configuration: {},
        },
      ],
    };
  }
  return {
    besides: [
      {
        type: "blank",
        contents: field.label || field.name,
        block: false,
        inline: false,
        textStyle: ["fw-bold"],
        isFormula: {},
      },
      {
        type: "field",
        field_name: field.name,
        fieldview,
        textStyle: [],
        block: false,
        configuration: {},
      },
    ],
    aligns: ["end", "start"],
    breakpoints: ["", ""],
    style: { "margin-bottom": "1rem" },
    widths: [3, 9],
    setting_col_n: 0,
  };
};

const makeActionSegment = (actionName, actionStyle = "btn-primary") => {
  if (!actionName) return null;
  return {
    type: "action",
    block: false,
    configuration: {},
    action_name: actionName,
    action_label: prettifyActionName(actionName),
    action_style: actionStyle,
    minRole: 100,
    isFormula: {},
    rndid: randomId(),
  };
};

const buildDeterministicShowLayout = (ctx, prompt) => {
  const fields = fieldsFromPromptByMode(prompt, ctx, 8);
  const singleColumn = isSingleColumnLayout(prompt);
  const overrides = requestedFieldOverrides(prompt, ctx);
  
  const rows = fields.map((field) => {
    const requestedFieldview = findOverrideFieldview(field, overrides[field.name]);
    return makeDisplayRow(field, "show", singleColumn, requestedFieldview);
  });
  
  const requestedActions = extractRequestedActions(prompt, ctx.actions);
  const actionSegments = requestedActions.map((name) => makeActionSegment(name)).filter(Boolean);
  
  if (!rows.length && !actionSegments.length) {
    return { above: [textFallback("No fields available")] };
  }
  
  return { above: [...rows, ...actionSegments] };
};

const buildDeterministicListLayout = (ctx, prompt) => {
  const fields = fieldsFromPromptByMode(prompt, ctx, 4);
  if (!fields.length) return { above: [textFallback("No list fields available")] };
  
  const overrides = requestedFieldOverrides(prompt, ctx);
  
  const listRow = {
    besides: fields.map((field) => ({
      type: "field",
      field_name: field.name,
      fieldview: pickFieldview(field, "show", findOverrideFieldview(field, overrides[field.name])),
      block: false,
      configuration: {},
    })),
    widths: normalizeWidths([], fields.length),
  };
  
  const actionName = pickFirstActionMatching(ctx.actions, /view|edit|open|details/i) || ctx.actions[0];
  const action = makeActionSegment(actionName, "btn-link");
  return action ? { above: [listRow, action] } : { above: [listRow] };
};

const buildDeterministicFilterLayout = (ctx, prompt) => {
  const fields = fieldsFromPromptByMode(prompt, ctx, 6);
  const rows = fields.map((field) => makeEditRow(field, prompt));
  const runActionName =
    pickFirstActionMatching(ctx.actions, /search|filter|apply|run|submit/i) ||
    pickSaveActionName(ctx.actions) ||
    ctx.actions[0];
  const resetActionName = pickFirstActionMatching(ctx.actions, /reset|clear/i);
  const actions = [
    makeActionSegment(runActionName, "btn-primary"),
    makeActionSegment(resetActionName, "btn-outline-secondary"),
  ].filter(Boolean);
  if (actions.length) rows.push({ besides: [null, { above: actions }], widths: [2, 10] });
  if (!rows.length) return { above: [textFallback("No filter fields available")] };
  return { above: rows };
};

const buildDeterministicPageLayout = (ctx, prompt) => {
  const lines = [];
  if (prompt && String(prompt).trim()) lines.push(textFallback(String(prompt).trim()));
  if (ctx.viewNames.length) {
    lines.push({
      type: "view",
      view: ctx.viewNames[0],
      state: {},
    });
  } else {
    const fields = fieldsFromPromptByMode(prompt, ctx, 4);
    lines.push(...fields.map((field) => makeDisplayRow(field, "show")));
  }
  const ctaName =
    pickFirstActionMatching(ctx.actions, /create|new|add|save|submit/i) ||
    ctx.actions[0];
  const cta = makeActionSegment(ctaName, "btn-primary");
  if (cta) lines.push(cta);
  return { above: lines.filter(Boolean) };
};

const buildDeterministicLayout = (ctx, prompt) => {
  switch (ctx.mode) {
    case "edit":
      return buildDeterministicEditLayout(ctx, prompt);
    case "show":
      return buildDeterministicShowLayout(ctx, prompt);
    case "list":
      return buildDeterministicListLayout(ctx, prompt);
    case "filter":
      return buildDeterministicFilterLayout(ctx, prompt);
    case "page":
      return buildDeterministicPageLayout(ctx, prompt);
    default:
      return buildDeterministicPageLayout(ctx, prompt);
  }
};

const sanitizeNoHtmlSegments = (segment) => {
  if (segment == null) return segment;
  if (Array.isArray(segment))
    return segment.map((child) => sanitizeNoHtmlSegments(child)).filter(Boolean);
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
  if (clone.above !== undefined) clone.above = sanitizeNoHtmlSegments(clone.above);
  if (clone.besides !== undefined)
    clone.besides = sanitizeNoHtmlSegments(clone.besides);
  if (clone.tabs !== undefined)
    clone.tabs = ensureArray(clone.tabs)
      .map((tab) => ({ ...tab, contents: sanitizeNoHtmlSegments(tab?.contents) }))
      .filter((tab) => tab?.contents);
  return clone;
};

const enforceModeConsistency = (layout, ctx, prompt) => {
  if (!layout) return layout;
  const noHtmlLayout = sanitizeNoHtmlSegments(layout);
  const segments = collectSegments(noHtmlLayout, []);

  // For show mode, validate that requested actions, fields, and fieldviews are present
  if (ctx.mode === "show") {
    const requestedActions = extractRequestedActions(prompt, ctx.actions);
    if (requestedActions.length) {
      const presentActions = new Set(
        segments.filter((s) => s.type === "action").map((s) => s.action_name),
      );
      const missingActions = requestedActions.filter((a) => !presentActions.has(a));
      if (missingActions.length) {
        // LLM didn't include requested actions, fall back to deterministic
        return buildDeterministicLayout(ctx, prompt);
      }
    }
    
    // Check if single-column was requested but LLM returned multi-column
    const wantsSingleColumn = isSingleColumnLayout(prompt);
    if (wantsSingleColumn) {
      const hasMultiColumn = segments.some((s) => s.besides && s.besides.length > 1);
      if (hasMultiColumn) {
        return buildDeterministicLayout(ctx, prompt);
      }
    }
    
    // Check if specific fields were mentioned and validate they're present
    const mentionedFields = mentionedFieldsByMode(prompt, ctx);
    if (mentionedFields.length) {
      const presentFields = new Set(
        segments.filter((s) => s.type === "field").map((s) => s.field_name),
      );
      const missingFields = mentionedFields.filter((f) => !presentFields.has(f.name));
      if (missingFields.length) {
        return buildDeterministicLayout(ctx, prompt);
      }
    }
    
    // Validate that user-requested fieldviews are honored
    const overrides = requestedFieldOverrides(prompt, ctx);
    const fieldSegments = segments.filter((s) => s.type === "field");
    for (const [fieldName, wanted] of Object.entries(overrides)) {
      if (!wanted.preferredFieldviews?.length) continue;
      
      const fieldSegs = fieldSegments.filter((s) => s.field_name === fieldName);
      if (!fieldSegs.length) continue; // Field not present, will be caught above
      
      const satisfied = fieldSegs.some((seg) => {
        const fv = (seg.fieldview || "").toLowerCase();
        return wanted.preferredFieldviews.some(
          (pref) => fv.includes(pref.toLowerCase())
        );
      });
      
      if (!satisfied) {
        // LLM didn't use the requested fieldview, fall back to deterministic
        return buildDeterministicLayout(ctx, prompt);
      }
    }
    
    return noHtmlLayout;
  }

  // For non-edit/non-show modes, trust the LLM structure and only enforce HTML safety.
  if (ctx.mode !== "edit") return noHtmlLayout;

  const editFields = segments.filter(
    (s) =>
      s.type === "field" && (s.fieldview || "").toLowerCase().includes("edit"),
  );
  const actionNames = new Set(
    segments.filter((s) => s.type === "action").map((s) => s.action_name),
  );
  const hasSave = [...actionNames].some((nm) => /save/i.test(nm || ""));
  const overrides = requestedFieldOverrides(prompt, ctx);
  for (const [fieldName, wanted] of Object.entries(overrides)) {
    const segs = editFields.filter((f) => f.field_name === fieldName);
    if (!segs.length) return buildDeterministicLayout(ctx, prompt);
    const satisfied = segs.some((f) => {
      const fv = (f.fieldview || "").toLowerCase();
      const cfg = f.configuration || {};
      const inputType = String(cfg.input_type || "").toLowerCase();
      const wantedViews = (wanted.preferredFieldviews || []).map((v) =>
        String(v).toLowerCase(),
      );
      const wantsInputType = String(wanted.inputType || "").toLowerCase();
      const viewSatisfied =
        !wantedViews.length ||
        wantedViews.some((wv) => fv === wv || fv.includes(wv));
      const inputSatisfied = !wantsInputType || inputType === wantsInputType;
      return viewSatisfied && inputSatisfied;
    });
    if (!satisfied) return buildDeterministicLayout(ctx, prompt);
  }

  const mentionedOrdered = mentionedEditableFields(prompt, ctx).map(
    (f) => f.name,
  );
  if (mentionedOrdered.length > 1) {
    const generatedOrder = editFields.map((f) => f.field_name).filter(Boolean);
    const generatedMentioned = generatedOrder.filter((nm) =>
      mentionedOrdered.includes(nm),
    );
    let cursor = -1;
    const ordered = mentionedOrdered.every((nm) => {
      const idx = generatedMentioned.indexOf(nm);
      if (idx === -1) return true;
      if (idx < cursor) return false;
      cursor = idx;
      return true;
    });
    if (!ordered) return buildDeterministicLayout(ctx, prompt);
  }
  if (isExplicitSubsetPrompt(prompt, ctx)) {
    const requested = new Set(fieldsFromPrompt(prompt, ctx).map((f) => f.name));
    const generatedNames = new Set(
      editFields.map((f) => f.field_name).filter(Boolean),
    );
    const hasUnexpected = [...generatedNames].some((nm) => !requested.has(nm));
    const missingRequested = [...requested].some(
      (nm) => !generatedNames.has(nm),
    );
    if (hasUnexpected || missingRequested) {
      return buildDeterministicLayout(ctx, prompt);
    }
  }
  if (editFields.length && hasSave) return noHtmlLayout;
  return buildDeterministicLayout(ctx, prompt);
};

const buildPromptText = (userPrompt, ctx) => {
  const parts = [
    `You are Saltcorn's layout assistant. Build a layout for mode "${ctx.mode}". ${
      ctx.modeGuidance || MODE_GUIDANCE.default
    }`,
    'Return ONLY valid JSON with no prose, no markdown fences, and no pseudo-markup. Output shape must be exactly: {"layout": <layout-object>}.',
  ];
  if (ctx.table) {
    const lines = ctx.fields.slice(0, 40).map((field) => {
      const views = field.fieldviews.join(", ");
      return `- ${field.name} (${field.type}${field.required ? ", required" : ""}) views: ${views}`;
    });
    if (ctx.fields.length > 40)
      lines.push("- ... additional fields omitted for brevity");
    parts.push(
      `Table "${ctx.table.name}" fields:\n${lines.join("\n") || "- None"}`,
    );
  }
  if (ctx.actions.length)
    parts.push(
      `Available actions: ${ctx.actions.join(", ")}. Use action segments for submits or workflows.`,
    );
  if (ctx.viewNames.length)
    parts.push(`Views to embed or link: ${ctx.viewNames.join(", ")}.`);
  parts.push(
    "Use Saltcorn layout primitives only. Prefer columns (besides) for multi-column sections, blank text for headings, and cards or containers for grouping. Do not return HTML, do not set isHTML, and do not use Markdown fences.",
  );
  parts.push(
    "Honor explicit user constraints exactly whenever possible (requested fields, action names, column count, placement like 'at the bottom', and layout orientation such as single-column). Do not substitute requested actions with other actions.",
  );
  if (ctx.mode === "edit") {
    parts.push(
      "For edit mode, include field segments with edit-capable fieldview values and include a Save action row near the bottom.",
    );
  }
  parts.push(`User request:\n${userPrompt}`);
  return parts.join("\n\n");
};

const buildLayoutSchema = (ctx) => {
  const defs = {
    segment: { anyOf: [] },
    stack: {
      type: "object",
      required: ["above"],
      properties: {
        above: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/segment" },
        },
        class: { type: "string" },
      },
    },
    columns: {
      type: "object",
      required: ["besides"],
      properties: {
        besides: {
          type: "array",
          minItems: 2,
          items: { anyOf: [{ $ref: "#/$defs/segment" }, { type: "null" }] },
        },
        widths: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 12 },
        },
        gx: { type: "integer", minimum: 0, maximum: 5 },
        gy: { type: "integer", minimum: 0, maximum: 5 },
      },
    },
    container: {
      type: "object",
      required: ["type", "contents"],
      properties: {
        type: { const: "container" },
        contents: { $ref: "#/$defs/segment" },
        customClass: { type: "string" },
        style: { type: "string" },
      },
    },
    card: {
      type: "object",
      required: ["type", "contents"],
      properties: {
        type: { const: "card" },
        title: { type: "string" },
        contents: { $ref: "#/$defs/segment" },
      },
    },
    tabs: {
      type: "object",
      required: ["type", "tabs"],
      properties: {
        type: { const: "tabs" },
        tabs: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["title", "contents"],
            properties: {
              title: { type: "string" },
              contents: { $ref: "#/$defs/segment" },
            },
          },
        },
      },
    },
    blank: {
      type: "object",
      required: ["type", "contents"],
      properties: {
        type: { const: "blank" },
        contents: { type: "string" },
        textStyle: {
          type: "array",
          items: { type: "string", enum: TEXT_STYLES },
        },
      },
    },
    line_break: {
      type: "object",
      required: ["type"],
      properties: { type: { const: "line_break" } },
    },
    image: {
      type: "object",
      required: ["type", "url"],
      properties: {
        type: { const: "image" },
        url: { type: "string" },
        alt: { type: "string" },
      },
    },
    link: {
      type: "object",
      required: ["type", "url"],
      properties: {
        type: { const: "link" },
        url: { type: "string" },
        text: { type: "string" },
        link_style: { type: "string", enum: ["", ...BUTTON_STYLES] },
      },
    },
  };

  const pushRef = (ref) => defs.segment.anyOf.push({ $ref: ref });
  [
    "#/$defs/stack",
    "#/$defs/columns",
    "#/$defs/container",
    "#/$defs/card",
    "#/$defs/tabs",
    "#/$defs/blank",
    "#/$defs/line_break",
    "#/$defs/image",
    "#/$defs/link",
  ].forEach(pushRef);

  if (ctx.viewNames.length) {
    defs.view = {
      type: "object",
      required: ["type", "view"],
      properties: {
        type: { const: "view" },
        view: { type: "string", enum: ctx.viewNames },
        relation: { type: "string" },
        state: { type: "object" },
      },
    };
    defs.view_link = {
      type: "object",
      required: ["type", "view"],
      properties: {
        type: { const: "view_link" },
        view: { type: "string", enum: ctx.viewNames },
        view_label: { type: "string" },
        link_style: { type: "string", enum: ["", ...BUTTON_STYLES] },
      },
    };
    pushRef("#/$defs/view");
    pushRef("#/$defs/view_link");
  }

  if (ctx.fields.length) {
    defs.field = {
      anyOf: ctx.fields.map((field) => {
        const fieldview = field.fieldviews.length
          ? { type: "string", enum: field.fieldviews }
          : { type: "string" };
        return {
          type: "object",
          required: ["type", "field_name"],
          properties: {
            type: { const: "field" },
            field_name: { const: field.name },
            fieldview,
            textStyle: {
              type: "array",
              items: { type: "string", enum: TEXT_STYLES },
            },
          },
        };
      }),
    };
    pushRef("#/$defs/field");
  }

  if (ctx.actions.length) {
    defs.action = {
      anyOf: ctx.actions.map((action) => ({
        type: "object",
        required: ["type", "action_name"],
        properties: {
          type: { const: "action" },
          action_name: { const: action },
          action_label: { type: "string" },
          action_style: { type: "string", enum: BUTTON_STYLES },
          action_size: { type: "string", enum: ACTION_SIZES },
          confirm: { type: "boolean" },
        },
      })),
    };
    pushRef("#/$defs/action");
  }

  return {
    type: "object",
    required: ["layout"],
    properties: {
      layout: { $ref: "#/$defs/segment" },
      explanation: {
        type: "string",
        description: "Optional single sentence summary of the layout.",
      },
    },
    $defs: defs,
  };
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
  return {
    type: "field",
    field_name: fieldMeta.name,
    fieldview: userView || pickFieldview(fieldMeta, ctx.mode),
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

const parseBracketMarkup = (text) => {
  if (!text || !text.includes("[")) return [];
  const root = { tag: "root", children: [], text: "" };
  const stack = [root];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "[") {
      const end = text.indexOf("]", i + 1);
      if (end === -1) break;
      const rawTag = text.slice(i + 1, end).trim();
      if (rawTag.startsWith("/")) {
        const closing = rawTag.slice(1).trim().toLowerCase();
        while (stack.length > 1) {
          const popped = stack.pop();
          if (popped.tag === closing) break;
        }
      } else {
        const tag = rawTag.toLowerCase();
        const node = { tag, children: [], text: "" };
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      }
      i = end + 1;
    } else {
      const next = text.indexOf("[", i);
      const chunk = text.slice(i, next === -1 ? text.length : next);
      const top = stack[stack.length - 1];
      if (top) top.text = (top.text || "") + chunk;
      i = next === -1 ? text.length : next;
    }
  }
  return root.children;
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

const convertBracketSyntax = (text, ctx) => {
  const nodes = parseBracketMarkup(text);
  if (!nodes.length) return null;
  const objects = nodes.map((node) => buildBracketObject(node)).filter(Boolean);
  if (!objects.length) return null;
  const root =
    objects.length === 1 ? objects[0] : { type: "group", children: objects };
  return convertForeignLayout(root, ctx);
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
  if (!tableName) return ctx;

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
  const stateActions = Object.keys(getState().actions || {});
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

module.exports = {
  run: async (prompt, mode, table) => {
    const ctx = await buildContext(mode, table);
    const schema = buildLayoutSchema(ctx);
    const llm = getState().functions.llm_generate;
    if (!llm?.run) throw new Error("LLM generator not configured");

    const llmPrompt = buildPromptText(prompt, ctx);
    const options = {
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "saltcorn_layout",
          schema,
        },
      },
    };

    let payload;
    let rawResponse;
    try {
      rawResponse = await llm.run(llmPrompt, options);
      payload = parseJsonPayload(rawResponse);
    } catch (err) {
      const salvaged = extractJsonStructure(rawResponse || err.message || "");
      if (salvaged) {
        payload = salvaged.layout ? salvaged : { layout: salvaged };
      } else {
        console.warn("Copilot layout JSON parsing failed", err?.message || String(err));
        const bracketCandidate = convertBracketSyntax(rawResponse || err.message || "", ctx);
        if (bracketCandidate) {
          try {
            return enforceModeConsistency(normalizeLayout(bracketCandidate, ctx), ctx, prompt);
          } catch (bracketErr) {
            console.error("Copilot bracket layout normalization failed", bracketErr);
          }
        }
        return buildDeterministicLayout(ctx, prompt);
      }
    }

    const candidate = payload.layout ?? payload;
    try {
      return enforceModeConsistency(normalizeLayout(candidate, ctx), ctx, prompt);
    } catch (err) {
      console.error("Copilot layout normalization failed", err);
      const converted = convertForeignLayout(candidate, ctx);
      if (converted) {
        try {
          return enforceModeConsistency(
            normalizeLayout(converted, ctx),
            ctx,
            prompt,
          );
        } catch (innerErr) {
          console.error(
            "Copilot converted layout normalization failed",
            innerErr,
          );
        }
      } else {
        console.error("Copilot foreign layout conversion failed", candidate);
      }
      return buildDeterministicLayout(ctx, prompt);
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
