const { getState } = require("@saltcorn/data/db/state");
const Table = require("@saltcorn/data/models/table");
const Trigger = require("@saltcorn/data/models/trigger");
const View = require("@saltcorn/data/models/view");
const { edit_build_in_actions } = require("@saltcorn/data/viewable_fields");
// const { parseHTML } = require("./common");

// const BUTTON_STYLES = [
//   "btn-primary",
//   "btn-secondary",
//   "btn-success",
//   "btn-info",
//   "btn-warning",
//   "btn-danger",
//   "btn-outline-primary",
//   "btn-outline-secondary",
//   "btn-link",
// ];
const ACTION_SIZES = ["btn-sm", "btn-lg"];
// const TEXT_STYLES = [
//   "h1",
//   "h2",
//   "h3",
//   "h4",
//   "h5",
//   "h6",
//   "fst-italic",
//   "text-muted",
//   "fw-bold",
//   "text-underline",
//   "small",
//   "font-monospace",
// ];
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

// const textFallback = (contents) => ({
//   type: "blank",
//   contents: String(contents || "").trim(),
// });

// const looksLikeSchemaText = (text) => {
//   if (!text || typeof text !== "string") return false;
//   const trimmed = text.trim();
//   if (!trimmed) return false;
//   const hasBraces = /[\[{].*[\]}]/s.test(trimmed);
//   const hasColon = trimmed.includes(":");
//   const hasKeywords = /\b(layout|above|besides|field|action|view)\b/i.test(
//     trimmed,
//   );
//   return (hasBraces && hasColon) || hasKeywords;
// };

// const isSchemaTextLayout = (layout) => {
//   if (!layout || typeof layout !== "object") return false;
//   const items = Array.isArray(layout.above) ? layout.above.filter(Boolean) : [];
//   if (items.length !== 1) return false;
//   const seg = items[0];
//   return seg?.type === "blank" && looksLikeSchemaText(seg.contents);
// };

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

// const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// const pickSaveActionName = (actions) => {
//   if (!actions?.length) return undefined;
//   const exact = actions.find((a) => a === "Save");
//   if (exact) return exact;
//   const fuzzy = actions.find((a) => /save/i.test(a));
//   if (fuzzy) return fuzzy;
//   return actions[0];
// };

// Extracts all action mentions from the prompt, including duplicates for repeated mentions
// Also handles common action phrases like "button with X action"
// const extractRequestedActions = (prompt, availableActions) => {
//   if (!prompt || !availableActions?.length) return [];
//   const src = prompt.toLowerCase();
//   const requestedEntries = []; // { action, idx } for ordering

//   // Common action phrase patterns to detect action requests
//   const actionPhrasePatterns = [
//     /button\s+(?:with|for)\s+["']?([^"']+?)["']?\s*action/gi,
//     /action\s*["']([^"']+)["']/gi,
//     /(\w+)\s+button/gi,
//     /button.*?["']([^"']+)["']/gi,
//   ];

//   // First, try to extract actions from phrase patterns
//   for (const pattern of actionPhrasePatterns) {
//     let match;
//     const re = new RegExp(pattern.source, pattern.flags);
//     while ((match = re.exec(src))) {
//       const actionMention = (match[1] || "").trim().toLowerCase();
//       if (!actionMention) continue;

//       // Find matching available action
//       const matchedAction = availableActions.find((a) => {
//         const actionLower = String(a).toLowerCase();
//         const aliases = [
//           actionLower,
//           actionLower.replace(/_/g, " "),
//           actionLower.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(),
//         ];
//         return aliases.some(
//           (alias) =>
//             actionMention.includes(alias) || alias.includes(actionMention),
//         );
//       });

//       if (matchedAction) {
//         requestedEntries.push({ action: matchedAction, idx: match.index });
//       }
//     }
//   }

//   // Also check for direct action name mentions
//   for (const action of availableActions) {
//     const actionLower = String(action).toLowerCase();
//     const aliasPatterns = [
//       actionLower,
//       actionLower.replace(/_/g, " "),
//       actionLower.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(),
//     ];

//     for (const alias of aliasPatterns) {
//       const escaped = escapeRegex(alias);
//       const re = new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, "gi");
//       let match;
//       while ((match = re.exec(src))) {
//         const idx = match.index + (match[1] ? match[1].length : 0);
//         // Check if this position is already captured
//         const alreadyCaptured = requestedEntries.some(
//           (e) =>
//             Math.abs(e.idx - idx) < alias.length + 5 && e.action === action,
//         );
//         if (!alreadyCaptured) {
//           requestedEntries.push({ action, idx });
//         }
//         if (re.lastIndex === match.index) re.lastIndex++;
//       }
//     }
//   }

//   // Sort by position and return actions in order (preserving order of first occurrence)
//   requestedEntries.sort((a, b) => a.idx - b.idx);

//   // Deduplicate while preserving order
//   const seen = new Set();
//   const result = [];
//   for (const entry of requestedEntries) {
//     if (!seen.has(entry.action)) {
//       seen.add(entry.action);
//       result.push(entry.action);
//     }
//   }

//   return result;
// };

// const isSingleColumnLayout = (prompt) => {
//   if (!prompt) return false;
//   return /\b(single[- ]?column|one[- ]?column|1[- ]?column|vertical|stacked|no[- ]?columns?)\b/i.test(
//     prompt,
//   );
// };

// Detects requested column count from prompt (1, 2, 3, 4, etc.)
// const getRequestedColumnCount = (prompt) => {
//   if (!prompt) return null;
//   const src = prompt.toLowerCase();

//   // Check for specific column counts
//   if (/\b(two|2|double)[- ]?column/i.test(src)) return 2;
//   if (/\b(three|3|triple)[- ]?column/i.test(src)) return 3;
//   if (/\b(four|4)[- ]?column/i.test(src)) return 4;
//   if (/\b(single|1|one)[- ]?column/i.test(src)) return 1;

//   // Check for multi-column without specific count - default to 2
//   if (/\b(multi[- ]?column|grid|columns)\b/i.test(src)) return 2;

//   return null; // No column preference detected
// };

// const preferEditableFields = (fields) => {
//   const editable = (fields || []).filter(
//     (f) => !f.primary_key && !f.calculated && !f.is_pk_name && f.name !== "id",
//   );
//   return editable.length ? editable : fields || [];
// };

// const fieldAliases = (field) =>
//   [field?.name, field?.label]
//     .filter(Boolean)
//     .map((s) => String(s).toLowerCase())
//     .flatMap((s) => [s, s.replace(/_/g, " "), s.replace(/[-_]/g, " ")]);

// const compactAlnum = (s) =>
//   String(s || "")
//     .toLowerCase()
//     .replace(/[^a-z0-9]/g, "");

// const compactIndexMap = (text) => {
//   const chars = [];
//   const indexMap = [];
//   for (let i = 0; i < text.length; i++) {
//     const ch = text[i];
//     if (/[a-z0-9]/i.test(ch)) {
//       chars.push(ch.toLowerCase());
//       indexMap.push(i);
//     }
//   }
//   return { compact: chars.join(""), indexMap };
// };

// const firstAliasIndex = (field, prompt) => {
//   const src = (prompt || "").toLowerCase();
//   if (!src) return -1;
//   let best = -1;
//   for (const nm of fieldAliases(field)) {
//     if (!nm) continue;
//     const re = new RegExp(
//       `(^|[^a-z0-9_])${escapeRegex(nm)}([^a-z0-9_]|$)`,
//       "i",
//     );
//     const match = re.exec(src);
//     if (!match) continue;
//     const idx = match.index + (match[1] ? match[1].length : 0);
//     if (best === -1 || idx < best) best = idx;
//   }

//   const { compact, indexMap } = compactIndexMap(src);
//   for (const nm of fieldAliases(field)) {
//     const compactAlias = compactAlnum(nm);
//     if (!compactAlias || compactAlias.length < 3) continue;
//     const cidx = compact.indexOf(compactAlias);
//     if (cidx === -1) continue;
//     const idx = indexMap[cidx] ?? -1;
//     if (idx >= 0 && (best === -1 || idx < best)) best = idx;
//   }

//   return best;
// };

// const allAliasIndexes = (field, prompt) => {
//   const src = (prompt || "").toLowerCase();
//   if (!src) return [];
//   const idxs = [];
//   for (const nm of fieldAliases(field)) {
//     if (!nm) continue;
//     const re = new RegExp(
//       `(^|[^a-z0-9_])${escapeRegex(nm)}([^a-z0-9_]|$)`,
//       "gi",
//     );
//     let match;
//     while ((match = re.exec(src))) {
//       idxs.push(match.index + (match[1] ? match[1].length : 0));
//       if (re.lastIndex === match.index) re.lastIndex++;
//     }
//   }

//   const { compact, indexMap } = compactIndexMap(src);
//   for (const nm of fieldAliases(field)) {
//     const compactAlias = compactAlnum(nm);
//     if (!compactAlias || compactAlias.length < 3) continue;
//     let from = 0;
//     while (from < compact.length) {
//       const cidx = compact.indexOf(compactAlias, from);
//       if (cidx === -1) break;
//       const idx = indexMap[cidx];
//       if (typeof idx === "number") idxs.push(idx);
//       from = cidx + compactAlias.length;
//     }
//   }

//   return Array.from(new Set(idxs)).sort((a, b) => a - b);
// };

// const mentionedEditableFields = (prompt, ctx) => {
//   return preferEditableFields(ctx.fields)
//     .map((field) => ({ field, idx: firstAliasIndex(field, prompt) }))
//     .filter((m) => m.idx >= 0)
//     .sort((a, b) => a.idx - b.idx)
//     .map((m) => m.field);
// };

// Find best matching fieldview from user's request, strictly validating against field's available views
// const findOverrideFieldview = (field, override) => {
//   if (!override?.keywords?.length || !field?.fieldviews?.length) return null;

//   // Search for a matching fieldview from the field's actual available views
//   // based on the user's requested keywords
//   for (const keyword of override.keywords) {
//     const lowerKeyword = String(keyword).toLowerCase();
//     // Try exact match first
//     const exact = field.fieldviews.find(
//       (fv) => String(fv).toLowerCase() === lowerKeyword,
//     );
//     if (exact) return exact;
//     // Try contains match
//     const fuzzy = field.fieldviews.find((fv) =>
//       String(fv).toLowerCase().includes(lowerKeyword),
//     );
//     if (fuzzy) return fuzzy;
//   }
//   // No valid fieldview found for the requested keywords
//   return null;
// };

// Semantic keyword mappings - these are user-facing terms that map to fieldview search keywords
// The actual fieldview matching happens dynamically against the field's available fieldviews
// const FIELDVIEW_KEYWORDS = [
//   // Edit mode keywords
//   {
//     aliases: ["markdown", "markdown editor", "md editor", "rich text"],
//     keywords: ["markdown", "toastui", "richtext", "textarea"],
//   },
//   {
//     aliases: ["text area", "textarea", "multi-line", "multiline"],
//     keywords: ["textarea", "text_area", "multiline"],
//   },
//   { aliases: ["email", "email input"], keywords: ["email"] },
//   { aliases: ["url", "link input"], keywords: ["url", "link"] },
//   {
//     aliases: ["number", "numeric", "integer"],
//     keywords: ["number", "integer", "numeric"],
//   },
//   { aliases: ["date", "date picker"], keywords: ["date"] },
//   { aliases: ["time", "time picker"], keywords: ["time"] },
//   {
//     aliases: ["datetime", "date time", "timestamp"],
//     keywords: ["datetime", "timestamp"],
//   },
//   {
//     aliases: ["checkbox", "toggle", "boolean"],
//     keywords: ["checkbox", "toggle", "bool"],
//   },
//   {
//     aliases: ["color", "colour", "color picker"],
//     keywords: ["color", "colour"],
//   },
//   {
//     aliases: ["file", "upload", "attachment"],
//     keywords: ["file", "upload", "attachment"],
//   },
//   { aliases: ["password", "secret"], keywords: ["password", "secret"] },
//   { aliases: ["phone", "telephone", "tel"], keywords: ["phone", "tel"] },
//   // Show mode keywords
//   {
//     aliases: [
//       "render as markdown",
//       "render markdown",
//       "as markdown",
//       "show as markdown",
//       "display as markdown",
//       "markdown format",
//     ],
//     keywords: ["markdown", "show_markdown"],
//   },
//   {
//     aliases: [
//       "render as html",
//       "as html",
//       "show as html",
//       "display as html",
//       "html format",
//       "render html",
//     ],
//     keywords: ["html", "unsafe_html", "show_with_html"],
//   },
//   {
//     aliases: ["as code", "code block", "show as code", "code format"],
//     keywords: ["code", "pre"],
//   },
//   {
//     aliases: ["as link", "as a link", "show as link", "clickable link"],
//     keywords: ["link", "as_link"],
//   },
// ];

// const requestedFieldOverrides = (prompt, ctx) => {
//   const src = (prompt || "").toLowerCase();
//   const overrides = {};

//   // Check if any fieldview keyword is mentioned
//   const hasAnyInputTypeCue = FIELDVIEW_KEYWORDS.some(({ aliases }) =>
//     aliases.some((alias) => src.includes(alias.toLowerCase())),
//   );
//   if (!hasAnyInputTypeCue) return overrides;

//   // Build field mentions with their positions in the prompt
//   const fieldMentions = [];
//   for (const field of ctx.fields || []) {
//     const idxs = allAliasIndexes(field, src);
//     for (const idx of idxs)
//       fieldMentions.push({ fieldName: field.name, field, idx });
//   }
//   fieldMentions.sort((a, b) => a.idx - b.idx);
//   if (!fieldMentions.length) return overrides;

//   // Build keyword mentions with their positions
//   const keywordMentions = [];
//   for (const spec of FIELDVIEW_KEYWORDS) {
//     for (const alias of spec.aliases) {
//       const escaped = escapeRegex(alias.toLowerCase());
//       const re = new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, "gi");
//       let match;
//       while ((match = re.exec(src))) {
//         keywordMentions.push({
//           idx: match.index + (match[1] ? match[1].length : 0),
//           keywords: spec.keywords,
//         });
//         if (re.lastIndex === match.index) re.lastIndex++;
//       }
//     }
//   }
//   keywordMentions.sort((a, b) => a.idx - b.idx);

//   // Associate keywords with fields based on proximity
//   for (const k of keywordMentions) {
//     // Find the closest field mention before this keyword (within 80 chars)
//     const candidates = fieldMentions.filter(
//       (fm) => fm.idx <= k.idx && k.idx - fm.idx <= 80,
//     );
//     if (!candidates.length) continue;
//     const chosen = candidates[candidates.length - 1];

//     // Only add override if the field actually supports one of the requested fieldviews
//     const fieldviews = chosen.field?.fieldviews || [];
//     const validKeywords = k.keywords.filter((kw) =>
//       fieldviews.some((fv) =>
//         String(fv).toLowerCase().includes(kw.toLowerCase()),
//       ),
//     );

//     if (validKeywords.length) {
//       overrides[chosen.fieldName] = {
//         keywords: validKeywords,
//       };
//     }
//   }

//   return overrides;
// };

// const fieldsFromPrompt = (prompt, ctx) => {
//   // Respect only explicitly mentioned fields; if none are mentioned, return none
//   const preferred = mentionedEditableFields(prompt, ctx);
//   return preferred;
// };

// const isExplicitSubsetPrompt = (prompt, ctx) => {
//   const src = (prompt || "").toLowerCase();
//   if (!src.trim()) return false;
//   const hasSubsetCue =
//     /\bonly\b|\bjust\b|\bthese\s+fields\b|\bfor\s+(the\s+)?fields?\b|\bwith\s+(the\s+)?fields?\b/.test(
//       src,
//     );
//   if (!hasSubsetCue) return false;
//   const mentioned = mentionedEditableFields(prompt, ctx);
//   const editable = preferEditableFields(ctx.fields);
//   return mentioned.length > 0 && mentioned.length < editable.length;
// };

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

// const appendSegments = (layout, extraSegments = []) => {
//   const extras = ensureArray(extraSegments).filter(Boolean);
//   if (!extras.length) return layout;
//   if (layout && typeof layout === "object" && Array.isArray(layout.above)) {
//     return { ...layout, above: [...layout.above, ...extras] };
//   }
//   if (layout && typeof layout === "object") {
//     return { above: [layout, ...extras] };
//   }
//   return { above: extras };
// };

// const generateLoremWords = (count = 60) => {
//   const seed = [
//     "lorem",
//     "ipsum",
//     "dolor",
//     "sit",
//     "amet",
//     "consectetur",
//     "adipiscing",
//     "elit",
//     "sed",
//     "do",
//     "eiusmod",
//     "tempor",
//     "incididunt",
//     "ut",
//     "labore",
//     "et",
//     "dolore",
//     "magna",
//     "aliqua",
//     "enim",
//     "minim",
//     "veniam",
//     "quis",
//     "nostrud",
//     "exercitation",
//     "ullamco",
//     "laboris",
//     "nisi",
//     "aliquip",
//     "ex",
//     "ea",
//     "commodo",
//     "consequat",
//     "duis",
//     "aute",
//     "irure",
//     "dolor",
//     "in",
//     "reprehenderit",
//     "voluptate",
//     "velit",
//     "esse",
//     "cillum",
//     "dolore",
//     "eu",
//     "fugiat",
//     "nulla",
//     "pariatur",
//     "excepteur",
//     "sint",
//     "occaecat",
//     "cupidatat",
//     "non",
//     "proident",
//     "sunt",
//     "in",
//     "culpa",
//     "qui",
//     "officia",
//     "deserunt",
//     "mollit",
//     "anim",
//     "id",
//     "est",
//     "laborum",
//   ];
//   const words = [];
//   for (let i = 0; i < Math.max(1, count); i++) {
//     words.push(seed[i % seed.length]);
//   }
//   return words.join(" ");
// };

// const pickViewFromPrompt = (viewNames, prompt) => {
//   if (!viewNames?.length) return null;
//   const src = (prompt || "").toLowerCase();
//   let best = null;
//   for (const name of viewNames) {
//     const lower = String(name).toLowerCase();
//     if (src.includes(lower)) {
//       best = name;
//       break;
//     }
//   }
//   return best || viewNames[0];
// };

// const parseWidgetIntent = (prompt, ctx) => {
//   const src = (prompt || "").toLowerCase();
//   if (!src.trim()) return { hasAny: false };

//   const numberMatch = src.match(/(\d+)\s+cards?/i);
//   const listMatch = src.match(/list\s+of\s+(\d+)\s+cards?/i);
//   const cardCount = numberMatch
//     ? Number(numberMatch[1])
//     : listMatch
//       ? Number(listMatch[1])
//       : src.includes("card")
//         ? 1
//         : 0;

//   const wordMatch = src.match(/(\d+)\s+words?/i);
//   const wordCount = wordMatch ? Number(wordMatch[1]) : 0;

//   const wantViewLink = /view\s*[_ ]link/.test(src);
//   const wantView = /\bembed(?:ded)?\s+view\b|\bview\b/.test(src);
//   const wantImage = /image|photo|picture/.test(src);
//   const wantTabs = /tabs?/.test(src);
//   const wantSearch = /search\s*bar|search\s+box/.test(src);
//   const wantText = /text|paragraph|bio/.test(src);
//   const wantContainer = /container|box|section/.test(src);
//   const wantLineBreak = /line\s*break|divider|separator/.test(src);
//   const wantLink = /\blink\b/.test(src) && !wantViewLink;

//   return {
//     hasAny:
//       cardCount > 0 ||
//       wantViewLink ||
//       wantView ||
//       wantImage ||
//       wantTabs ||
//       wantSearch ||
//       wantText ||
//       wantContainer ||
//       wantLineBreak ||
//       wantLink,
//     cardCount,
//     wordCount: wordCount || (src.includes("bio") ? 80 : 0),
//     wantViewLink,
//     wantView,
//     wantImage,
//     wantTabs,
//     wantSearch,
//     wantText,
//     wantContainer,
//     wantLineBreak,
//     wantLink,
//     targetView: pickViewFromPrompt(ctx?.viewNames || [], prompt),
//   };
// };

// const buildWidgetsFromIntent = (intent, ctx) => {
//   if (!intent?.hasAny) return [];
//   const widgets = [];
//   const loremText = generateLoremWords(intent.wordCount || 60);

//   if (intent.cardCount > 0) {
//     const hasImages = intent.wantImage;
//     const baseLabel = /(tree|trees)/i.test(intent.source || "")
//       ? "Tree"
//       : "Card";
//     for (let i = 0; i < intent.cardCount; i++) {
//       const title = `${baseLabel} ${i + 1}`;
//       const parts = [
//         { type: "blank", contents: title, class: "fw-bold" },
//         { type: "blank", contents: generateLoremWords(20) },
//       ];
//       if (hasImages) {
//         parts.push({
//           type: "image",
//           url: "https://placehold.co/320x200",
//           alt: `${title} image`,
//           class: "mt-2",
//         });
//       }
//       widgets.push({
//         type: "card",
//         title,
//         contents: { above: parts },
//       });
//     }
//   }

//   if (intent.wantText) {
//     widgets.push({ type: "blank", contents: loremText });
//   }

//   const targetView =
//     intent.targetView || (ctx.viewNames ? ctx.viewNames[0] : null);

//   if (intent.wantView && targetView) {
//     widgets.push({ type: "view", view: targetView, state: {} });
//   }

//   if (intent.wantViewLink && targetView) {
//     widgets.push({
//       type: "view_link",
//       view: targetView,
//       view_label: targetView,
//       link_style: "btn-link",
//     });
//   }

//   if (intent.wantTabs) {
//     widgets.push({
//       type: "tabs",
//       tabs: [
//         {
//           title: "Tab 1",
//           contents: { type: "blank", contents: loremText.slice(0, 80) },
//         },
//         {
//           title: "Tab 2",
//           contents: { type: "blank", contents: loremText.slice(80, 160) },
//         },
//       ],
//     });
//   }

//   if (intent.wantImage) {
//     widgets.push({
//       type: "image",
//       url: "https://placehold.co/600x400",
//       alt: "Placeholder image",
//     });
//   }

//   if (intent.wantSearch) {
//     widgets.push({ type: "search_bar" });
//   }

//   if (intent.wantContainer) {
//     widgets.push({
//       type: "container",
//       contents: { type: "blank", contents: loremText.slice(0, 100) },
//       class: "border p-3",
//     });
//   }

//   if (intent.wantLineBreak) {
//     widgets.push({ type: "line_break" });
//   }

//   if (intent.wantLink) {
//     widgets.push({
//       type: "link",
//       url: "#",
//       text: "Click me",
//       link_style: "btn btn-primary",
//     });
//   }

//   return widgets;
// };

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

// const makeEditRow = (field, prompt) => {
//   const overrides = requestedFieldOverrides(prompt, { fields: [field] });
//   const override = overrides[field.name];
//   const overrideFieldview = findOverrideFieldview(field, override);
//   // pickFieldview always returns a valid fieldview from field.fieldviews
//   const fieldview = overrideFieldview || pickFieldview(field, "edit");

//   return {
//     besides: [
//       {
//         type: "blank",
//         contents: field.label || field.name,
//         block: false,
//         inline: false,
//         textStyle: "",
//         isFormula: {},
//         labelFor: field.name,
//       },
//       {
//         type: "field",
//         field_name: field.name,
//         fieldview,
//         textStyle: "",
//         block: false,
//         configuration: {},
//       },
//     ],
//     aligns: ["end", "start"],
//     breakpoints: ["", ""],
//     style: { "margin-bottom": "1.5rem" },
//     widths: [2, 10],
//     setting_col_n: 0,
//   };
// };

// const buildDeterministicEditLayout = (ctx, prompt) => {
//   const selectedFields = fieldsFromPrompt(prompt, ctx);
//   if (!selectedFields.length) return { above: [] };

//   const columnCount = getRequestedColumnCount(prompt);
//   let fieldRows;
//   if (columnCount && columnCount >= 2) {
//     fieldRows = [];
//     const colWidth = Math.floor(12 / columnCount);
//     for (let i = 0; i < selectedFields.length; i += columnCount) {
//       const fieldsInRow = selectedFields.slice(i, i + columnCount);
//       const besides = fieldsInRow.map((field) => {
//         const overrides = requestedFieldOverrides(prompt, { fields: [field] });
//         const override = overrides[field.name];
//         const overrideFieldview = findOverrideFieldview(field, override);
//         const fieldview = overrideFieldview || pickFieldview(field, "edit");
//         return {
//           above: [
//             {
//               type: "blank",
//               contents: field.label || field.name,
//             },
//             {
//               type: "field",
//               field_name: field.name,
//               fieldview,
//               configuration: {},
//             },
//           ],
//         };
//       });
//       while (besides.length < columnCount) besides.push(null);
//       fieldRows.push({
//         besides,
//         widths: Array(columnCount).fill(colWidth),
//       });
//     }
//   } else {
//     fieldRows = selectedFields.map((field) => makeEditRow(field, prompt));
//   }

//   return { above: fieldRows };
// };

// const mentionedFieldsByMode = (prompt, ctx) => {
//   const baseFields =
//     ctx.mode === "edit" || ctx.mode === "filter"
//       ? preferEditableFields(ctx.fields)
//       : ctx.fields || [];
//   return baseFields
//     .map((field) => ({ field, idx: firstAliasIndex(field, prompt) }))
//     .filter((m) => m.idx >= 0)
//     .sort((a, b) => a.idx - b.idx)
//     .map((m) => m.field);
// };

// const fieldsFromPromptByMode = (prompt, ctx, limit = 6) => {
//   const mentioned = mentionedFieldsByMode(prompt, ctx);
//   return mentioned.slice(0, limit);
// };

// const pickFirstActionMatching = (actions, regex) => {
//   if (!actions?.length) return undefined;
//   return actions.find((a) => regex.test(String(a || "")));
// };

// const makeDisplayRow = (
//   field,
//   mode,
//   singleColumn = false,
//   requestedFieldview = null,
// ) => {
//   const fieldview = pickFieldview(field, mode, requestedFieldview);

//   if (singleColumn) {
//     return {
//       above: [
//         {
//           type: "blank",
//           contents: field.label || field.name,
//           block: false,
//           inline: false,
//           textStyle: ["fw-bold"],
//           isFormula: {},
//         },
//         {
//           type: "field",
//           field_name: field.name,
//           fieldview,
//           textStyle: [],
//           block: false,
//           configuration: {},
//         },
//       ],
//     };
//   }
//   return {
//     besides: [
//       {
//         type: "blank",
//         contents: field.label || field.name,
//         block: false,
//         inline: false,
//         textStyle: ["fw-bold"],
//         isFormula: {},
//       },
//       {
//         type: "field",
//         field_name: field.name,
//         fieldview,
//         textStyle: [],
//         block: false,
//         configuration: {},
//       },
//     ],
//     aligns: ["end", "start"],
//     breakpoints: ["", ""],
//     style: { "margin-bottom": "1rem" },
//     widths: [3, 9],
//     setting_col_n: 0,
//   };
// };

// const makeActionSegment = (actionName, actionStyle = "btn-primary") => {
//   if (!actionName) return null;
//   return {
//     type: "action",
//     block: false,
//     configuration: {},
//     action_name: actionName,
//     action_label: prettifyActionName(actionName),
//     action_style: actionStyle,
//     minRole: 100,
//     isFormula: {},
//     rndid: randomId(),
//   };
// };

// const buildDeterministicShowLayout = (ctx, prompt) => {
//   const fields = fieldsFromPromptByMode(prompt, ctx, 8);
//   const singleColumn = isSingleColumnLayout(prompt);
//   const overrides = requestedFieldOverrides(prompt, ctx);
//   const rows = fields.map((field) => {
//     const requestedFieldview = findOverrideFieldview(
//       field,
//       overrides[field.name],
//     );
//     return makeDisplayRow(field, "show", singleColumn, requestedFieldview);
//   });
//   return { above: rows };
// };

// const buildDeterministicListLayout = (ctx, prompt) => {
//   const fields = fieldsFromPromptByMode(prompt, ctx, 4);
//   if (!fields.length) return { above: [] };

//   const overrides = requestedFieldOverrides(prompt, ctx);
//   const listRow = {
//     besides: fields.map((field) => ({
//       type: "field",
//       field_name: field.name,
//       fieldview: pickFieldview(
//         field,
//         "show",
//         findOverrideFieldview(field, overrides[field.name]),
//       ),
//       block: false,
//       configuration: {},
//     })),
//     widths: normalizeWidths([], fields.length),
//   };

//   return { above: [listRow] };
// };

// const buildDeterministicFilterLayout = (ctx, prompt) => {
//   const fields = fieldsFromPromptByMode(prompt, ctx, 6);
//   const rows = fields.map((field) => makeEditRow(field, prompt));
//   const runActionName =
//     pickFirstActionMatching(ctx.actions, /search|filter|apply|run|submit/i) ||
//     pickSaveActionName(ctx.actions) ||
//     ctx.actions[0];
//   const resetActionName = pickFirstActionMatching(ctx.actions, /reset|clear/i);
//   const actions = [
//     makeActionSegment(runActionName, "btn-primary"),
//     makeActionSegment(resetActionName, "btn-outline-secondary"),
//   ].filter(Boolean);
//   if (actions.length)
//     rows.push({ besides: [null, { above: actions }], widths: [2, 10] });
//   if (!rows.length)
//     return { above: [textFallback("No filter fields available")] };
//   return { above: rows };
// };

// const buildDeterministicPageLayout = (ctx, prompt) => {
//   const lines = [];
//   const intent = parseWidgetIntent(prompt, ctx);

//   if (prompt && String(prompt).trim())
//     lines.push(textFallback(String(prompt).trim()));

//   if (intent.hasAny) {
//     lines.push(...buildWidgetsFromIntent(intent, ctx));
//   } else if (ctx.viewNames.length) {
//     lines.push({ type: "view", view: ctx.viewNames[0], state: {} });
//   } else {
//     const fields = fieldsFromPromptByMode(prompt, ctx, 4);
//     lines.push(...fields.map((field) => makeDisplayRow(field, "show")));
//   }

//   return { above: lines.filter(Boolean) };
// };

// Deterministic layouts kept minimal; widgets/actions appended after
// const buildDeterministicLayout = (ctx, prompt) => {
//   let base;
//   switch (ctx.mode) {
//     case "edit":
//       base = buildDeterministicEditLayout(ctx, prompt);
//       break;
//     case "show":
//       base = buildDeterministicShowLayout(ctx, prompt);
//       break;
//     case "list":
//       base = buildDeterministicListLayout(ctx, prompt);
//       break;
//     case "filter":
//       base = buildDeterministicFilterLayout(ctx, prompt);
//       break;
//     case "page":
//       base = buildDeterministicPageLayout(ctx, prompt);
//       break;
//     default:
//       base = { above: [] };
//   }
//   const withWidgets = ensureRequestedWidgets(base, ctx, prompt);
//   const withActions = ensureRequestedActions(withWidgets, ctx, prompt);
//   return withActions;
// };

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

// const ensureRequestedActions = (layout, ctx, prompt) => {
//   const segments = collectSegments(layout, []);
//   const presentActions = new Set(
//     segments.filter((s) => s.type === "action").map((s) => s.action_name),
//   );

//   const requested = extractRequestedActions(prompt, ctx.actions);
//   const missingActions = requested.filter((a) => !presentActions.has(a));

//   if (!missingActions.length) return layout;
//   const newSegments = missingActions
//     .map((name, idx) =>
//       makeActionSegment(name, idx === 0 ? "btn-primary" : "btn-secondary"),
//     )
//     .filter(Boolean);
//   return appendSegments(layout, newSegments);
// };

// const ensureRequestedWidgets = (layout, ctx, prompt) => {
//   const intent = parseWidgetIntent(prompt, ctx);
//   if (!intent.hasAny) return layout;

//   const segments = collectSegments(layout, []);
//   const countByType = (type) => segments.filter((s) => s.type === type).length;
//   const hasType = (type) => segments.some((s) => s.type === type);

//   const missingIntent = { ...intent };
//   missingIntent.cardCount = Math.max(0, intent.cardCount - countByType("card"));
//   if (hasType("view")) missingIntent.wantView = false;
//   if (hasType("view_link")) missingIntent.wantViewLink = false;
//   if (hasType("image")) missingIntent.wantImage = false;
//   if (hasType("tabs")) missingIntent.wantTabs = false;
//   if (segments.some((s) => s.type === "search_bar"))
//     missingIntent.wantSearch = false;
//   if (hasType("container")) missingIntent.wantContainer = false;
//   if (hasType("line_break")) missingIntent.wantLineBreak = false;
//   if (hasType("link")) missingIntent.wantLink = false;

//   if (!missingIntent.hasAny && missingIntent.cardCount === 0) return layout;

//   // Update hasAny based on remaining missing items
//   missingIntent.hasAny =
//     missingIntent.cardCount > 0 ||
//     missingIntent.wantView ||
//     missingIntent.wantViewLink ||
//     missingIntent.wantImage ||
//     missingIntent.wantTabs ||
//     missingIntent.wantSearch ||
//     missingIntent.wantText ||
//     missingIntent.wantContainer ||
//     missingIntent.wantLineBreak ||
//     missingIntent.wantLink;

//   if (!missingIntent.hasAny) return layout;

//   const extras = buildWidgetsFromIntent(missingIntent, ctx);
//   return extras.length ? appendSegments(layout, extras) : layout;
// };

// const ensureRequestedFields = (layout, ctx, prompt) => {
//   const requestedFields =
//     ctx.mode === "edit"
//       ? fieldsFromPrompt(prompt, ctx)
//       : fieldsFromPromptByMode(prompt, ctx, 12);

//   if (!requestedFields.length) return layout;

//   const segments = collectSegments(layout, []);
//   const presentFields = new Set(
//     segments.filter((s) => s.type === "field").map((s) => s.field_name),
//   );

//   const missing = requestedFields.filter(
//     (f) => f && !presentFields.has(f.name),
//   );
//   if (!missing.length) return layout;

//   const extras = missing.map((field) => {
//     if (ctx.mode === "edit") return makeEditRow(field, prompt);
//     const overrides = requestedFieldOverrides(prompt, { fields: [field] });
//     const requestedFieldview = findOverrideFieldview(
//       field,
//       overrides[field.name],
//     );
//     return makeDisplayRow(
//       field,
//       "show",
//       isSingleColumnLayout(prompt),
//       requestedFieldview,
//     );
//   });

//   return appendSegments(layout, extras);
// };

const buildPromptText = (userPrompt, ctx, schema) => {
  const parts = [
    `You are an expert Saltcorn layout builder assistant. Your task is to generate a layout for mode "${ctx.mode}" that precisely fulfills the user's request.`,
    'CRITICAL: You must return ONLY a single valid JSON object. Do not include introductory text, explanations, markdown formatting (like ```json), or any pseudo-markup. The output must strictly follow this shape: {"layout": <layout-object>}.',
    'The "layout" object MUST conform entirely to the provided JSON Schema. Do not invent properties, types, or structure not defined in the schema.',
  ];
  // if (ctx.table) {
  //   const lines = ctx.fields.slice(0, 40).map((field) => {
  //     const views = field.fieldviews.join(", ");
  //     return `- ${field.name} (${field.type}${field.required ? ", required" : ""}) views: ${views}`;
  //   });
  //   if (ctx.fields.length > 40)
  //     lines.push("- ... additional fields omitted for brevity");
  //   parts.push(
  //     `Table "${ctx.table.name}" fields:\n${lines.join("\n") || "- None"}`,
  //   );
  // }
  // if (ctx.actions.length)
  //   parts.push(
  //     `Available actions: ${ctx.actions.join(", ")}. Use action segments for submits or workflows.`,
  //   );
  // if (ctx.viewNames.length)
  //   parts.push(`Views to embed or link: ${ctx.viewNames.join(", ")}.`);
  // parts.push(
  //   "Use Saltcorn layout primitives only. Prefer columns (besides) for multi-column sections, blank text for headings, and cards or containers for grouping. Do not return HTML, do not set isHTML, and do not use Markdown fences.",
  // );
  // parts.push(
  //   "Honor explicit user constraints exactly whenever possible (requested fields, action names, column count, placement like 'at the bottom', and layout orientation such as single-column). Do not substitute requested actions with other actions.",
  // );
  // if (ctx.mode === "edit") {
  //   parts.push(
  //     "For edit mode, include field segments with edit-capable fieldview values and include a Save action row near the bottom.",
  //   );
  // }
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

// const parseBracketMarkup = (text) => {
//   if (!text || !text.includes("[")) return [];
//   const root = { tag: "root", children: [], text: "" };
//   const stack = [root];
//   let i = 0;
//   while (i < text.length) {
//     if (text[i] === "[") {
//       const end = text.indexOf("]", i + 1);
//       if (end === -1) break;
//       const rawTag = text.slice(i + 1, end).trim();
//       if (rawTag.startsWith("/")) {
//         const closing = rawTag.slice(1).trim().toLowerCase();
//         while (stack.length > 1) {
//           const popped = stack.pop();
//           if (popped.tag === closing) break;
//         }
//       } else {
//         const tag = rawTag.toLowerCase();
//         const node = { tag, children: [], text: "" };
//         stack[stack.length - 1].children.push(node);
//         stack.push(node);
//       }
//       i = end + 1;
//     } else {
//       const next = text.indexOf("[", i);
//       const chunk = text.slice(i, next === -1 ? text.length : next);
//       const top = stack[stack.length - 1];
//       if (top) top.text = (top.text || "") + chunk;
//       i = next === -1 ? text.length : next;
//     }
//   }
//   return root.children;
// };

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

// const convertBracketSyntax = (text, ctx) => {
//   const nodes = parseBracketMarkup(text);
//   if (!nodes.length) return null;
//   const objects = nodes.map((node) => buildBracketObject(node)).filter(Boolean);
//   if (!objects.length) return null;
//   const root =
//     objects.length === 1 ? objects[0] : { type: "group", children: objects };
//   return convertForeignLayout(root, ctx);
// };

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

const fetchBuilderSchema = async (mode, table, req) => {
  const baseUrl =
    (getState().getConfig && getState().getConfig("base_url")) ||
    "http://localhost:3000";
  const url = new URL("/scapi/builder_schema/", baseUrl);
  url.searchParams.set("mode", mode || "show");
  if (table) url.searchParams.set("table", table);
  const headers = {};
  if (req?.headers?.cookie) headers.Cookie = req.headers.cookie;
  if (req?.headers?.authorization)
    headers.Authorization = req.headers.authorization;
  if (typeof fetch !== "function") return null;
  console.log({ url: url.toString(), headers });
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) return null;
  const json = await res.json();
  return json.success || null;
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
  run: async (prompt, mode, table, req) => {
    // Remove any leading "container:" or similar so as to remain with only the user prompt.
    prompt = prompt.trim().replace(/^\[\w+\]:\s*/, "");

    console.log({ prompt, mode, table });

    const ctx = await buildContext(mode, table);
    const schema = await fetchBuilderSchema(mode, table, req);
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
