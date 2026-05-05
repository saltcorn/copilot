const { normalizeLayoutCandidate } = require("../builder-gen");




const makeCtx = (overrides = {}) => ({
  mode: "show",
  modeGuidance: "Layout displays one record read-only. Use show fieldviews, blank headings, and optional follow-up actions.",
  table: {
    name: "user_settings",
    id: 11,
    min_role_read: 1,
    min_role_write: 1,
    ownership_field_id: null,
    ownership_formula: null,
    versioned: false,
    has_sync_info: false,
    is_user_group: false,
    external: false,
    description: "",
    constraints: [
    ],
    provider_cfg: null,
    provider_name: null,
    fields: [
      {
        refname: "",
        label: "Default sharing permission",
        name: "default_sharing_permission",
        fieldview: undefined,
        validator: () => true,
        showIf: undefined,
        parent_field: undefined,
        postText: undefined,
        class: "",
        id: 87,
        default: undefined,
        sublabel: undefined,
        description: null,
        type: {
          name: "String",
          description: "A sequence of unicode characters of any length.",
          sql_name: "text",
          js_type: "string",
          attributes: ({ table }) => {
            const strFields = table &&
                table.fields.filter((f) => (f.type || {}).name === "String" &&
                    !(f.attributes && f.attributes.localizes_field));
            const locales = Object.keys(getState().getConfig("localizer_languages", {}));
            return [
                {
                    name: "options",
                    label: "Options",
                    type: "String",
                    required: false,
                    copilot_description: 'Use this to restrict your field to a list of options (separated by commas). For instance, enter "Red, Green, Blue" here if the permissible values are Red, Green and Blue. Leave blank if the string can hold any value.',
                    sublabel: 'Use this to restrict your field to a list of options (separated by commas). For instance, enter <kbd class="fst-normal">Red, Green, Blue</kbd> here if the permissible values are Red, Green and Blue. Leave blank if the string can hold any value.',
                    attributes: { autofocus: true },
                },
                {
                    name: "min_length",
                    label: "Min length",
                    type: "Integer",
                    required: false,
                    sublabel: "The minimum number of characters in the string",
                    attributes: { asideNext: true },
                },
                {
                    name: "max_length",
                    label: "Max length",
                    type: "Integer",
                    required: false,
                    sublabel: "The maximum number of characters in the string",
                },
                {
                    name: "regexp",
                    type: "String",
                    label: "Regular expression",
                    required: false,
                    sublabel: "String value must match regular expression",
                    validator(s) {
                        if (!is_valid_regexp(s))
                            return "Not a valid Regular Expression";
                    },
                    attributes: { asideNext: true },
                },
                {
                    name: "re_invalid_error",
                    label: "Error message",
                    type: "String",
                    required: false,
                    sublabel: "Error message when regular expression does not match",
                },
                {
                    name: "exact_search_only",
                    label: "Exact search only",
                    type: "Bool",
                    sublabel: "Search only on exact match, not substring match. Useful for large tables",
                },
                ...(table
                    ? [
                        {
                            name: "localizes_field",
                            label: "Translation of",
                            sublabel: "This is a translation of a different field in a different language",
                            type: "String",
                            attributes: {
                                options: strFields.map((f) => f.name),
                            },
                        },
                        {
                            name: "locale",
                            label: "Locale",
                            sublabel: "Language locale of translation",
                            input_type: "select",
                            options: locales,
                            showIf: { localizes_field: strFields.map((f) => f.name) },
                        },
                    ]
                    : []),
            ];
          },
          contract: ({ options }) => typeof options === "string"
            ? is.one_of(options.split(","))
            : typeof options === "undefined"
                ? is.str
              : is.one_of(options.map((o) => (typeof o === "string" ? o : o.name))),
          fieldviews: {
            as_text: {
              isEdit: false,
              description: "Show the value with no other formatting",
              configFields: [
                {
                  name: "copy_to_clipbaord",
                  label: "Copy to clipboard",
                  type: "Bool",
                },
              ],
              run: (s, _req, attrs = {}) => attrs?.copy_to_clipbaord
                ? span({ class: "copy-to-clipboard" }, text_attr(s || ""))
              : text_attr(s || ""),
            },
            preFormatted: {
              isEdit: false,
              description: "Pre-formatted (in a &lt;pre&gt; tag)",
              run: (s) => s ? span({ style: "white-space:pre-wrap" }, text_attr(s || "")) : "",
            },
            code: {
              isEdit: false,
              description: "Show as a code block",
              run: (s) => (s ? pre(code(text_attr(s || ""))) : ""),
            },
            monospace_block: {
              isEdit: false,
              configFields: [
                {
                  name: "max_init_height",
                  label: "Max initial rows",
                  sublabel: "Only show this many rows until the user clicks",
                  type: "Integer",
                },
                {
                  name: "copy_btn",
                  label: "Copy button",
                  type: "Bool",
                },
              ],
              description: "Show as a monospace block",
              run: (s, _req, attrs = {}) => {
                if (!s)
                    return "";
                const copy_btn = attrs.copy_btn
                    ? button({
                        class: "btn btn-secondary btn-sm monospace-copy-btn m-1 d-none-prefer",
                        type: "button",
                        onclick: "copy_monospace_block(this)",
                    }, i({ class: "fas fa-copy" }))
                    : "";
                if (!attrs.max_init_height)
                    return (copy_btn +
                        pre({
                            class: "monospace-block",
                        }, s));
                const lines = s.split("\n");
                if (lines.length <= attrs.max_init_height)
                    return (copy_btn +
                        pre({
                            class: "monospace-block",
                        }, s));
                return (copy_btn +
                    pre({
                        class: "monospace-block",
                        onclick: `monospace_block_click(this)`,
                    }, lines.slice(0, attrs.max_init_height).join("\n") + "\n...") +
                    pre({ class: "d-none" }, s));
              },
            },
            ellipsize: {
              isEdit: false,
              configFields: [
                {
                  name: "nchars",
                  label: "Number of characters",
                  type: "Integer",
                  default: 20,
                },
              ],
              description: "Show First N characters of text followed by ... if truncated",
              run: (s, req, attrs = {}) => {
                if (!s || !s.length)
                    return "";
                if (s.length <= (attrs.nchars || 20))
                    return text_attr(s);
                return text_attr(s.substr(0, (attrs.nchars || 20) - 3)) + "...";
              },
            },
            as_link: {
              configFields: [
                {
                  name: "link_title",
                  label: "Link title",
                  type: "String",
                  sublabel: "Optional. If blank, label is URL",
                },
                {
                  name: "target_blank",
                  label: "Open in new tab",
                  type: "Bool",
                },
              ],
              description: "Show a link with the field value as the URL.",
              isEdit: false,
              run: (s, req, attrs = {}) => s
                ? a({
                    href: text(s || ""),
                    ...(attrs.target_blank ? { target: "_blank" } : {}),
                }, text_attr(attrs?.link_title || s || ""))
              : "",
            },
            img_from_url: {
              isEdit: false,
              description: "Show an image from the URL in the field value",
              run: (s, req, attrs) => img({ src: text(s || ""), style: "width:100%" }),
            },
            as_header: {
              isEdit: false,
              description: "Show this as a header",
              run: (s) => h3(text_attr(s || "")),
            },
            show_with_html: {
              configFields: [
                {
                  input_type: "code",
                  name: "code",
                  label: "HTML",
                  sublabel: "Access the value with <code>{{ it }}</code>.",
                  default: "",
                  attributes: {
                    mode: "text/html",
                  },
                },
              ],
              isEdit: false,
              description: "Show value with any HTML code",
              run: (v, req, attrs = {}) => {
                const ctx = { ...getState().eval_context };
                ctx.it = v;
                const rendered = interpolate(attrs?.code, ctx, req?.user, "show_with_html code");
                return rendered;
              },
            },
            edit: {
              isEdit: true,
              blockDisplay: true,
              description: "edit with a standard text input, or dropdown if field has options",
              configFields: (field) => [
                ...(field.attributes.options &&
                    field.attributes.options.length > 0 &&
                    !field.required
                    ? [
                        {
                            name: "neutral_label",
                            label: "Neutral label",
                            type: "String",
                        },
                        {
                            name: "force_required",
                            label: "Required",
                            sublabel: "User must select a value, even if the table field is not required",
                            type: "Bool",
                        },
                    ]
                    : []),
                ...(field.attributes.options && field.attributes.options.length > 0
                    ? [
                        {
                            name: "exclude_values",
                            label: "Exclude values",
                            sublabel: "Comma-separated list of value to exclude from the dropdown select",
                            type: "String",
                        },
                    ]
                    : []),
                {
                    name: "placeholder",
                    label: "Placeholder",
                    type: "String",
                },
                {
                    name: "input_type",
                    label: "Input type",
                    input_type: "select",
                    options: [
                        "text",
                        "email",
                        "url",
                        "tel",
                        "password",
                        "search",
                        "hidden",
                    ],
                },
                {
                    name: "autofocus",
                    label: "Autofocus",
                    type: "Bool",
                },
                {
                    name: "readonly",
                    label: "Read-only",
                    type: "Bool",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => attrs.options && (attrs.options.length > 0 || !required)
                ? attrs.readonly
                    ? input({
                        type: "text",
                        class: ["form-control", "form-select", cls],
                        name: attrs.isFilter ? undefined : text_attr(nm),
                        "data-fieldname": text_attr(field.name),
                        id: `input${text_attr(nm)}`,
                        onChange: attrs.onChange,
                        readonly: attrs.readonly,
                        value: v,
                    })
                    : select({
                        class: [
                            "form-control",
                            "form-select",
                            cls,
                            attrs.selectizable ? "selectizable" : false,
                        ],
                        name: attrs.isFilter ? undefined : text_attr(nm),
                        "data-fieldname": text_attr(field.name),
                        id: `input${text_attr(nm)}`,
                        disabled: attrs.disabled,
                        onChange: attrs.onChange,
                        onBlur: attrs.onChange,
                        autocomplete: "off",
                        "data-explainers": attrs.explainers
                            ? encodeURIComponent(JSON.stringify(attrs.explainers))
                            : undefined,
                        required: attrs.placeholder && (required || attrs.force_required),
                        ...(field.in_auto_save
                            ? {
                                "previous-val": v,
                                onFocus: "this.setAttribute('sc-received-focus', true);",
                            }
                            : {}),
                    }, attrs.placeholder && (required || attrs.force_required)
                        ? [
                            option({ value: "", disabled: true, selected: !v }, attrs.placeholder),
                            ...getStrOptions(v, attrs.options, attrs.exclude_values),
                        ]
                        : required || attrs.force_required
                            ? getStrOptions(v, attrs.options, attrs.exclude_values)
                            : [
                                option({ value: "" }, attrs.neutral_label || ""),
                                ...getStrOptions(v, attrs.options, attrs.exclude_values),
                            ])
                : attrs.options
                    ? none_available(required)
                    : attrs.calcOptions
                        ? select({
                            class: ["form-control", "form-select", cls],
                            name: attrs.isFilter ? undefined : text_attr(nm),
                            disabled: attrs.disabled,
                            "data-fieldname": text_attr(field.name),
                            id: `input${text_attr(nm)}`,
                            onChange: attrs.onChange,
                            onBlur: attrs.onChange,
                            autocomplete: "off",
                            "data-selected": v,
                            "data-calc-options": encodeURIComponent(JSON.stringify(attrs.calcOptions)),
                        }, option({ value: "" }, ""))
                        : input({
                            type: attrs.input_type || (attrs.isFilter ? "search" : "text"),
                            disabled: attrs.disabled,
                            readonly: attrs.readonly,
                            class: ["form-control", cls],
                            placeholder: attrs.placeholder,
                            onChange: attrs.onChange,
                            spellcheck: attrs.spellcheck === false ? "false" : undefined,
                            "data-fieldname": text_attr(field.name),
                            name: attrs.isFilter ? undefined : text_attr(nm),
                            required: !!(required || attrs.force_required),
                            maxlength: isdef(attrs.max_length) && attrs.max_length,
                            minlength: isdef(attrs.min_length) && attrs.min_length,
                            pattern: !!attrs.regexp && attrs.regexp,
                            autofocus: !!attrs.autofocus,
                            autocomplete: attrs.autocomplete || undefined,
                            title: !!attrs.re_invalid_error &&
                                !!attrs.regexp &&
                                attrs.re_invalid_error,
                            id: `input${text_attr(nm)}`,
                            ...(isdef(v) && { value: text_attr(v) }),
                      }),
            },
            fill_formula_btn: {
              isEdit: true,
              blockDisplay: true,
              description: "Input with a button prefills value from specified formula",
              configFields: [
                {
                  name: "formula",
                  label: "Formula",
                  type: "String",
                },
                {
                  name: "label",
                  label: "Button label",
                  type: "String",
                },
                {
                  name: "make_unique",
                  label: "Make unique after fill",
                  type: "Bool",
                },
                {
                  name: "include_space",
                  label: "Include space",
                  type: "Bool",
                  showIf: {
                    make_unique: true,
                  },
                },
                {
                  name: "start_from",
                  label: "Start from",
                  type: "Integer",
                  default: 0,
                  showIf: {
                    make_unique: true,
                  },
                },
                {
                  name: "always_append",
                  label: "Always append",
                  type: "Bool",
                  showIf: {
                    make_unique: true,
                  },
                },
                {
                  name: "char_type",
                  label: "Append character type",
                  input_type: "select",
                  options: [
                    "Digits",
                    "Lowercase Letters",
                    "Uppercase Letters",
                  ],
                  showIf: {
                    make_unique: true,
                  },
                },
              ],
              run: (nm, v, attrs, cls, required, field) => div({ class: "input-group" }, input({
                type: attrs.input_type || "text",
                disabled: attrs.disabled,
                readonly: attrs.readonly,
                class: ["form-control", cls],
                placeholder: attrs.placeholder,
                onChange: attrs.onChange,
                "data-fieldname": text_attr(field.name),
                name: text_attr(nm),
                id: `input${text_attr(nm)}`,
                ...(isdef(v) && { value: text_attr(v) }),
                }), button({
                class: "btn btn-secondary",
                type: "button",
                "data-formula": encodeURIComponent(attrs?.formula),
                "data-formula-free-vars": encodeURIComponent(JSON.stringify(join_fields_in_formula(attrs?.formula))),
                "data-formula-table": encodeURIComponent(JSON.stringify(Table.findOne(field.table_id).to_json)),
                onClick: "fill_formula_btn_click(this" +
                    (attrs.make_unique
                        ? `,()=>make_unique_field('input${text_attr(nm)}', ${field.table_id}, '${field.name}',  $('#input${text_attr(nm)}'), ${!!attrs.include_space}, ${attrs.start_from || 0}, ${!!attrs.always_append}, '${attrs.char_type}')`
                        : "") +
                    ")",
              }, attrs?.label || "Fill")),
            },
            make_unique: {
              isEdit: true,
              blockDisplay: true,
              description: "Make this input unique in the database table",
              configFields: [
                {
                  name: "placeholder",
                  label: "Placeholder",
                  type: "String",
                },
                {
                  name: "input_type",
                  label: "Input type",
                  input_type: "select",
                  options: [
                    "text",
                    "email",
                    "url",
                    "tel",
                    "password",
                  ],
                },
                {
                  name: "include_space",
                  label: "Include space",
                  type: "Bool",
                },
                {
                  name: "start_from",
                  label: "Start from",
                  type: "Integer",
                  default: 0,
                },
                {
                  name: "always_append",
                  label: "Always append",
                  type: "Bool",
                },
                {
                  name: "char_type",
                  label: "Append character type",
                  input_type: "select",
                  options: [
                    "Digits",
                    "Lowercase Letters",
                    "Uppercase Letters",
                  ],
                },
              ],
              run: (nm, v, attrs, cls, required, field) => input({
                type: attrs.input_type || "text",
                disabled: attrs.disabled,
                readonly: attrs.readonly,
                class: ["form-control", cls],
                placeholder: attrs.placeholder,
                onChange: attrs.onChange,
                "data-fieldname": text_attr(field.name),
                name: text_attr(nm),
                id: `input${text_attr(nm)}`,
                ...(isdef(v) && { value: text_attr(v) }),
                }) +
              script(domReady(`make_unique_field('input${text_attr(nm)}', ${field.table_id}, '${field.name}', $('#input${text_attr(nm)}'), ${attrs.include_space}, ${attrs.start_from}, ${attrs.always_append}, ${JSON.stringify(attrs.char_type)})`)),
            },
            textarea: {
              isEdit: true,
              blockDisplay: true,
              description: "Edit as a text area (multi line input)",
              configFields: [
                {
                  type: "Bool",
                  name: "spellcheck",
                  label: "Spellcheck",
                },
                {
                  type: "Integer",
                  name: "rows",
                  label: "Rows",
                },
                {
                  name: "placeholder",
                  label: "Placeholder",
                  type: "String",
                },
                {
                  name: "unsafe",
                  label: "Disable escaping",
                  sublabel: "Do not escape unsafe HTML fragments",
                  type: "String",
                },
                {
                  type: "Bool",
                  name: "monospace",
                  label: "Monospace",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => textarea({
                class: ["form-control", cls, attrs.monospace && "font-monospace"],
                name: text_attr(nm),
                "data-fieldname": text_attr(field.name),
                disabled: attrs.disabled,
                onChange: attrs.onChange,
                readonly: attrs.readonly,
                placeholder: attrs.placeholder,
                spellcheck: attrs.spellcheck === false ? "false" : undefined,
                required: !!required,
                maxlength: isdef(attrs.max_length) && attrs.max_length,
                minlength: isdef(attrs.min_length) && attrs.min_length,
                id: `input${text_attr(nm)}`,
                rows: attrs.rows || 5,
              }, attrs.unsafe ? v || "" : text(v) || ""),
            },
            code_editor: {
              isEdit: true,
              blockDisplay: true,
              description: "Edit as code",
              configFields: [
                {
                  type: "String",
                  name: "mode",
                  label: "mode",
                  required: true,
                  attributes: {
                    options: [
                      "application/javascript",
                      "text/html",
                      "text/css",
                      "text/x-sql",
                    ],
                  },
                },
              ],
              run: (nm, v, attrs, cls, required, field) => textarea({
                class: ["form-control", "to-code", cls],
                name: text_attr(nm),
                "data-fieldname": text_attr(field.name),
                disabled: attrs.disabled,
                onChange: attrs.onChange,
                readonly: attrs.readonly,
                placeholder: attrs.placeholder,
                spellcheck: "false",
                required: !!required,
                maxlength: isdef(attrs.max_length) && attrs.max_length,
                minlength: isdef(attrs.min_length) && attrs.min_length,
                id: `input${text_attr(nm)}`,
                mode: attrs.mode,
              }, text(v) || ""),
            },
            radio_group: {
              isEdit: true,
              configFields: [
                {
                  type: "Bool",
                  name: "inline",
                  label: "Inline",
                },
              ],
              description: "Pick from a radio group. Field must have options",
              run: (nm, v, attrs, cls, required, field) => attrs.options
                ? radio_group({
                    class: cls,
                    name: text_attr(nm),
                    disabled: attrs.disabled,
                    inline: attrs.inline,
                    onChange: attrs.onChange,
                    required: !!required,
                    options: Array.isArray(attrs.options)
                        ? attrs.options
                        : attrs.options.split(",").map((o) => o.trim()),
                    value: v,
                })
              : none_available(required),
            },
            checkbox_group: {
              isEdit: false,
              isFilter: true,
              description: "Filter from a checkbox group. Field must have options. Possible selections are treated as OR.",
              configFields: [
                {
                  type: "Bool",
                  name: "inline",
                  label: "Inline",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => attrs && attrs.options
                ? checkbox_group({
                    class: cls,
                    name: text_attr(nm),
                    disabled: attrs.disabled,
                    inline: attrs.inline,
                    options: Array.isArray(attrs.options)
                        ? attrs.options
                        : attrs.options.split(",").map((o) => o.trim()),
                    value: v,
                })
              : i("None available"),
            },
            password: {
              isEdit: true,
              configFields: [
                {
                  name: "visibility_toggle",
                  label: "Visibility toggle",
                  type: "Bool",
                },
                {
                  name: "autocomplete",
                  label: "Autocomplete",
                  type: "String",
                  attributes: {
                    options: [
                      "on",
                      "off",
                      "current-password",
                      "new-password",
                    ],
                  },
                },
              ],
              blockDisplay: true,
              description: "Password input type, characters are hidden when typed",
              run: (nm, v, attrs, cls, required, field) => {
                const pwinput = input({
                    type: "password",
                    disabled: attrs.disabled,
                    readonly: attrs.readonly,
                    class: ["form-control", cls],
                    "data-fieldname": text_attr(field.name),
                    onChange: attrs.onChange,
                    name: text_attr(nm),
                    id: `input${text_attr(nm)}`,
                    ...(isdef(v) && { value: text_attr(v) }),
                    autocomplete: attrs?.autocomplete === false
                        ? "off"
                        : attrs?.autocomplete || undefined,
                });
                if (attrs?.visibility_toggle)
                    return div({ class: "input-group" }, pwinput, span({ class: "input-group-text toggle-password-vis" }, i({ class: "fas fa-eye toggle-password-vis-icon" })));
                else
                    return pwinput;
              },
            },
            select_by_code: {
              type: undefined,
              isEdit: true,
              blockDisplay: true,
              description: "Select by drop-down. Available options are set by code.",
              configFields: (field) => [
                {
                    name: "code",
                    label: "Code",
                    input_type: "code",
                    attributes: { mode: "application/javascript" },
                    class: "validate-statements",
                    sublabel: `Return array of: strings or <code>{ label: string, value: ${field.is_fkey ? "key-value" : field.type?.js_type || "any"} }</code>`,
                    validator(s) {
                        try {
                            let AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
                            AsyncFunction(s);
                            return true;
                        }
                        catch (e) {
                            return e.message;
                        }
                    },
                },
              ],
              // fill_options: async fill_options(field, force_allow_none, where0, extraCtx, optionsQuery, formFieldNames, user) {
              //   field.options = await eval_statements(field.attributes.code, {
              //       ...extraCtx,
              //       user,
              //       Table: table_1.default,
              //   });
              // },
              run: (nm, v, attrs, cls, reqd, field) => {
                const selOptions = select_options(v, field, (attrs || {}).force_required, (attrs || {}).neutral_label, false);
                return tags.select({
                    class: `form-control form-select ${cls} ${field.class || ""}`,
                    "data-fieldname": field.form_name,
                    name: text_attr(nm),
                    id: `input${text_attr(nm)}`,
                    disabled: attrs.disabled || attrs.disable,
                    readonly: attrs.readonly,
                    onChange: attrs.onChange,
                    autocomplete: "off",
                }, selOptions);
              },
            },
          },
          read: (v) => {
            switch (typeof v) {
                case "string":
                    //PG dislikes null bytes
                    return v.replace(/\0/g, "");
                default:
                    return undefined;
            }
          },
          presets: {
            IP: ({ req }) => req.ip,
            SessionID: ({ req }) => req.sessionID || req.cookies["express:sess"],
          },
          validate: ({ min_length, max_length, regexp, re_invalid_error }) => (x) => {
            if (!x || typeof x !== "string")
                return true; //{ error: "Not a string" };
            if (isdef(min_length) && x.length < min_length)
                return { error: `Must be at least ${min_length} characters` };
            if (isdef(max_length) && x.length > max_length)
                return { error: `Must be at most ${max_length} characters` };
            if (isdef(regexp) && !new RegExp(regexp).test(x))
                return {
                    error: re_invalid_error || `Does not match regular expression`,
                };
            return true;
          },
          validate_attributes: ({ min_length, max_length, regexp }) => (!isdef(min_length) || !isdef(max_length) || max_length >= min_length) &&
          (!isdef(regexp) || is_valid_regexp(regexp)),
        },
        options: undefined,
        help: undefined,
        required: false,
        is_unique: false,
        hidden: false,
        disabled: false,
        calculated: false,
        primary_key: false,
        stored: false,
        expression: "",
        sourceURL: undefined,
        tab: undefined,
        is_fkey: false,
        input_type: "fromtype",
        attributes: {
          regexp: "",
          options: "view,comment,edit",
          importance: 6,
          max_length: 16,
          min_length: 0,
          re_invalid_error: "",
          exact_search_only: true,
        },
        table_id: 11,
        in_auto_save: undefined,
        exclude_from_mobile: undefined,
      },
      {
        refname: "",
        label: "ID",
        name: "id",
        fieldview: undefined,
        validator: () => true,
        showIf: undefined,
        parent_field: undefined,
        postText: undefined,
        class: "",
        id: 13,
        default: undefined,
        sublabel: undefined,
        description: "",
        type: {
          name: "Integer",
          description: "Whole numbers, positive and negative.",
          sql_name: "int",
          js_type: "number",
          contract: ({ min, max }) => is.integer({ lte: max, gte: min }),
          primaryKey: {
            sql_type: "serial",
          },
          distance_operators: {
            near: {
              type: "SqlFun",
              name: "ABS",
              args: [
                {
                  type: "SqlBinOp",
                  name: "-",
                  args: [
                    "target",
                    "field",
                  ],
                },
              ],
            },
          },
          fieldviews: {
            show: {
              isEdit: false,
              description: "Show value with no additional formatting.",
              run: (s) => text(s),
            },
            edit: {
              isEdit: true,
              blockDisplay: true,
              description: "Number input, optionally with stepper.",
              configFields: [
                {
                  name: "stepper_btns",
                  label: "Stepper buttons",
                  type: "Bool",
                },
                {
                  name: "stepsize",
                  label: "Step size",
                  type: "Integer",
                },
                {
                  name: "readonly",
                  label: "Read-only",
                  type: "Bool",
                },
                {
                  name: "autofocus",
                  label: "Autofocus",
                  type: "Bool",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => {
                const id = `input${text_attr(nm)}`;
                const name = text_attr(nm);
                return attrs?.stepper_btns
                    ? number_stepper(name, v, attrs, cls, text_attr(field.name), id)
                    : input({
                        type: attrs?.type || "number",
                        inputmode: attrs?.inputmode,
                        pattern: attrs?.pattern,
                        autocomplete: attrs?.autocomplete,
                        class: ["form-control", cls],
                        disabled: attrs.disabled,
                        readonly: attrs.readonly,
                        autofocus: attrs.autofocus,
                        "data-fieldname": text_attr(field.name),
                        name,
                        onChange: attrs.onChange,
                        id,
                        step: attrs.stepsize || "1",
                        required: !!required,
                        ...(isdef(attrs.max) && { max: attrs.max }),
                        ...(isdef(attrs.min) && { min: attrs.min }),
                        ...(isdef(v) && { value: text_attr(v) }),
                    });
              },
            },
            number_slider: {
              configFields: (field) => [
                ...(!isdef(field.attributes.min)
                    ? [{ name: "min", type, required: false }]
                    : []),
                ...(!isdef(field.attributes.max)
                    ? [{ name: "max", type, required: false }]
                    : []),
              ],
              isEdit: true,
              description: "Input on a slider between defined maximum and minimum values",
              blockDisplay: true,
              run: (nm, v, attrs = {}, cls, required, field) => input({
                type: "range",
                class: ["form-control", cls],
                name: text_attr(nm),
                "data-fieldname": text_attr(field.name),
                disabled: attrs.disabled,
                readonly: attrs.readonly,
                onChange: attrs.onChange,
                step: type === "Integer"
                    ? 1
                    : attrs.decimal_places
                        ? Math.pow(10, -attrs.decimal_places)
                        : "0.01",
                id: `input${text_attr(nm)}`,
                ...(isdef(attrs.max) && { max: attrs.max }),
                ...(isdef(attrs.min) && { min: attrs.min }),
                ...(isdef(v) && { value: text_attr(v) }),
              }),
            },
            range_interval: {
              configFields: (field) => [
                ...(!isdef(field.attributes.min)
                    ? [{ name: "min", type, required: false }]
                    : []),
                ...(!isdef(field.attributes.max)
                    ? [{ name: "max", type, required: false }]
                    : []),
              ],
              isEdit: false,
              isFilter: true,
              blockDisplay: true,
              description: "User can pick filtered interval by moving low and high controls on a slider.",
              run: (nm, v, attrs = {}, cls, required, field, state = {}) => {
                return section({ class: ["range-slider", cls] }, span({ class: "rangeValues" }), input({
                    ...(isdef(state[`_gte_${nm}`])
                        ? {
                            value: text_attr(state[`_gte_${nm}`]),
                        }
                        : isdef(attrs.min)
                            ? { value: text_attr(attrs.min) }
                            : {}),
                    ...(isdef(attrs.max) && { max: attrs.max }),
                    ...(isdef(attrs.min) && { min: attrs.min }),
                    type: "range",
                    disabled: attrs.disabled,
                    readonly: attrs.readonly,
                    onChange: `set_state_field('_gte_${nm}', this.value, this)`,
                }), input({
                    ...(isdef(state[`_lte_${nm}`])
                        ? {
                            value: text_attr(state[`_lte_${nm}`]),
                        }
                        : isdef(attrs.max)
                            ? { value: text_attr(attrs.max) }
                            : {}),
                    ...(isdef(attrs.max) && { max: attrs.max }),
                    ...(isdef(attrs.min) && { min: attrs.min }),
                    type: "range",
                    disabled: attrs.disabled,
                    readonly: attrs.readonly,
                    onChange: `set_state_field('_lte_${nm}', this.value, this)`,
                }));
              },
            },
            progress_bar: {
              configFields: (field) => [
                { name: "max_min_formula", type: "Bool", label: "Max/min Formula" },
                ...(!isdef(field.attributes.min)
                    ? [
                        {
                            name: "min",
                            label: "Min",
                            type,
                            required: true,
                            showIf: { max_min_formula: false },
                        },
                    ]
                    : []),
                ...(!isdef(field.attributes.max)
                    ? [
                        {
                            name: "max",
                            label: "Max",
                            type,
                            required: true,
                            showIf: { max_min_formula: false },
                        },
                    ]
                    : []),
                {
                    name: "min_formula",
                    label: "Min formula",
                    type: "String",
                    class: "validate-expression",
                    showIf: { max_min_formula: true },
                },
                {
                    name: "max_formula",
                    label: "Max formula",
                    type: "String",
                    class: "validate-expression",
                    showIf: { max_min_formula: true },
                },
                { name: "bar_color", type: "Color", label: "Bar color" },
                { name: "bg_color", type: "Color", label: "Background color" },
                { name: "px_height", type: "Integer", label: "Height in px" },
                { name: "radial", type: "Bool", label: "Radial" },
                {
                    name: "show_label",
                    type: "Bool",
                    label: "Show value",
                    showIf: { radial: true },
                },
              ],
              isEdit: false,
              description: "Show value as a percentage filled on a horizontal or radial progress bar",
              run: (v, req, attrs = {}) => {
                let max = attrs.max;
                let min = attrs.min;
                if (attrs.max_min_formula && attrs.min_formula)
                    min = eval_expression(attrs.min_formula, attrs.row || {}, req.user, "Progress bar min formula");
                if (attrs.max_min_formula && attrs.max_formula)
                    max = eval_expression(attrs.max_formula, attrs.row || {}, req.user, "Progress bar max formula");
                if (typeof v !== "number")
                    return "";
                const pcnt = Math.round((100 * (v - min)) / (max - min));
                if (attrs?.radial) {
                    const valShow = typeof v !== "number"
                        ? ""
                        : (attrs?.decimal_places
                            ? v.toFixed(attrs?.decimal_places)
                            : Math.round(v)) + (attrs.max == "100" ? `%` : "");
                    return (div({
                        class: [
                            "progress-bar progress-bar-radial",
                            `progress-bar-radial-${pcnt}`,
                        ],
                        style: {
                            height: `${attrs.px_height || 100}px`,
                            width: `${attrs.px_height || 100}px`,
                            borderRadius: "50%",
                            background: `radial-gradient(closest-side, white 79%, transparent 80% 100%),` +
                                `conic-gradient(${attrs.bar_color || "#0000ff"} ${pcnt}%, ${attrs.bg_color || "#777777"} 0);`,
                        },
                    }) +
                        (attrs.show_label === false
                            ? ""
                            : style(`.progress-bar-radial-${pcnt}::before { content: "${valShow}"; }`)));
                }
                else
                    return div({
                        class: "progress",
                        role: "progress-bar",
                        style: {
                            height: `${attrs.px_height || 8}px`,
                            backgroundColor: attrs.bg_color || "#777777",
                        },
                    }, div({
                        class: "progress-bar",
                        style: {
                            width: `${pcnt}%`,
                            height: `${attrs.px_height || 8}px`,
                            backgroundColor: attrs.bar_color || "#0000ff",
                        },
                    }));
              },
            },
            heat_cell: {
              configFields: (field) => [
                { name: "max_min_formula", type: "Bool", label: "Max/min Formula" },
                ...(!isdef(field.attributes.min)
                    ? [
                        {
                            name: "min",
                            label: "Min",
                            type,
                            required: true,
                            showIf: { max_min_formula: false },
                        },
                    ]
                    : []),
                ...(!isdef(field.attributes.max)
                    ? [
                        {
                            name: "max",
                            label: "Max",
                            type,
                            required: true,
                            showIf: { max_min_formula: false },
                        },
                    ]
                    : []),
                {
                    name: "min_formula",
                    label: "Min formula",
                    type: "String",
                    class: "validate-expression",
                    showIf: { max_min_formula: true },
                },
                {
                    name: "max_formula",
                    label: "Max formula",
                    type: "String",
                    class: "validate-expression",
                    showIf: { max_min_formula: true },
                },
                {
                    name: "color_scale",
                    type: "String",
                    label: "Color scale",
                    required: true,
                    attributes: { options: ["RedAmberGreen", "Rainbow", "WhiteToRed"] },
                },
                { name: "reverse", type: "Bool", label: "Reverse color scale" },
                { name: "em_height", type: "Integer", label: "Height in em", default: 1.5 },
              ],
              isEdit: false,
              description: "Set background color on according to value on a color scale",
              run: (v, req, attrs = {}) => {
                let max = attrs.max;
                let min = attrs.min;
                if (attrs.max_min_formula && attrs.min_formula)
                    min = eval_expression(attrs.min_formula, attrs.row || {}, req.user, "Heat cell min formula");
                if (attrs.max_min_formula && attrs.max_formula)
                    max = eval_expression(attrs.max_formula, attrs.row || {}, req.user, "Heat cell max formula");
                if (typeof v !== "number")
                    return "";
                const pcnt0 = (v - min) / (max - min);
                const pcnt = attrs.reverse ? 1 - pcnt0 : pcnt0;
                const colorMap = {
                    Rainbow: `hsl(${360 * pcnt},100%, 50%)`,
                    RedAmberGreen: `hsl(${100 * pcnt},100%, 50%)`,
                    WhiteToRed: `hsl(0,100%, ${100 * (1 - pcnt / 2)}%)`,
                };
                const backgroundColor = colorMap[attrs.color_scale];
                function getLuminance(hexColor) {
                    const r = parseInt(hexColor.substr(1, 2), 16) / 255;
                    const g = parseInt(hexColor.substr(3, 2), 16) / 255;
                    const b = parseInt(hexColor.substr(5, 2), 16) / 255;
                    const a = [r, g, b].map((v) => {
                        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                    });
                    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
                }
                function hslToHex(h, s, l) {
                    l /= 100;
                    const a = (s * Math.min(l, 1 - l)) / 100;
                    const f = (n) => {
                        const k = (n + h / 30) % 12;
                        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                        return Math.round(255 * color)
                            .toString(16)
                            .padStart(2, "0"); // convert to Hex and prefix "0" if needed
                    };
                    return `#${f(0)}${f(8)}${f(4)}`;
                }
                const [h, s, l] = backgroundColor.match(/\d+/g).map(Number);
                const hexColor = hslToHex(h, s, l);
                const luminance = getLuminance(hexColor);
                const textColor = luminance > 0.5 ? "#000000" : "#FFFFFF";
                return div({
                    class: "px-2",
                    style: {
                        width: "100%",
                        height: `${attrs.em_height || 1}em`,
                        backgroundColor,
                        color: textColor,
                    },
                }, text(v));
              },
            },
            above_input: {
              isEdit: false,
              isFilter: true,
              blockDisplay: true,
              configFields: [
                {
                  name: "stepper_btns",
                  label: "Stepper buttons",
                  type: "Bool",
                },
              ],
              run: (nm, v, attrs = {}, cls, required, field, state = {}) => {
                const onChange = `${attrs.preOnChange || ""}set_state_field('_${direction}_${nm}', this.value, this)`;
                return attrs?.stepper_btns
                    ? number_stepper(undefined, isdef(state[`_${direction}_${nm}`])
                        ? text_attr(state[`_${direction}_${nm}`])
                        : undefined, {
                        ...attrs,
                        onChange: `${attrs.preOnChange || ""}set_state_field('_${direction}_${nm}', $('#numlim_${nm}_${direction}').val(), this)`,
                    }, cls, undefined, `numlim_${nm}_${direction}`)
                    : input({
                        type: "number",
                        class: ["form-control", cls],
                        disabled: attrs.disabled,
                        readonly: attrs.readonly,
                        onChange,
                        step: 1,
                        ...(isdef(attrs.max) && { max: attrs.max }),
                        ...(isdef(attrs.min) && { min: attrs.min }),
                        ...(isdef(state[`_${direction}_${nm}`]) && {
                            value: text_attr(state[`_${direction}_${nm}`]),
                        }),
                    });
              },
            },
            below_input: {
              isEdit: false,
              isFilter: true,
              blockDisplay: true,
              configFields: [
                {
                  name: "stepper_btns",
                  label: "Stepper buttons",
                  type: "Bool",
                },
              ],
              run: (nm, v, attrs = {}, cls, required, field, state = {}) => {
                const onChange = `${attrs.preOnChange || ""}set_state_field('_${direction}_${nm}', this.value, this)`;
                return attrs?.stepper_btns
                    ? number_stepper(undefined, isdef(state[`_${direction}_${nm}`])
                        ? text_attr(state[`_${direction}_${nm}`])
                        : undefined, {
                        ...attrs,
                        onChange: `${attrs.preOnChange || ""}set_state_field('_${direction}_${nm}', $('#numlim_${nm}_${direction}').val(), this)`,
                    }, cls, undefined, `numlim_${nm}_${direction}`)
                    : input({
                        type: "number",
                        class: ["form-control", cls],
                        disabled: attrs.disabled,
                        readonly: attrs.readonly,
                        onChange,
                        step: 1,
                        ...(isdef(attrs.max) && { max: attrs.max }),
                        ...(isdef(attrs.min) && { min: attrs.min }),
                        ...(isdef(state[`_${direction}_${nm}`]) && {
                            value: text_attr(state[`_${direction}_${nm}`]),
                        }),
                    });
              },
            },
            show_with_html: {
              configFields: [
                {
                  input_type: "code",
                  name: "code",
                  label: "HTML",
                  sublabel: "Access the value with <code>{{ it }}</code>.",
                  default: "",
                  attributes: {
                    mode: "text/html",
                  },
                },
              ],
              isEdit: false,
              description: "Show value with any HTML code",
              run: (v, req, attrs = {}) => {
                const ctx = { ...getState().eval_context };
                ctx.it = v;
                const rendered = interpolate(attrs?.code, ctx, req?.user, "show_with_html code");
                return rendered;
              },
            },
            show_star_rating: {
              description: "Show value as filled stars out of maximum.",
              configFields: (field) => [
                ...(!isdef(field.attributes.min)
                    ? [{ name: "min", type: "Integer", required: true, default: 1 }]
                    : []),
                ...(!isdef(field.attributes.max)
                    ? [{ name: "max", type: "Integer", required: true, default: 5 }]
                    : []),
              ],
              isEdit: false,
              blockDisplay: true,
              run: (v, req, attrs = {}) => {
                return div({ style: "white-space: nowrap" }, Array.from({ length: +attrs.max - +attrs.min + 1 }, (_, i) => i + +attrs.min).map((starVal) => i({
                    class: "fas fa-star",
                    style: { color: starVal <= v ? "#ffc107" : "#ddd" },
                })));
              },
            },
            edit_star_rating: {
              description: "Input by clicking filled stars out of maximum.",
              configFields: (field) => [
                ...(!isdef(field.attributes.min)
                    ? [{ name: "min", type: "Integer", required: true, default: 1 }]
                    : []),
                ...(!isdef(field.attributes.max)
                    ? [{ name: "max", type: "Integer", required: true, default: 5 }]
                    : []),
                ...(!field.required
                    ? [
                        {
                            name: "force_required",
                            label: "Required",
                            sublabel: "User must select a value, even if the table field is not required",
                            type: "Bool",
                        },
                    ]
                    : []),
              ],
              isEdit: true,
              blockDisplay: true,
              run: (nm, v, attrs = {}, cls, required, field, state = {}) => {
                //https://codepen.io/pezmotion/pen/RQERdm
                return div({ class: "editStarRating" }, Array.from({ length: +attrs.max - +attrs.min + 1 }, (_, i) => +attrs.max - i).map((starVal) => input({
                    id: `input${text_attr(nm)}-${starVal}`,
                    type: "radio",
                    name: text_attr(nm),
                    value: starVal,
                    checked: v === starVal,
                    ...(required || attrs.force_required ? { required: true } : {}),
                }) +
                    label({ for: `input${text_attr(nm)}-${starVal}` }, i({ class: "fas fa-star" }))));
              },
            },
            to_locale_string: {
              description: "Show as in locale-sensitive representation",
              configFields: (field) => [
                {
                    type: "String",
                    name: "locale",
                    label: "Locale",
                    sublabel: "Blank for default user locale",
                },
                {
                    type: "String",
                    name: "style",
                    label: "Style",
                    required: true,
                    attributes: {
                        options: ["decimal", "currency", "percent", "unit"],
                    },
                },
                {
                    type: "Integer",
                    name: "maximumFractionDigits",
                    label: "Max Fraction Digits",
                    attributes: {
                        min: 0,
                    },
                },
                {
                    type: "Integer",
                    name: "maximumSignificantDigits",
                    label: "Max Significant Digits",
                    attributes: {
                        min: 0,
                    },
                },
                {
                    type: "String",
                    name: "currency",
                    label: "Currency",
                    sublabel: "ISO 4217. Example: USD or EUR",
                    required: true,
                    showIf: { style: "currency" },
                },
                {
                    type: "String",
                    name: "currencyDisplay",
                    label: "Currency display",
                    required: true,
                    showIf: { style: "currency" },
                    attributes: {
                        options: ["symbol", "code", "narrrowSymbol", "name"],
                    },
                },
                {
                    type: "String",
                    name: "unit",
                    label: "Unit",
                    required: true,
                    showIf: { style: "unit" },
                    attributes: {
                        options: [
                            "acre",
                            "bit",
                            "byte",
                            "celsius",
                            "centimeter",
                            "day",
                            "degree",
                            "fahrenheit",
                            "fluid-ounce",
                            "foot",
                            "gallon",
                            "gigabit",
                            "gigabyte",
                            "gram",
                            "hectare",
                            "hour",
                            "inch",
                            "kilobit",
                            "kilobyte",
                            "kilogram",
                            "kilometer",
                            "liter",
                            "megabit",
                            "megabyte",
                            "meter",
                            "microsecond",
                            "mile",
                            "mile-scandinavian",
                            "milliliter",
                            "millimeter",
                            "millisecond",
                            "minute",
                            "month",
                            "nanosecond",
                            "ounce",
                            "percent",
                            "petabyte",
                            "pound",
                            "second",
                            "stone",
                            "terabit",
                            "terabyte",
                            "week",
                            "yard",
                            "year",
                        ],
                    },
                },
                {
                    type: "String",
                    name: "unitDisplay",
                    label: "Unit display",
                    required: true,
                    showIf: { style: "unit" },
                    attributes: {
                        options: ["short", "narrow", "long"],
                    },
                },
              ],
              isEdit: false,
              run: (v, req, attrs = {}) => {
                const v1 = typeof v === "string" ? +v : v;
                if (typeof v1 === "number") {
                    const locale_ = attrs.locale || locale(req);
                    return v1.toLocaleString(locale_, {
                        style: attrs.style,
                        currency: attrs.currency,
                        currencyDisplay: attrs.currencyDisplay,
                        unit: attrs.unit,
                        unitDisplay: attrs.unitDisplay,
                        maximumSignificantDigits: attrs.maximumSignificantDigits === 0
                            ? 0
                            : attrs.maximumSignificantDigits || undefined,
                        maximumFractionDigits: attrs.maximumFractionDigits == 0
                            ? 0
                            : attrs.maximumFractionDigits || undefined,
                    });
                }
                else
                    return "";
              },
            },
            role_select: {
              isEdit: true,
              blockDisplay: true,
              description: "Select a user role",
              fill_options: async (field) => {
                const roles = await User.get_roles();
                field.options = roles;
              },
              run: (nm, v, attrs, cls, required, field) => {
                return select({
                    class: [
                        "form-control",
                        "form-select",
                        cls,
                        attrs.selectizable ? "selectizable" : false,
                    ],
                    name: text_attr(nm),
                    "data-fieldname": text_attr(field.name),
                    id: `input${text_attr(nm)}`,
                    disabled: attrs.disabled,
                    onChange: attrs.onChange,
                    onBlur: attrs.onChange,
                    autocomplete: "off",
                    required: true,
                }, field.options.map(({ id, role }) => option({ value: id, selected: v == id }, role)));
              },
            },
            select_by_code: {
              type: undefined,
              isEdit: true,
              blockDisplay: true,
              description: "Select by drop-down. Available options are set by code.",
              configFields: (field) => [
                {
                    name: "code",
                    label: "Code",
                    input_type: "code",
                    attributes: { mode: "application/javascript" },
                    class: "validate-statements",
                    sublabel: `Return array of: strings or <code>{ label: string, value: ${field.is_fkey ? "key-value" : field.type?.js_type || "any"} }</code>`,
                    validator(s) {
                        try {
                            let AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
                            AsyncFunction(s);
                            return true;
                        }
                        catch (e) {
                            return e.message;
                        }
                    },
                },
              ],
              // fill_options: async fill_options(field, force_allow_none, where0, extraCtx, optionsQuery, formFieldNames, user) {
              //   field.options = await eval_statements(field.attributes.code, {
              //       ...extraCtx,
              //       user,
              //       Table: table_1.default,
              //   });
              // },
              run: (nm, v, attrs, cls, reqd, field) => {
                const selOptions = select_options(v, field, (attrs || {}).force_required, (attrs || {}).neutral_label, false);
                return tags.select({
                    class: `form-control form-select ${cls} ${field.class || ""}`,
                    "data-fieldname": field.form_name,
                    name: text_attr(nm),
                    id: `input${text_attr(nm)}`,
                    disabled: attrs.disabled || attrs.disable,
                    readonly: attrs.readonly,
                    onChange: attrs.onChange,
                    autocomplete: "off",
                }, selOptions);
              },
            },
          },
          attributes: [
            {
              name: "min",
              label: "Minimum",
              type: "Integer",
              required: false,
            },
            {
              name: "max",
              label: "Maximum",
              type: "Integer",
              required: false,
            },
          ],
          validate_attributes: ({ min, max }) => !isdef(min) || !isdef(max) || max > min,
          read: (v) => {
            switch (typeof v) {
                case "number":
                    return Math.round(v);
                case "string":
                    if (v === "")
                        return undefined;
                    const parsed = +v;
                    return isNaN(parsed) ? undefined : parsed;
                default:
                    return undefined;
            }
          },
          validate: ({ min, max }) => (x) => {
            if (isdef(min) && x < min)
                return { error: `Must be ${min} or higher` };
            if (isdef(max) && x > max)
                return { error: `Must be ${max} or less` };
            return true;
          },
        },
        options: undefined,
        help: undefined,
        required: true,
        is_unique: true,
        hidden: false,
        disabled: false,
        calculated: false,
        primary_key: true,
        stored: false,
        expression: null,
        sourceURL: undefined,
        tab: undefined,
        is_fkey: false,
        input_type: "fromtype",
        attributes: {
        },
        table_id: 11,
        in_auto_save: undefined,
        exclude_from_mobile: undefined,
      },
      {
        refname: "",
        label: "Locale",
        name: "locale",
        fieldview: undefined,
        validator: () => true,
        showIf: undefined,
        parent_field: undefined,
        postText: undefined,
        class: "",
        id: 88,
        default: undefined,
        sublabel: undefined,
        description: null,
        type: {
          name: "String",
          description: "A sequence of unicode characters of any length.",
          sql_name: "text",
          js_type: "string",
          attributes: ({ table }) => {
            const strFields = table &&
                table.fields.filter((f) => (f.type || {}).name === "String" &&
                    !(f.attributes && f.attributes.localizes_field));
            const locales = Object.keys(getState().getConfig("localizer_languages", {}));
            return [
                {
                    name: "options",
                    label: "Options",
                    type: "String",
                    required: false,
                    copilot_description: 'Use this to restrict your field to a list of options (separated by commas). For instance, enter "Red, Green, Blue" here if the permissible values are Red, Green and Blue. Leave blank if the string can hold any value.',
                    sublabel: 'Use this to restrict your field to a list of options (separated by commas). For instance, enter <kbd class="fst-normal">Red, Green, Blue</kbd> here if the permissible values are Red, Green and Blue. Leave blank if the string can hold any value.',
                    attributes: { autofocus: true },
                },
                {
                    name: "min_length",
                    label: "Min length",
                    type: "Integer",
                    required: false,
                    sublabel: "The minimum number of characters in the string",
                    attributes: { asideNext: true },
                },
                {
                    name: "max_length",
                    label: "Max length",
                    type: "Integer",
                    required: false,
                    sublabel: "The maximum number of characters in the string",
                },
                {
                    name: "regexp",
                    type: "String",
                    label: "Regular expression",
                    required: false,
                    sublabel: "String value must match regular expression",
                    validator(s) {
                        if (!is_valid_regexp(s))
                            return "Not a valid Regular Expression";
                    },
                    attributes: { asideNext: true },
                },
                {
                    name: "re_invalid_error",
                    label: "Error message",
                    type: "String",
                    required: false,
                    sublabel: "Error message when regular expression does not match",
                },
                {
                    name: "exact_search_only",
                    label: "Exact search only",
                    type: "Bool",
                    sublabel: "Search only on exact match, not substring match. Useful for large tables",
                },
                ...(table
                    ? [
                        {
                            name: "localizes_field",
                            label: "Translation of",
                            sublabel: "This is a translation of a different field in a different language",
                            type: "String",
                            attributes: {
                                options: strFields.map((f) => f.name),
                            },
                        },
                        {
                            name: "locale",
                            label: "Locale",
                            sublabel: "Language locale of translation",
                            input_type: "select",
                            options: locales,
                            showIf: { localizes_field: strFields.map((f) => f.name) },
                        },
                    ]
                    : []),
            ];
          },
          contract: ({ options }) => typeof options === "string"
            ? is.one_of(options.split(","))
            : typeof options === "undefined"
                ? is.str
              : is.one_of(options.map((o) => (typeof o === "string" ? o : o.name))),
          fieldviews: {
            as_text: {
              isEdit: false,
              description: "Show the value with no other formatting",
              configFields: [
                {
                  name: "copy_to_clipbaord",
                  label: "Copy to clipboard",
                  type: "Bool",
                },
              ],
              run: (s, _req, attrs = {}) => attrs?.copy_to_clipbaord
                ? span({ class: "copy-to-clipboard" }, text_attr(s || ""))
              : text_attr(s || ""),
            },
            preFormatted: {
              isEdit: false,
              description: "Pre-formatted (in a &lt;pre&gt; tag)",
              run: (s) => s ? span({ style: "white-space:pre-wrap" }, text_attr(s || "")) : "",
            },
            code: {
              isEdit: false,
              description: "Show as a code block",
              run: (s) => (s ? pre(code(text_attr(s || ""))) : ""),
            },
            monospace_block: {
              isEdit: false,
              configFields: [
                {
                  name: "max_init_height",
                  label: "Max initial rows",
                  sublabel: "Only show this many rows until the user clicks",
                  type: "Integer",
                },
                {
                  name: "copy_btn",
                  label: "Copy button",
                  type: "Bool",
                },
              ],
              description: "Show as a monospace block",
              run: (s, _req, attrs = {}) => {
                if (!s)
                    return "";
                const copy_btn = attrs.copy_btn
                    ? button({
                        class: "btn btn-secondary btn-sm monospace-copy-btn m-1 d-none-prefer",
                        type: "button",
                        onclick: "copy_monospace_block(this)",
                    }, i({ class: "fas fa-copy" }))
                    : "";
                if (!attrs.max_init_height)
                    return (copy_btn +
                        pre({
                            class: "monospace-block",
                        }, s));
                const lines = s.split("\n");
                if (lines.length <= attrs.max_init_height)
                    return (copy_btn +
                        pre({
                            class: "monospace-block",
                        }, s));
                return (copy_btn +
                    pre({
                        class: "monospace-block",
                        onclick: `monospace_block_click(this)`,
                    }, lines.slice(0, attrs.max_init_height).join("\n") + "\n...") +
                    pre({ class: "d-none" }, s));
              },
            },
            ellipsize: {
              isEdit: false,
              configFields: [
                {
                  name: "nchars",
                  label: "Number of characters",
                  type: "Integer",
                  default: 20,
                },
              ],
              description: "Show First N characters of text followed by ... if truncated",
              run: (s, req, attrs = {}) => {
                if (!s || !s.length)
                    return "";
                if (s.length <= (attrs.nchars || 20))
                    return text_attr(s);
                return text_attr(s.substr(0, (attrs.nchars || 20) - 3)) + "...";
              },
            },
            as_link: {
              configFields: [
                {
                  name: "link_title",
                  label: "Link title",
                  type: "String",
                  sublabel: "Optional. If blank, label is URL",
                },
                {
                  name: "target_blank",
                  label: "Open in new tab",
                  type: "Bool",
                },
              ],
              description: "Show a link with the field value as the URL.",
              isEdit: false,
              run: (s, req, attrs = {}) => s
                ? a({
                    href: text(s || ""),
                    ...(attrs.target_blank ? { target: "_blank" } : {}),
                }, text_attr(attrs?.link_title || s || ""))
              : "",
            },
            img_from_url: {
              isEdit: false,
              description: "Show an image from the URL in the field value",
              run: (s, req, attrs) => img({ src: text(s || ""), style: "width:100%" }),
            },
            as_header: {
              isEdit: false,
              description: "Show this as a header",
              run: (s) => h3(text_attr(s || "")),
            },
            show_with_html: {
              configFields: [
                {
                  input_type: "code",
                  name: "code",
                  label: "HTML",
                  sublabel: "Access the value with <code>{{ it }}</code>.",
                  default: "",
                  attributes: {
                    mode: "text/html",
                  },
                },
              ],
              isEdit: false,
              description: "Show value with any HTML code",
              run: (v, req, attrs = {}) => {
                const ctx = { ...getState().eval_context };
                ctx.it = v;
                const rendered = interpolate(attrs?.code, ctx, req?.user, "show_with_html code");
                return rendered;
              },
            },
            edit: {
              isEdit: true,
              blockDisplay: true,
              description: "edit with a standard text input, or dropdown if field has options",
              configFields: (field) => [
                ...(field.attributes.options &&
                    field.attributes.options.length > 0 &&
                    !field.required
                    ? [
                        {
                            name: "neutral_label",
                            label: "Neutral label",
                            type: "String",
                        },
                        {
                            name: "force_required",
                            label: "Required",
                            sublabel: "User must select a value, even if the table field is not required",
                            type: "Bool",
                        },
                    ]
                    : []),
                ...(field.attributes.options && field.attributes.options.length > 0
                    ? [
                        {
                            name: "exclude_values",
                            label: "Exclude values",
                            sublabel: "Comma-separated list of value to exclude from the dropdown select",
                            type: "String",
                        },
                    ]
                    : []),
                {
                    name: "placeholder",
                    label: "Placeholder",
                    type: "String",
                },
                {
                    name: "input_type",
                    label: "Input type",
                    input_type: "select",
                    options: [
                        "text",
                        "email",
                        "url",
                        "tel",
                        "password",
                        "search",
                        "hidden",
                    ],
                },
                {
                    name: "autofocus",
                    label: "Autofocus",
                    type: "Bool",
                },
                {
                    name: "readonly",
                    label: "Read-only",
                    type: "Bool",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => attrs.options && (attrs.options.length > 0 || !required)
                ? attrs.readonly
                    ? input({
                        type: "text",
                        class: ["form-control", "form-select", cls],
                        name: attrs.isFilter ? undefined : text_attr(nm),
                        "data-fieldname": text_attr(field.name),
                        id: `input${text_attr(nm)}`,
                        onChange: attrs.onChange,
                        readonly: attrs.readonly,
                        value: v,
                    })
                    : select({
                        class: [
                            "form-control",
                            "form-select",
                            cls,
                            attrs.selectizable ? "selectizable" : false,
                        ],
                        name: attrs.isFilter ? undefined : text_attr(nm),
                        "data-fieldname": text_attr(field.name),
                        id: `input${text_attr(nm)}`,
                        disabled: attrs.disabled,
                        onChange: attrs.onChange,
                        onBlur: attrs.onChange,
                        autocomplete: "off",
                        "data-explainers": attrs.explainers
                            ? encodeURIComponent(JSON.stringify(attrs.explainers))
                            : undefined,
                        required: attrs.placeholder && (required || attrs.force_required),
                        ...(field.in_auto_save
                            ? {
                                "previous-val": v,
                                onFocus: "this.setAttribute('sc-received-focus', true);",
                            }
                            : {}),
                    }, attrs.placeholder && (required || attrs.force_required)
                        ? [
                            option({ value: "", disabled: true, selected: !v }, attrs.placeholder),
                            ...getStrOptions(v, attrs.options, attrs.exclude_values),
                        ]
                        : required || attrs.force_required
                            ? getStrOptions(v, attrs.options, attrs.exclude_values)
                            : [
                                option({ value: "" }, attrs.neutral_label || ""),
                                ...getStrOptions(v, attrs.options, attrs.exclude_values),
                            ])
                : attrs.options
                    ? none_available(required)
                    : attrs.calcOptions
                        ? select({
                            class: ["form-control", "form-select", cls],
                            name: attrs.isFilter ? undefined : text_attr(nm),
                            disabled: attrs.disabled,
                            "data-fieldname": text_attr(field.name),
                            id: `input${text_attr(nm)}`,
                            onChange: attrs.onChange,
                            onBlur: attrs.onChange,
                            autocomplete: "off",
                            "data-selected": v,
                            "data-calc-options": encodeURIComponent(JSON.stringify(attrs.calcOptions)),
                        }, option({ value: "" }, ""))
                        : input({
                            type: attrs.input_type || (attrs.isFilter ? "search" : "text"),
                            disabled: attrs.disabled,
                            readonly: attrs.readonly,
                            class: ["form-control", cls],
                            placeholder: attrs.placeholder,
                            onChange: attrs.onChange,
                            spellcheck: attrs.spellcheck === false ? "false" : undefined,
                            "data-fieldname": text_attr(field.name),
                            name: attrs.isFilter ? undefined : text_attr(nm),
                            required: !!(required || attrs.force_required),
                            maxlength: isdef(attrs.max_length) && attrs.max_length,
                            minlength: isdef(attrs.min_length) && attrs.min_length,
                            pattern: !!attrs.regexp && attrs.regexp,
                            autofocus: !!attrs.autofocus,
                            autocomplete: attrs.autocomplete || undefined,
                            title: !!attrs.re_invalid_error &&
                                !!attrs.regexp &&
                                attrs.re_invalid_error,
                            id: `input${text_attr(nm)}`,
                            ...(isdef(v) && { value: text_attr(v) }),
                      }),
            },
            fill_formula_btn: {
              isEdit: true,
              blockDisplay: true,
              description: "Input with a button prefills value from specified formula",
              configFields: [
                {
                  name: "formula",
                  label: "Formula",
                  type: "String",
                },
                {
                  name: "label",
                  label: "Button label",
                  type: "String",
                },
                {
                  name: "make_unique",
                  label: "Make unique after fill",
                  type: "Bool",
                },
                {
                  name: "include_space",
                  label: "Include space",
                  type: "Bool",
                  showIf: {
                    make_unique: true,
                  },
                },
                {
                  name: "start_from",
                  label: "Start from",
                  type: "Integer",
                  default: 0,
                  showIf: {
                    make_unique: true,
                  },
                },
                {
                  name: "always_append",
                  label: "Always append",
                  type: "Bool",
                  showIf: {
                    make_unique: true,
                  },
                },
                {
                  name: "char_type",
                  label: "Append character type",
                  input_type: "select",
                  options: [
                    "Digits",
                    "Lowercase Letters",
                    "Uppercase Letters",
                  ],
                  showIf: {
                    make_unique: true,
                  },
                },
              ],
              run: (nm, v, attrs, cls, required, field) => div({ class: "input-group" }, input({
                type: attrs.input_type || "text",
                disabled: attrs.disabled,
                readonly: attrs.readonly,
                class: ["form-control", cls],
                placeholder: attrs.placeholder,
                onChange: attrs.onChange,
                "data-fieldname": text_attr(field.name),
                name: text_attr(nm),
                id: `input${text_attr(nm)}`,
                ...(isdef(v) && { value: text_attr(v) }),
                }), button({
                class: "btn btn-secondary",
                type: "button",
                "data-formula": encodeURIComponent(attrs?.formula),
                "data-formula-free-vars": encodeURIComponent(JSON.stringify(join_fields_in_formula(attrs?.formula))),
                "data-formula-table": encodeURIComponent(JSON.stringify(Table.findOne(field.table_id).to_json)),
                onClick: "fill_formula_btn_click(this" +
                    (attrs.make_unique
                        ? `,()=>make_unique_field('input${text_attr(nm)}', ${field.table_id}, '${field.name}',  $('#input${text_attr(nm)}'), ${!!attrs.include_space}, ${attrs.start_from || 0}, ${!!attrs.always_append}, '${attrs.char_type}')`
                        : "") +
                    ")",
              }, attrs?.label || "Fill")),
            },
            make_unique: {
              isEdit: true,
              blockDisplay: true,
              description: "Make this input unique in the database table",
              configFields: [
                {
                  name: "placeholder",
                  label: "Placeholder",
                  type: "String",
                },
                {
                  name: "input_type",
                  label: "Input type",
                  input_type: "select",
                  options: [
                    "text",
                    "email",
                    "url",
                    "tel",
                    "password",
                  ],
                },
                {
                  name: "include_space",
                  label: "Include space",
                  type: "Bool",
                },
                {
                  name: "start_from",
                  label: "Start from",
                  type: "Integer",
                  default: 0,
                },
                {
                  name: "always_append",
                  label: "Always append",
                  type: "Bool",
                },
                {
                  name: "char_type",
                  label: "Append character type",
                  input_type: "select",
                  options: [
                    "Digits",
                    "Lowercase Letters",
                    "Uppercase Letters",
                  ],
                },
              ],
              run: (nm, v, attrs, cls, required, field) => input({
                type: attrs.input_type || "text",
                disabled: attrs.disabled,
                readonly: attrs.readonly,
                class: ["form-control", cls],
                placeholder: attrs.placeholder,
                onChange: attrs.onChange,
                "data-fieldname": text_attr(field.name),
                name: text_attr(nm),
                id: `input${text_attr(nm)}`,
                ...(isdef(v) && { value: text_attr(v) }),
                }) +
              script(domReady(`make_unique_field('input${text_attr(nm)}', ${field.table_id}, '${field.name}', $('#input${text_attr(nm)}'), ${attrs.include_space}, ${attrs.start_from}, ${attrs.always_append}, ${JSON.stringify(attrs.char_type)})`)),
            },
            textarea: {
              isEdit: true,
              blockDisplay: true,
              description: "Edit as a text area (multi line input)",
              configFields: [
                {
                  type: "Bool",
                  name: "spellcheck",
                  label: "Spellcheck",
                },
                {
                  type: "Integer",
                  name: "rows",
                  label: "Rows",
                },
                {
                  name: "placeholder",
                  label: "Placeholder",
                  type: "String",
                },
                {
                  name: "unsafe",
                  label: "Disable escaping",
                  sublabel: "Do not escape unsafe HTML fragments",
                  type: "String",
                },
                {
                  type: "Bool",
                  name: "monospace",
                  label: "Monospace",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => textarea({
                class: ["form-control", cls, attrs.monospace && "font-monospace"],
                name: text_attr(nm),
                "data-fieldname": text_attr(field.name),
                disabled: attrs.disabled,
                onChange: attrs.onChange,
                readonly: attrs.readonly,
                placeholder: attrs.placeholder,
                spellcheck: attrs.spellcheck === false ? "false" : undefined,
                required: !!required,
                maxlength: isdef(attrs.max_length) && attrs.max_length,
                minlength: isdef(attrs.min_length) && attrs.min_length,
                id: `input${text_attr(nm)}`,
                rows: attrs.rows || 5,
              }, attrs.unsafe ? v || "" : text(v) || ""),
            },
            code_editor: {
              isEdit: true,
              blockDisplay: true,
              description: "Edit as code",
              configFields: [
                {
                  type: "String",
                  name: "mode",
                  label: "mode",
                  required: true,
                  attributes: {
                    options: [
                      "application/javascript",
                      "text/html",
                      "text/css",
                      "text/x-sql",
                    ],
                  },
                },
              ],
              run: (nm, v, attrs, cls, required, field) => textarea({
                class: ["form-control", "to-code", cls],
                name: text_attr(nm),
                "data-fieldname": text_attr(field.name),
                disabled: attrs.disabled,
                onChange: attrs.onChange,
                readonly: attrs.readonly,
                placeholder: attrs.placeholder,
                spellcheck: "false",
                required: !!required,
                maxlength: isdef(attrs.max_length) && attrs.max_length,
                minlength: isdef(attrs.min_length) && attrs.min_length,
                id: `input${text_attr(nm)}`,
                mode: attrs.mode,
              }, text(v) || ""),
            },
            radio_group: {
              isEdit: true,
              configFields: [
                {
                  type: "Bool",
                  name: "inline",
                  label: "Inline",
                },
              ],
              description: "Pick from a radio group. Field must have options",
              run: (nm, v, attrs, cls, required, field) => attrs.options
                ? radio_group({
                    class: cls,
                    name: text_attr(nm),
                    disabled: attrs.disabled,
                    inline: attrs.inline,
                    onChange: attrs.onChange,
                    required: !!required,
                    options: Array.isArray(attrs.options)
                        ? attrs.options
                        : attrs.options.split(",").map((o) => o.trim()),
                    value: v,
                })
              : none_available(required),
            },
            checkbox_group: {
              isEdit: false,
              isFilter: true,
              description: "Filter from a checkbox group. Field must have options. Possible selections are treated as OR.",
              configFields: [
                {
                  type: "Bool",
                  name: "inline",
                  label: "Inline",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => attrs && attrs.options
                ? checkbox_group({
                    class: cls,
                    name: text_attr(nm),
                    disabled: attrs.disabled,
                    inline: attrs.inline,
                    options: Array.isArray(attrs.options)
                        ? attrs.options
                        : attrs.options.split(",").map((o) => o.trim()),
                    value: v,
                })
              : i("None available"),
            },
            password: {
              isEdit: true,
              configFields: [
                {
                  name: "visibility_toggle",
                  label: "Visibility toggle",
                  type: "Bool",
                },
                {
                  name: "autocomplete",
                  label: "Autocomplete",
                  type: "String",
                  attributes: {
                    options: [
                      "on",
                      "off",
                      "current-password",
                      "new-password",
                    ],
                  },
                },
              ],
              blockDisplay: true,
              description: "Password input type, characters are hidden when typed",
              run: (nm, v, attrs, cls, required, field) => {
                const pwinput = input({
                    type: "password",
                    disabled: attrs.disabled,
                    readonly: attrs.readonly,
                    class: ["form-control", cls],
                    "data-fieldname": text_attr(field.name),
                    onChange: attrs.onChange,
                    name: text_attr(nm),
                    id: `input${text_attr(nm)}`,
                    ...(isdef(v) && { value: text_attr(v) }),
                    autocomplete: attrs?.autocomplete === false
                        ? "off"
                        : attrs?.autocomplete || undefined,
                });
                if (attrs?.visibility_toggle)
                    return div({ class: "input-group" }, pwinput, span({ class: "input-group-text toggle-password-vis" }, i({ class: "fas fa-eye toggle-password-vis-icon" })));
                else
                    return pwinput;
              },
            },
            select_by_code: {
              type: undefined,
              isEdit: true,
              blockDisplay: true,
              description: "Select by drop-down. Available options are set by code.",
              configFields: (field) => [
                {
                    name: "code",
                    label: "Code",
                    input_type: "code",
                    attributes: { mode: "application/javascript" },
                    class: "validate-statements",
                    sublabel: `Return array of: strings or <code>{ label: string, value: ${field.is_fkey ? "key-value" : field.type?.js_type || "any"} }</code>`,
                    validator(s) {
                        try {
                            let AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
                            AsyncFunction(s);
                            return true;
                        }
                        catch (e) {
                            return e.message;
                        }
                    },
                },
              ],
              // fill_options: async fill_options(field, force_allow_none, where0, extraCtx, optionsQuery, formFieldNames, user) {
              //   field.options = await eval_statements(field.attributes.code, {
              //       ...extraCtx,
              //       user,
              //       Table: table_1.default,
              //   });
              // },
              run: (nm, v, attrs, cls, reqd, field) => {
                const selOptions = select_options(v, field, (attrs || {}).force_required, (attrs || {}).neutral_label, false);
                return tags.select({
                    class: `form-control form-select ${cls} ${field.class || ""}`,
                    "data-fieldname": field.form_name,
                    name: text_attr(nm),
                    id: `input${text_attr(nm)}`,
                    disabled: attrs.disabled || attrs.disable,
                    readonly: attrs.readonly,
                    onChange: attrs.onChange,
                    autocomplete: "off",
                }, selOptions);
              },
            },
          },
          read: (v) => {
            switch (typeof v) {
                case "string":
                    //PG dislikes null bytes
                    return v.replace(/\0/g, "");
                default:
                    return undefined;
            }
          },
          presets: {
            IP: ({ req }) => req.ip,
            SessionID: ({ req }) => req.sessionID || req.cookies["express:sess"],
          },
          validate: ({ min_length, max_length, regexp, re_invalid_error }) => (x) => {
            if (!x || typeof x !== "string")
                return true; //{ error: "Not a string" };
            if (isdef(min_length) && x.length < min_length)
                return { error: `Must be at least ${min_length} characters` };
            if (isdef(max_length) && x.length > max_length)
                return { error: `Must be at most ${max_length} characters` };
            if (isdef(regexp) && !new RegExp(regexp).test(x))
                return {
                    error: re_invalid_error || `Does not match regular expression`,
                };
            return true;
          },
          validate_attributes: ({ min_length, max_length, regexp }) => (!isdef(min_length) || !isdef(max_length) || max_length >= min_length) &&
          (!isdef(regexp) || is_valid_regexp(regexp)),
        },
        options: undefined,
        help: undefined,
        required: false,
        is_unique: false,
        hidden: false,
        disabled: false,
        calculated: false,
        primary_key: false,
        stored: false,
        expression: "",
        sourceURL: undefined,
        tab: undefined,
        is_fkey: false,
        input_type: "fromtype",
        attributes: {
          regexp: "",
          options: "",
          importance: 5,
          max_length: 16,
          min_length: 0,
          re_invalid_error: "",
          exact_search_only: false,
        },
        table_id: 11,
        in_auto_save: undefined,
        exclude_from_mobile: undefined,
      },
      {
        refname: "",
        label: "Notification preferences",
        name: "notification_prefs",
        fieldview: undefined,
        validator: () => true,
        showIf: undefined,
        parent_field: undefined,
        postText: undefined,
        class: "",
        id: 86,
        default: undefined,
        sublabel: undefined,
        description: null,
        type: {
          name: "JSON",
          sql_name: "jsonb",
          fieldviews: {
            show: {
              isEdit: false,
              run: (v) => pre({ class: "wsprewrap" }, code(JSON.stringify(v))),
            },
            subfield: {
              isEdit: false,
              configFields: (field) => {
                const { hasSchema, schemaKeys } = getSchemaMap(field.attributes);
                
                return hasSchema
                  ? [
                      {
                        name: "key",
                        label: "Key",
                        type: "String",
                        required: true,
                        attributes: { options: ["", ...schemaKeys] },
                      },
                    ]
                  : [
                      {
                        name: "key",
                        label: "Key",
                        type: "String",
                      },
                    ];
              },
              run: (v, req, options) => {
                const { hasSchema, schemaMap } = getSchemaMap(options);
                const k = options && options.key;
                
                if (k && v && typeof v[options.key] !== "undefined")
                  return (
                    showVal(hasSchema, schemaMap, k, v[k]) + showUnits(schemaMap, k)
                  );
                else return "";
              },
            },
            edit_subfield: {
              isEdit: true,
              configFields: (field) => {
                const { hasSchema, schemaKeys } = getSchemaMap(field.attributes);
                return hasSchema
                  ? [
                      {
                        name: "key",
                        label: "Key",
                        type: "String",
                        required: true,
                        attributes: { options: ["", ...schemaKeys] },
                      },
                    ]
                  : [
                      {
                        name: "key",
                        label: "Key",
                        type: "String",
                      },
                    ];
              },
              run: (nm, v, attrs, cls, required, field) => {
                const { hasSchema, schemaMap } = getSchemaMap(attrs);
                const k = attrs.key;
                return (
                  script(
                    domReady(
                      `initJsonSubfieldEdit(${JSON.stringify(nm)}, ${JSON.stringify(
                        v
                      )}, ${JSON.stringify(k)})`
                    )
                  ) +
                  (hasSchema && schemaMap[k]?.options
                    ? select(
                        {
                          class: `json_subfield_edit_${validID(nm)}`,
                          "data-subfield": encode(attrs.key),
                          id: `json_subfield_${validID(nm)}_${validID(attrs.key)}`,
                          onChange: `jsonSubfieldEdit('${encode(nm)}', '${encode(
                            attrs.key
                          )}', this)`,
                          value: v ? v[k] || "" : "",
                        },
                        option({ selected: !v?.[k] }, ""),
                        schemaMap[k].options
                          .split(",")
                          .map((o) =>
                            option({ selected: v?.[attrs.key] === o.trim() }, o.trim())
                          )
                      )
                    : hasSchema &&
                      (schemaMap[attrs.key]?.type || "").startsWith("Key to")
                    ? select({
                        class: `json_subfield_edit_${validID(nm)} json_fkey_field`,
                        "data-subfield": encode(k),
                        id: `json_subfield_${validID(nm)}_${validID(k)}`,
                        onChange: `jsonSubfieldEdit('${encode(nm)}', '${encode(
                          k
                        )}', this)`,
                        value: v ? v[k] || "" : "",
                        "data-selected": v ? v[k] || "" : "",
                        "data-fetch-options": encodeURIComponent(
                          JSON.stringify({
                            table: schemaMap[k].type.replace("Key to ", ""),
                            summary_field: schemaMap[k].summary_field,
                            refname: "id",
                            whereParsed: {},
                          })
                        ),
                      })
                    : input({
                        type:
                          hasSchema && schemaMap[attrs.key]?.type === "Bool"
                            ? "checkbox"
                            : hasSchema &&
                              ["Integer", "Float"].includes(schemaMap[attrs.key]?.type)
                            ? "number"
                            : "text",
                        class: `json_subfield_edit_${validID(nm)}`,
                        "data-subfield": encode(attrs.key),
                        id: `json_subfield_${validID(nm)}_${validID(attrs.key)}`,
                        onChange: `jsonSubfieldEdit('${encode(nm)}', '${encode(
                          attrs.key
                        )}', this)`,
                        step:
                          hasSchema && schemaMap[attrs.key]?.type === "Float"
                            ? "any"
                            : false,
                        value: v ? v[attrs.key] || "" : "",
                        checked:
                          hasSchema &&
                          schemaMap[attrs.key]?.type === "Bool" &&
                          v &&
                          v[attrs.key],
                      })) +
                  showUnits(schemaMap, attrs.key)
                );
              },
            },
            pretty: {
              isEdit: false,
              run: (v) => pre({ class: "wsprewrap" }, code(JSON.stringify(v, null, 2))),
            },
            show_table: {
              isEdit: false,
              configFields: (field) => {
                const { hasSchema, schemaKeys } = getSchemaMap(field.attributes);
                return hasSchema
                  ? [
                      {
                        name: "include_keys",
                        label: "Keys",
                        sublabel: "Comma separated. Leave blank for all keys.",
                        type: "String",
                      },
                    ]
                  : [];
              },
              run: (v, req, options) => {
                const { hasSchema, schemaMap } = getSchemaMap(options);
                const ok_keys = options?.include_keys
                  ? new Set(options.include_keys.split(",").map((s) => s.trim()))
                  : null;
                const key_filter = options?.include_keys
                  ? ([k, v]) => ok_keys.has(k)
                  : (kv) => true;
                return typeof v !== "object" || !v
                  ? ""
                  : table(
                      { class: "table table-sm" },
                      Object.entries(v)
                        .filter(key_filter)
                        .map(([k, v]) =>
                          tr(
                            th(k),
                            td(
                              v === false
                                ? "false"
                                : showVal(hasSchema, schemaMap, k, v) +
                                    showUnits(schemaMap, k)
                            )
                          )
                        )
                    );
              },
            },
            edit: {
              isEdit: true,
              run: (nm, v, attrs, cls) =>
                textarea(
                  {
                    class: ["form-control", cls],
                    name: encodeURIComponent(nm),
                    id: `input${encodeURIComponent(nm)}`,
                    rows: 10,
                  },
                  typeof v === "undefined" ? "" : text(JSON.stringify(v)) || ""
              ),
            },
            edit_table: {
              isEdit: true,
              configFields: (field) => {
                const { hasSchema, schemaKeys } = getSchemaMap(field.attributes);
                return hasSchema
                  ? [
                      {
                        name: "all_keys",
                        label: "All keys",
                        type: "Bool",
                      },
                    ]
                  : [];
              },
              run: (nm, v, attrs, cls) => {
                //console.log(attrs);
                const { hasSchema, schemaMap, schemaKeys } = getSchemaMap(attrs);
                const rndid = Math.floor(Math.random() * 16777215).toString(16);
                const valueInput = (k, val) =>
                  schemaMap[k]?.type === "Bool"
                    ? input({
                        type: "checkbox",
                        class: "json_value",
                        onChange: `jsonTableEdit('${encode(nm)}', '${rndid}')`,
                        checked: val,
                      })
                    : schemaMap[k]?.type === "Calculation"
                    ? input({
                        type: "text",
                        class: "json_calculation",
                        "data-key": k,
                        "data-formula": encodeURIComponent(schemaMap[k].formula),
                        value: val,
                        readonly: true,
                      })
                    : (schemaMap[k]?.type || "").startsWith("Key to ")
                    ? select({
                        class: "json_value json_fkey_field",
                        onChange: `jsonTableEdit('${encode(nm)}', '${rndid}')`,
                        value: val,
                        "data-selected": val,
                        "data-fetch-options": encodeURIComponent(
                          JSON.stringify({
                            table: schemaMap[k].type.replace("Key to ", ""),
                            summary_field: schemaMap[k].summary_field,
                            refname: "id",
                            whereParsed: {},
                          })
                        ),
                      })
                    : schemaMap[k]?.options
                    ? select(
                        {
                          class: "json_value",
                          onChange: `jsonTableEdit('${encode(nm)}', '${rndid}')`,
                          value: val,
                        },
                        option({ selected: !val }, ""),
                        schemaMap[k].options
                          .split(",")
                          .map((o) => option({ selected: val === o.trim() }, o.trim()))
                      )
                    : schemaMap[k]?.type === "Integer" || schemaMap[k]?.type === "Float"
                    ? input({
                        type: "number",
                        class: "json_value",
                        onChange: `jsonTableEdit('${encode(nm)}', '${rndid}')`,
                        step:
                          hasSchema && schemaMap[k]?.type === "Float" ? "any" : false,
                        value: val,
                      }) + showUnits(schemaMap, k)
                    : input({
                        type: "text",
                        class: "json_value",
                        onChange: `jsonTableEdit('${encode(nm)}', '${rndid}')`,
                        value: val,
                      }) + showUnits(schemaMap, k);
                return (
                  script(
                    domReady(
                      `initJsonTableEdit(${JSON.stringify(
                        nm
                      )}, '${rndid}', ${JSON.stringify(v)})`
                    )
                  ) +
                  table(
                    {
                      class: `table table-sm json-table-edit table-edit-${validID(nm)}`,
                      id: `table-edit-${validID(nm)}-${rndid}`,
                      "data-schema-map": hasSchema
                        ? encodeURIComponent(JSON.stringify(schemaMap))
                        : undefined,
                    },
                    hasSchema && attrs.all_keys
                      ? [...new Set([...schemaKeys, ...Object.keys(v || {})])].map(
                          (k) => tr(th(k), td(valueInput(k, (v || {})[k])))
                        )
                      : Object.entries(v || {}).map(([k, v]) =>
                          tr(
                            td(
                              hasSchema
                                ? select(
                                    {
                                      class: "json_key",
                                      onChange: `jsonTableEdit('${encodeURIComponent(
                                        nm
                                      )}', '${rndid}')`,
                                    },
                                    attrs.schema.map(({ key }) =>
                                      option({ selected: key === k }, key)
                                    ),
                                    attrs.allowUserDefined &&
                                      option(
                                        { selected: !schemaKeys.includes(k) },
                                        "Other..."
                                      )
                                  ) +
                                    (attrs.allowUserDefined
                                      ? input({
                                          type: schemaKeys.includes(k)
                                            ? "hidden"
                                            : "text",
                                          class: "json_key_other d-block",
                                          onChange: `jsonTableEdit('${encode(
                                            nm
                                          )}', '${rndid}')`,
                                          value: k,
                                        })
                                      : "")
                                : input({
                                    type: "text",
                                    class: "json_key",
                                    onChange: `jsonTableEdit('${encode(
                                      nm
                                    )}', '${rndid}')`,
                                    value: k,
                                  })
                            ),
                            td(valueInput(k, v)),
                            td(
                              i({
                                class: "fas fa-times",
                                onClick: `jsonTableDeleteRow('${encode(
                                  nm
                                )}','${rndid}', this)`,
                              })
                            )
                          )
                        )
                  ) +
                  (hasSchema && attrs.all_keys && !attrs.allowUserDefined
                    ? ""
                    : button(
                        {
                          class: "btn btn-primary btn-sm",
                          type: "button",
                          onClick: `jsonTableAddRow('${encode(nm)}', '${rndid}')`,
                        },
                        "Add entry"
                      ))
                );
              },
            },
            keys_expand_columns: {
              isEdit: false,
              configFields: (field) => {
                const { hasSchema, schemaKeys } = getSchemaMap(field.attributes);
                
                return hasSchema
                  ? [
                      {
                        name: "_all_keys",
                        label: "All keys",
                        type: "Bool",
                        default: true,
                      },
                      ...schemaKeys.map((k) => ({
                        name: k,
                        label: k,
                        type: "Bool",
                      })),
                    ]
                  : [
                      {
                        name: "keys",
                        label: "Keys",
                        type: "String",
                        sublabel: "Separate keys by commas",
                      },
                    ];
              },
              expandColumns: (field, attributes, column) => {
                const { hasSchema, schemaKeys, schemaMap } = getSchemaMap(
                  field.attributes
                );
                let field_name = column.field_name;
                
                if (!field_name && column.join_field) {
                  const path = column.join_field.split(".");
                  field_name = path.join("_");
                }
                
                const getCol = (k) => ({
                  label: column.header_label ? `${column.header_label} ${k}` : k,
                  row_key: [field_name, k],
                  key: (r) =>
                    field_name && typeof r[field_name]?.[k] !== "undefined"
                      ? showVal(hasSchema, schemaMap, k, r[field_name]?.[k])
                      : "",
                });
                const ok_keys =
                  hasSchema &&
                  schemaKeys.filter((k) => attributes._all_keys || attributes[k]);
                return hasSchema
                  ? (ok_keys.length === 0 ? schemaKeys : ok_keys).map(getCol)
                  : (attributes.keys || "")
                      .split()
                      .map((s) => s.trim())
                      .map(getCol);
              },
              run: (v, req, options) => {
                const { schemaMap } = getSchemaMap(options);
                if (
                  options &&
                  options.key &&
                  v &&
                  typeof v[options.key] !== "undefined"
                )
                  return text_attr(v[options.key]) + showUnits(schemaMap, options.key);
                else return "";
              },
            },
            jsonRangeFilter: {
              configFields: (field) => {
                const { hasSchema, schemaKeys } = getSchemaMap(field.attributes);
                return [
                  {
                    name: "key",
                    label: "Key",
                    type: "String",
                    required: true,
                    attributes: schemaKeys
                      ? { options: ["", ...schemaKeys] }
                      : undefined,
                  },
                  { name: "min", type: "Float", required: false },
                  { name: "max", type: "Float", required: false },
                ];
              },
              isEdit: false,
              isFilter: true,
              blockDisplay: true,
              run: (nm, v, attrs = {}, cls, required, field, state = {}) => {
                const stateKeyLte = encodeURIComponent(
                  `${nm}[${attrs.key}__lte]`
                );
                const stateKeyGte = encodeURIComponent(
                  `${nm}[${attrs.key}__gte]`
                );
                const stateValueLte = state[nm]?.[`${attrs.key}__lte`];
                const stateValueGte = state[nm]?.[`${attrs.key}__gte`];
                return section(
                  { class: ["range-slider", cls] },
                  span({ class: "rangeValues" }),
                  input({
                    ...(isdef(stateValueGte)
                      ? {
                          value: text_attr(stateValueGte),
                        }
                      : isdef(attrs.min)
                      ? { value: text_attr(attrs.min) }
                      : {}),
                    ...(isdef(attrs.max) && { max: attrs.max }),
                    ...(isdef(attrs.min) && { min: attrs.min }),
                    type: "range",
                    disabled: attrs.disabled,
                    onChange: `set_state_field('${stateKeyGte}', this.value)`,
                  }),
                  input({
                    ...(isdef(stateValueLte)
                      ? {
                          value: text_attr(stateValueLte),
                        }
                      : isdef(attrs.max)
                      ? { value: text_attr(attrs.max) }
                      : {}),
                    ...(isdef(attrs.max) && { max: attrs.max }),
                    ...(isdef(attrs.min) && { min: attrs.min }),
                    type: "range",
                    disabled: attrs.disabled,
                    onChange: `set_state_field('${stateKeyLte}', this.value)`,
                  })
                );
              },
            },
            jsonFilter: {
              isEdit: false,
              isFilter: true,
              configFields: (field) => {
                const { hasSchema, schemaKeys } = getSchemaMap(field.attributes);
                return hasSchema
                  ? [
                      {
                        name: "key",
                        label: "Key",
                        type: "String",
                        required: true,
                        attributes: { options: ["", ...schemaKeys] },
                      },
                    ]
                  : [
                      {
                        name: "key",
                        label: "Key",
                        type: "String",
                      },
                    ];
              },
              run: (nm, v, attrs, cls, required, field, state = {}) => {
                const { hasSchema, schemaMap } = getSchemaMap(attrs);
                const stateKey = encodeURIComponent(`${nm}[${attrs.key}]`);
                const stateValue = state[nm]?.[attrs.key];
                return (
                  input({
                    type:
                      hasSchema && schemaMap[attrs.key]?.type === "Bool"
                        ? "checkbox"
                        : "text",
                    onChange: `set_state_field('${stateKey}', this.value)`,
                    value: stateValue || "",
                    checked:
                      (hasSchema &&
                        schemaMap[attrs.key]?.type === "Bool" &&
                        stateKey) ||
                      false,
                  }) + showUnits(schemaMap, attrs.key)
                );
              },
            },
            show_with_html: {
              configFields: [
                {
                  input_type: "code",
                  name: "code",
                  label: "HTML",
                  sublabel: "Access the value with <code>{{ it }}</code>.",
                  default: "",
                  attributes: {
                    mode: "text/html",
                  },
                },
              ],
              isEdit: false,
              description: "Show value with any HTML code",
              run: (v, req, attrs = {}) => {
                const rendered = interpolate(attrs?.code, { it: v }, req?.user);
                return rendered;
              },
            },
          },
          attributes: () => {
            const tables = getState().tables;
            const typeOpts = [
              "String",
              "Integer",
              "Float",
              "Bool",
              "Calculation",
            ];
            const fkeyOptions = [];
            const sumFieldOptions = {};
            tables.forEach((t) => {
              typeOpts.push(`Key to ${t.name}`);
              fkeyOptions.push(`Key to ${t.name}`);
              sumFieldOptions[`Key to ${t.name}`] = t.fields.map((f) => f.name);
            });
            return [
              { name: "hasSchema", label: "Has Schema", type: "Bool" },
              {
                name: "allowUserDefined",
                label: "Allow new keys",
                type: "Bool",
                showIf: { hasSchema: true },
                sublabel:
                  "Allow the user to enter a new key that is not in the schema",
              },
              new FieldRepeat({
                name: "schema",
                label: "Schema",
                showIf: { hasSchema: true },
                fields: [
                  { name: "key", label: "Key", type: "String" },
                  {
                    name: "type",
                    label: "Type",
                    type: "String",
                    required: true,
                    attributes: { options: typeOpts },
                  },
                  {
                    name: "formula",
                    label: "Formula",
                    class: "validate-expression",
                    type: "String",
                    showIf: { type: "Calculation" },
                  },
                  {
                    name: "summary_field",
                    label: "Summary field",
                    type: "String",
                    showIf: { type: fkeyOptions },
                    attributes: {
                      calcOptions: ["type", sumFieldOptions],
                    },
                  },
                  {
                    name: "units",
                    label: "Units",
                    type: "String",
                    showIf: { type: "Float" },
                  },
                  {
                    name: "options",
                    label: "Options",
                    type: "String",
                    required: false,
                    sublabel:
                      'Use this to restrict your field to a list of options (separated by commas). For instance, if the permissible values are "Red", "Green" and "Blue", enter "Red, Green, Blue" here. Leave blank if the string can hold any value.',
                    showIf: { type: "String" },
                  },
                ],
              }),
            ];
          },
          read: (v, attrs) => {
            const alignSchema = (o) => {
              if (!attrs || !attrs.hasSchema || !o) return o;
              (attrs.schema || []).map(({ key, type }) => {
                if (key in o)
                  switch (type) {
                    case "Integer":
                      o[key] = Math.round(+o[key]);
                      break;
                    case "Float":
                      o[key] = +o[key];
                      break;
                    case "Bool":
                      if (o[key] === "false") o[key] = false;
                      else o[key] = !!o[key];
                      break;
                    default:
                      break;
                  }
              });
              return o;
            };
            switch (typeof v) {
              case "string":
                try {
                  return alignSchema(JSON.parse(v));
                } catch {
                  return v;
                }
              default:
                return alignSchema(v);
            }
          },
        },
        options: undefined,
        help: undefined,
        required: false,
        is_unique: false,
        hidden: false,
        disabled: false,
        calculated: false,
        primary_key: false,
        stored: false,
        expression: "",
        sourceURL: undefined,
        tab: undefined,
        is_fkey: false,
        input_type: "fromtype",
        attributes: {
          schema: [
          ],
          hasSchema: false,
          importance: 7,
          allowUserDefined: true,
        },
        table_id: 11,
        in_auto_save: undefined,
        exclude_from_mobile: undefined,
      },
      {
        refname: "",
        label: "Preferred units",
        name: "preferred_units",
        fieldview: undefined,
        validator: () => true,
        showIf: undefined,
        parent_field: undefined,
        postText: undefined,
        class: "",
        id: 85,
        default: undefined,
        sublabel: undefined,
        description: null,
        type: {
          name: "String",
          description: "A sequence of unicode characters of any length.",
          sql_name: "text",
          js_type: "string",
          attributes: ({ table }) => {
            const strFields = table &&
                table.fields.filter((f) => (f.type || {}).name === "String" &&
                    !(f.attributes && f.attributes.localizes_field));
            const locales = Object.keys(getState().getConfig("localizer_languages", {}));
            return [
                {
                    name: "options",
                    label: "Options",
                    type: "String",
                    required: false,
                    copilot_description: 'Use this to restrict your field to a list of options (separated by commas). For instance, enter "Red, Green, Blue" here if the permissible values are Red, Green and Blue. Leave blank if the string can hold any value.',
                    sublabel: 'Use this to restrict your field to a list of options (separated by commas). For instance, enter <kbd class="fst-normal">Red, Green, Blue</kbd> here if the permissible values are Red, Green and Blue. Leave blank if the string can hold any value.',
                    attributes: { autofocus: true },
                },
                {
                    name: "min_length",
                    label: "Min length",
                    type: "Integer",
                    required: false,
                    sublabel: "The minimum number of characters in the string",
                    attributes: { asideNext: true },
                },
                {
                    name: "max_length",
                    label: "Max length",
                    type: "Integer",
                    required: false,
                    sublabel: "The maximum number of characters in the string",
                },
                {
                    name: "regexp",
                    type: "String",
                    label: "Regular expression",
                    required: false,
                    sublabel: "String value must match regular expression",
                    validator(s) {
                        if (!is_valid_regexp(s))
                            return "Not a valid Regular Expression";
                    },
                    attributes: { asideNext: true },
                },
                {
                    name: "re_invalid_error",
                    label: "Error message",
                    type: "String",
                    required: false,
                    sublabel: "Error message when regular expression does not match",
                },
                {
                    name: "exact_search_only",
                    label: "Exact search only",
                    type: "Bool",
                    sublabel: "Search only on exact match, not substring match. Useful for large tables",
                },
                ...(table
                    ? [
                        {
                            name: "localizes_field",
                            label: "Translation of",
                            sublabel: "This is a translation of a different field in a different language",
                            type: "String",
                            attributes: {
                                options: strFields.map((f) => f.name),
                            },
                        },
                        {
                            name: "locale",
                            label: "Locale",
                            sublabel: "Language locale of translation",
                            input_type: "select",
                            options: locales,
                            showIf: { localizes_field: strFields.map((f) => f.name) },
                        },
                    ]
                    : []),
            ];
          },
          contract: ({ options }) => typeof options === "string"
            ? is.one_of(options.split(","))
            : typeof options === "undefined"
                ? is.str
              : is.one_of(options.map((o) => (typeof o === "string" ? o : o.name))),
          fieldviews: {
            as_text: {
              isEdit: false,
              description: "Show the value with no other formatting",
              configFields: [
                {
                  name: "copy_to_clipbaord",
                  label: "Copy to clipboard",
                  type: "Bool",
                },
              ],
              run: (s, _req, attrs = {}) => attrs?.copy_to_clipbaord
                ? span({ class: "copy-to-clipboard" }, text_attr(s || ""))
              : text_attr(s || ""),
            },
            preFormatted: {
              isEdit: false,
              description: "Pre-formatted (in a &lt;pre&gt; tag)",
              run: (s) => s ? span({ style: "white-space:pre-wrap" }, text_attr(s || "")) : "",
            },
            code: {
              isEdit: false,
              description: "Show as a code block",
              run: (s) => (s ? pre(code(text_attr(s || ""))) : ""),
            },
            monospace_block: {
              isEdit: false,
              configFields: [
                {
                  name: "max_init_height",
                  label: "Max initial rows",
                  sublabel: "Only show this many rows until the user clicks",
                  type: "Integer",
                },
                {
                  name: "copy_btn",
                  label: "Copy button",
                  type: "Bool",
                },
              ],
              description: "Show as a monospace block",
              run: (s, _req, attrs = {}) => {
                if (!s)
                    return "";
                const copy_btn = attrs.copy_btn
                    ? button({
                        class: "btn btn-secondary btn-sm monospace-copy-btn m-1 d-none-prefer",
                        type: "button",
                        onclick: "copy_monospace_block(this)",
                    }, i({ class: "fas fa-copy" }))
                    : "";
                if (!attrs.max_init_height)
                    return (copy_btn +
                        pre({
                            class: "monospace-block",
                        }, s));
                const lines = s.split("\n");
                if (lines.length <= attrs.max_init_height)
                    return (copy_btn +
                        pre({
                            class: "monospace-block",
                        }, s));
                return (copy_btn +
                    pre({
                        class: "monospace-block",
                        onclick: `monospace_block_click(this)`,
                    }, lines.slice(0, attrs.max_init_height).join("\n") + "\n...") +
                    pre({ class: "d-none" }, s));
              },
            },
            ellipsize: {
              isEdit: false,
              configFields: [
                {
                  name: "nchars",
                  label: "Number of characters",
                  type: "Integer",
                  default: 20,
                },
              ],
              description: "Show First N characters of text followed by ... if truncated",
              run: (s, req, attrs = {}) => {
                if (!s || !s.length)
                    return "";
                if (s.length <= (attrs.nchars || 20))
                    return text_attr(s);
                return text_attr(s.substr(0, (attrs.nchars || 20) - 3)) + "...";
              },
            },
            as_link: {
              configFields: [
                {
                  name: "link_title",
                  label: "Link title",
                  type: "String",
                  sublabel: "Optional. If blank, label is URL",
                },
                {
                  name: "target_blank",
                  label: "Open in new tab",
                  type: "Bool",
                },
              ],
              description: "Show a link with the field value as the URL.",
              isEdit: false,
              run: (s, req, attrs = {}) => s
                ? a({
                    href: text(s || ""),
                    ...(attrs.target_blank ? { target: "_blank" } : {}),
                }, text_attr(attrs?.link_title || s || ""))
              : "",
            },
            img_from_url: {
              isEdit: false,
              description: "Show an image from the URL in the field value",
              run: (s, req, attrs) => img({ src: text(s || ""), style: "width:100%" }),
            },
            as_header: {
              isEdit: false,
              description: "Show this as a header",
              run: (s) => h3(text_attr(s || "")),
            },
            show_with_html: {
              configFields: [
                {
                  input_type: "code",
                  name: "code",
                  label: "HTML",
                  sublabel: "Access the value with <code>{{ it }}</code>.",
                  default: "",
                  attributes: {
                    mode: "text/html",
                  },
                },
              ],
              isEdit: false,
              description: "Show value with any HTML code",
              run: (v, req, attrs = {}) => {
                const ctx = { ...getState().eval_context };
                ctx.it = v;
                const rendered = interpolate(attrs?.code, ctx, req?.user, "show_with_html code");
                return rendered;
              },
            },
            edit: {
              isEdit: true,
              blockDisplay: true,
              description: "edit with a standard text input, or dropdown if field has options",
              configFields: (field) => [
                ...(field.attributes.options &&
                    field.attributes.options.length > 0 &&
                    !field.required
                    ? [
                        {
                            name: "neutral_label",
                            label: "Neutral label",
                            type: "String",
                        },
                        {
                            name: "force_required",
                            label: "Required",
                            sublabel: "User must select a value, even if the table field is not required",
                            type: "Bool",
                        },
                    ]
                    : []),
                ...(field.attributes.options && field.attributes.options.length > 0
                    ? [
                        {
                            name: "exclude_values",
                            label: "Exclude values",
                            sublabel: "Comma-separated list of value to exclude from the dropdown select",
                            type: "String",
                        },
                    ]
                    : []),
                {
                    name: "placeholder",
                    label: "Placeholder",
                    type: "String",
                },
                {
                    name: "input_type",
                    label: "Input type",
                    input_type: "select",
                    options: [
                        "text",
                        "email",
                        "url",
                        "tel",
                        "password",
                        "search",
                        "hidden",
                    ],
                },
                {
                    name: "autofocus",
                    label: "Autofocus",
                    type: "Bool",
                },
                {
                    name: "readonly",
                    label: "Read-only",
                    type: "Bool",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => attrs.options && (attrs.options.length > 0 || !required)
                ? attrs.readonly
                    ? input({
                        type: "text",
                        class: ["form-control", "form-select", cls],
                        name: attrs.isFilter ? undefined : text_attr(nm),
                        "data-fieldname": text_attr(field.name),
                        id: `input${text_attr(nm)}`,
                        onChange: attrs.onChange,
                        readonly: attrs.readonly,
                        value: v,
                    })
                    : select({
                        class: [
                            "form-control",
                            "form-select",
                            cls,
                            attrs.selectizable ? "selectizable" : false,
                        ],
                        name: attrs.isFilter ? undefined : text_attr(nm),
                        "data-fieldname": text_attr(field.name),
                        id: `input${text_attr(nm)}`,
                        disabled: attrs.disabled,
                        onChange: attrs.onChange,
                        onBlur: attrs.onChange,
                        autocomplete: "off",
                        "data-explainers": attrs.explainers
                            ? encodeURIComponent(JSON.stringify(attrs.explainers))
                            : undefined,
                        required: attrs.placeholder && (required || attrs.force_required),
                        ...(field.in_auto_save
                            ? {
                                "previous-val": v,
                                onFocus: "this.setAttribute('sc-received-focus', true);",
                            }
                            : {}),
                    }, attrs.placeholder && (required || attrs.force_required)
                        ? [
                            option({ value: "", disabled: true, selected: !v }, attrs.placeholder),
                            ...getStrOptions(v, attrs.options, attrs.exclude_values),
                        ]
                        : required || attrs.force_required
                            ? getStrOptions(v, attrs.options, attrs.exclude_values)
                            : [
                                option({ value: "" }, attrs.neutral_label || ""),
                                ...getStrOptions(v, attrs.options, attrs.exclude_values),
                            ])
                : attrs.options
                    ? none_available(required)
                    : attrs.calcOptions
                        ? select({
                            class: ["form-control", "form-select", cls],
                            name: attrs.isFilter ? undefined : text_attr(nm),
                            disabled: attrs.disabled,
                            "data-fieldname": text_attr(field.name),
                            id: `input${text_attr(nm)}`,
                            onChange: attrs.onChange,
                            onBlur: attrs.onChange,
                            autocomplete: "off",
                            "data-selected": v,
                            "data-calc-options": encodeURIComponent(JSON.stringify(attrs.calcOptions)),
                        }, option({ value: "" }, ""))
                        : input({
                            type: attrs.input_type || (attrs.isFilter ? "search" : "text"),
                            disabled: attrs.disabled,
                            readonly: attrs.readonly,
                            class: ["form-control", cls],
                            placeholder: attrs.placeholder,
                            onChange: attrs.onChange,
                            spellcheck: attrs.spellcheck === false ? "false" : undefined,
                            "data-fieldname": text_attr(field.name),
                            name: attrs.isFilter ? undefined : text_attr(nm),
                            required: !!(required || attrs.force_required),
                            maxlength: isdef(attrs.max_length) && attrs.max_length,
                            minlength: isdef(attrs.min_length) && attrs.min_length,
                            pattern: !!attrs.regexp && attrs.regexp,
                            autofocus: !!attrs.autofocus,
                            autocomplete: attrs.autocomplete || undefined,
                            title: !!attrs.re_invalid_error &&
                                !!attrs.regexp &&
                                attrs.re_invalid_error,
                            id: `input${text_attr(nm)}`,
                            ...(isdef(v) && { value: text_attr(v) }),
                      }),
            },
            fill_formula_btn: {
              isEdit: true,
              blockDisplay: true,
              description: "Input with a button prefills value from specified formula",
              configFields: [
                {
                  name: "formula",
                  label: "Formula",
                  type: "String",
                },
                {
                  name: "label",
                  label: "Button label",
                  type: "String",
                },
                {
                  name: "make_unique",
                  label: "Make unique after fill",
                  type: "Bool",
                },
                {
                  name: "include_space",
                  label: "Include space",
                  type: "Bool",
                  showIf: {
                    make_unique: true,
                  },
                },
                {
                  name: "start_from",
                  label: "Start from",
                  type: "Integer",
                  default: 0,
                  showIf: {
                    make_unique: true,
                  },
                },
                {
                  name: "always_append",
                  label: "Always append",
                  type: "Bool",
                  showIf: {
                    make_unique: true,
                  },
                },
                {
                  name: "char_type",
                  label: "Append character type",
                  input_type: "select",
                  options: [
                    "Digits",
                    "Lowercase Letters",
                    "Uppercase Letters",
                  ],
                  showIf: {
                    make_unique: true,
                  },
                },
              ],
              run: (nm, v, attrs, cls, required, field) => div({ class: "input-group" }, input({
                type: attrs.input_type || "text",
                disabled: attrs.disabled,
                readonly: attrs.readonly,
                class: ["form-control", cls],
                placeholder: attrs.placeholder,
                onChange: attrs.onChange,
                "data-fieldname": text_attr(field.name),
                name: text_attr(nm),
                id: `input${text_attr(nm)}`,
                ...(isdef(v) && { value: text_attr(v) }),
                }), button({
                class: "btn btn-secondary",
                type: "button",
                "data-formula": encodeURIComponent(attrs?.formula),
                "data-formula-free-vars": encodeURIComponent(JSON.stringify(join_fields_in_formula(attrs?.formula))),
                "data-formula-table": encodeURIComponent(JSON.stringify(Table.findOne(field.table_id).to_json)),
                onClick: "fill_formula_btn_click(this" +
                    (attrs.make_unique
                        ? `,()=>make_unique_field('input${text_attr(nm)}', ${field.table_id}, '${field.name}',  $('#input${text_attr(nm)}'), ${!!attrs.include_space}, ${attrs.start_from || 0}, ${!!attrs.always_append}, '${attrs.char_type}')`
                        : "") +
                    ")",
              }, attrs?.label || "Fill")),
            },
            make_unique: {
              isEdit: true,
              blockDisplay: true,
              description: "Make this input unique in the database table",
              configFields: [
                {
                  name: "placeholder",
                  label: "Placeholder",
                  type: "String",
                },
                {
                  name: "input_type",
                  label: "Input type",
                  input_type: "select",
                  options: [
                    "text",
                    "email",
                    "url",
                    "tel",
                    "password",
                  ],
                },
                {
                  name: "include_space",
                  label: "Include space",
                  type: "Bool",
                },
                {
                  name: "start_from",
                  label: "Start from",
                  type: "Integer",
                  default: 0,
                },
                {
                  name: "always_append",
                  label: "Always append",
                  type: "Bool",
                },
                {
                  name: "char_type",
                  label: "Append character type",
                  input_type: "select",
                  options: [
                    "Digits",
                    "Lowercase Letters",
                    "Uppercase Letters",
                  ],
                },
              ],
              run: (nm, v, attrs, cls, required, field) => input({
                type: attrs.input_type || "text",
                disabled: attrs.disabled,
                readonly: attrs.readonly,
                class: ["form-control", cls],
                placeholder: attrs.placeholder,
                onChange: attrs.onChange,
                "data-fieldname": text_attr(field.name),
                name: text_attr(nm),
                id: `input${text_attr(nm)}`,
                ...(isdef(v) && { value: text_attr(v) }),
                }) +
              script(domReady(`make_unique_field('input${text_attr(nm)}', ${field.table_id}, '${field.name}', $('#input${text_attr(nm)}'), ${attrs.include_space}, ${attrs.start_from}, ${attrs.always_append}, ${JSON.stringify(attrs.char_type)})`)),
            },
            textarea: {
              isEdit: true,
              blockDisplay: true,
              description: "Edit as a text area (multi line input)",
              configFields: [
                {
                  type: "Bool",
                  name: "spellcheck",
                  label: "Spellcheck",
                },
                {
                  type: "Integer",
                  name: "rows",
                  label: "Rows",
                },
                {
                  name: "placeholder",
                  label: "Placeholder",
                  type: "String",
                },
                {
                  name: "unsafe",
                  label: "Disable escaping",
                  sublabel: "Do not escape unsafe HTML fragments",
                  type: "String",
                },
                {
                  type: "Bool",
                  name: "monospace",
                  label: "Monospace",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => textarea({
                class: ["form-control", cls, attrs.monospace && "font-monospace"],
                name: text_attr(nm),
                "data-fieldname": text_attr(field.name),
                disabled: attrs.disabled,
                onChange: attrs.onChange,
                readonly: attrs.readonly,
                placeholder: attrs.placeholder,
                spellcheck: attrs.spellcheck === false ? "false" : undefined,
                required: !!required,
                maxlength: isdef(attrs.max_length) && attrs.max_length,
                minlength: isdef(attrs.min_length) && attrs.min_length,
                id: `input${text_attr(nm)}`,
                rows: attrs.rows || 5,
              }, attrs.unsafe ? v || "" : text(v) || ""),
            },
            code_editor: {
              isEdit: true,
              blockDisplay: true,
              description: "Edit as code",
              configFields: [
                {
                  type: "String",
                  name: "mode",
                  label: "mode",
                  required: true,
                  attributes: {
                    options: [
                      "application/javascript",
                      "text/html",
                      "text/css",
                      "text/x-sql",
                    ],
                  },
                },
              ],
              run: (nm, v, attrs, cls, required, field) => textarea({
                class: ["form-control", "to-code", cls],
                name: text_attr(nm),
                "data-fieldname": text_attr(field.name),
                disabled: attrs.disabled,
                onChange: attrs.onChange,
                readonly: attrs.readonly,
                placeholder: attrs.placeholder,
                spellcheck: "false",
                required: !!required,
                maxlength: isdef(attrs.max_length) && attrs.max_length,
                minlength: isdef(attrs.min_length) && attrs.min_length,
                id: `input${text_attr(nm)}`,
                mode: attrs.mode,
              }, text(v) || ""),
            },
            radio_group: {
              isEdit: true,
              configFields: [
                {
                  type: "Bool",
                  name: "inline",
                  label: "Inline",
                },
              ],
              description: "Pick from a radio group. Field must have options",
              run: (nm, v, attrs, cls, required, field) => attrs.options
                ? radio_group({
                    class: cls,
                    name: text_attr(nm),
                    disabled: attrs.disabled,
                    inline: attrs.inline,
                    onChange: attrs.onChange,
                    required: !!required,
                    options: Array.isArray(attrs.options)
                        ? attrs.options
                        : attrs.options.split(",").map((o) => o.trim()),
                    value: v,
                })
              : none_available(required),
            },
            checkbox_group: {
              isEdit: false,
              isFilter: true,
              description: "Filter from a checkbox group. Field must have options. Possible selections are treated as OR.",
              configFields: [
                {
                  type: "Bool",
                  name: "inline",
                  label: "Inline",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => attrs && attrs.options
                ? checkbox_group({
                    class: cls,
                    name: text_attr(nm),
                    disabled: attrs.disabled,
                    inline: attrs.inline,
                    options: Array.isArray(attrs.options)
                        ? attrs.options
                        : attrs.options.split(",").map((o) => o.trim()),
                    value: v,
                })
              : i("None available"),
            },
            password: {
              isEdit: true,
              configFields: [
                {
                  name: "visibility_toggle",
                  label: "Visibility toggle",
                  type: "Bool",
                },
                {
                  name: "autocomplete",
                  label: "Autocomplete",
                  type: "String",
                  attributes: {
                    options: [
                      "on",
                      "off",
                      "current-password",
                      "new-password",
                    ],
                  },
                },
              ],
              blockDisplay: true,
              description: "Password input type, characters are hidden when typed",
              run: (nm, v, attrs, cls, required, field) => {
                const pwinput = input({
                    type: "password",
                    disabled: attrs.disabled,
                    readonly: attrs.readonly,
                    class: ["form-control", cls],
                    "data-fieldname": text_attr(field.name),
                    onChange: attrs.onChange,
                    name: text_attr(nm),
                    id: `input${text_attr(nm)}`,
                    ...(isdef(v) && { value: text_attr(v) }),
                    autocomplete: attrs?.autocomplete === false
                        ? "off"
                        : attrs?.autocomplete || undefined,
                });
                if (attrs?.visibility_toggle)
                    return div({ class: "input-group" }, pwinput, span({ class: "input-group-text toggle-password-vis" }, i({ class: "fas fa-eye toggle-password-vis-icon" })));
                else
                    return pwinput;
              },
            },
            select_by_code: {
              type: undefined,
              isEdit: true,
              blockDisplay: true,
              description: "Select by drop-down. Available options are set by code.",
              configFields: (field) => [
                {
                    name: "code",
                    label: "Code",
                    input_type: "code",
                    attributes: { mode: "application/javascript" },
                    class: "validate-statements",
                    sublabel: `Return array of: strings or <code>{ label: string, value: ${field.is_fkey ? "key-value" : field.type?.js_type || "any"} }</code>`,
                    validator(s) {
                        try {
                            let AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
                            AsyncFunction(s);
                            return true;
                        }
                        catch (e) {
                            return e.message;
                        }
                    },
                },
              ],
              // fill_options: async fill_options(field, force_allow_none, where0, extraCtx, optionsQuery, formFieldNames, user) {
              //   field.options = await eval_statements(field.attributes.code, {
              //       ...extraCtx,
              //       user,
              //       Table: table_1.default,
              //   });
              // },
              run: (nm, v, attrs, cls, reqd, field) => {
                const selOptions = select_options(v, field, (attrs || {}).force_required, (attrs || {}).neutral_label, false);
                return tags.select({
                    class: `form-control form-select ${cls} ${field.class || ""}`,
                    "data-fieldname": field.form_name,
                    name: text_attr(nm),
                    id: `input${text_attr(nm)}`,
                    disabled: attrs.disabled || attrs.disable,
                    readonly: attrs.readonly,
                    onChange: attrs.onChange,
                    autocomplete: "off",
                }, selOptions);
              },
            },
          },
          read: (v) => {
            switch (typeof v) {
                case "string":
                    //PG dislikes null bytes
                    return v.replace(/\0/g, "");
                default:
                    return undefined;
            }
          },
          presets: {
            IP: ({ req }) => req.ip,
            SessionID: ({ req }) => req.sessionID || req.cookies["express:sess"],
          },
          validate: ({ min_length, max_length, regexp, re_invalid_error }) => (x) => {
            if (!x || typeof x !== "string")
                return true; //{ error: "Not a string" };
            if (isdef(min_length) && x.length < min_length)
                return { error: `Must be at least ${min_length} characters` };
            if (isdef(max_length) && x.length > max_length)
                return { error: `Must be at most ${max_length} characters` };
            if (isdef(regexp) && !new RegExp(regexp).test(x))
                return {
                    error: re_invalid_error || `Does not match regular expression`,
                };
            return true;
          },
          validate_attributes: ({ min_length, max_length, regexp }) => (!isdef(min_length) || !isdef(max_length) || max_length >= min_length) &&
          (!isdef(regexp) || is_valid_regexp(regexp)),
        },
        options: undefined,
        help: undefined,
        required: true,
        is_unique: false,
        hidden: false,
        disabled: false,
        calculated: false,
        primary_key: false,
        stored: false,
        expression: "",
        sourceURL: undefined,
        tab: undefined,
        is_fkey: false,
        input_type: "fromtype",
        attributes: {
          regexp: "",
          options: "metric,imperial",
          importance: 8,
          max_length: 16,
          min_length: 0,
          re_invalid_error: "",
          exact_search_only: true,
        },
        table_id: 11,
        in_auto_save: undefined,
        exclude_from_mobile: undefined,
      },
      {
        refname: "",
        label: "Two-factor enabled",
        name: "two_factor_enabled",
        fieldview: undefined,
        validator: () => true,
        showIf: undefined,
        parent_field: undefined,
        postText: undefined,
        class: "",
        id: 89,
        default: undefined,
        sublabel: undefined,
        description: null,
        type: {
          name: "Bool",
          description: "Boolean values: true or false",
          sql_name: "boolean",
          js_type: "boolean",
          contract: () => is.bool,
          fieldviews: {
            show: {
              isEdit: false,
              description: "Show as a green tick or red cross circle",
              run: (v, req) => typeof v === "undefined" || v === null
                ? ""
                : req.generate_email
                    ? v
                        ? "&#10004;"
                        : "&#10008;"
                    : v
                        ? i({
                            class: "fas fa-lg fa-check-circle text-success",
                        })
                        : i({
                            class: "fas fa-lg fa-times-circle text-danger",
                      }),
            },
            checkboxes: {
              isEdit: false,
              description: "Show with a non-editable checkbox",
              run: (v) => v === true
                ? input({ disabled: true, type: "checkbox", checked: true })
                : v === false
                    ? input({ type: "checkbox", disabled: true })
                  : "",
            },
            TrueFalse: {
              isEdit: false,
              description: "Show as True or False",
              run: (v) => (v === true ? "True" : v === false ? "False" : ""),
            },
            edit: {
              isEdit: true,
              description: "Edit with a checkbox",
              configFields: [
                {
                  name: "size",
                  label: "Size",
                  type: "String",
                  attributes: {
                    options: [
                      "normal",
                      "medium",
                      "large",
                    ],
                  },
                },
                {
                  name: "readonly",
                  label: "Read-only",
                  type: "Bool",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => {
                const onChange = attrs.isFilter && v
                    ? `unset_state_field('${nm}', this)`
                    : attrs.onChange;
                return input({
                    class: ["me-2 mt-1", attrs?.size || null, cls],
                    "data-fieldname": text_attr(field.name),
                    type: "checkbox",
                    onChange,
                    readonly: attrs.readonly,
                    name: text_attr(nm),
                    id: `input${text_attr(nm)}`,
                    ...(v && { checked: true }),
                    ...(attrs.disabled && { onclick: "return false;" }),
                });
              },
            },
            switch: {
              isEdit: true,
              description: "Edit with a switch",
              run: (nm, v, attrs, cls, required, field) => {
                const onChange = attrs.isFilter && v
                    ? `unset_state_field('${nm}', this)`
                    : attrs.onChange;
                return span({ class: "form-switch" }, input({
                    class: ["form-check-input", cls],
                    "data-fieldname": text_attr(field.name),
                    type: "checkbox",
                    onChange,
                    readonly: attrs.readonly,
                    role: "switch",
                    name: text_attr(nm),
                    id: `input${text_attr(nm)}`,
                    ...(v && { checked: true }),
                    ...(attrs.disabled && { onclick: "return false;" }),
                }));
              },
            },
            show_with_html: {
              configFields: [
                {
                  input_type: "code",
                  name: "code",
                  label: "HTML",
                  sublabel: "Access the value with <code>{{ it }}</code>.",
                  default: "",
                  attributes: {
                    mode: "text/html",
                  },
                },
              ],
              isEdit: false,
              description: "Show value with any HTML code",
              run: (v, req, attrs = {}) => {
                const ctx = { ...getState().eval_context };
                ctx.it = v;
                const rendered = interpolate(attrs?.code, ctx, req?.user, "show_with_html code");
                return rendered;
              },
            },
            tristate: {
              isEdit: true,
              description: "Edit with a control that can be True, False and Null (missing)",
              configFields: [
                {
                  name: "false_label",
                  label: "False label",
                  type: "String",
                },
                {
                  name: "null_label",
                  label: "Null label",
                  type: "String",
                },
                {
                  name: "true_label",
                  label: "True label",
                  type: "String",
                },
                {
                  name: "outline_buttons",
                  label: "Outline buttons",
                  type: "Bool",
                },
              ],
              run: (nm, v, attrs, cls, required, field) => attrs.disabled
                ? !(!isdef(v) || v === null)
                    ? ""
                    : v
                        ? "T"
                        : "F"
                : input({
                    type: "hidden",
                    "data-fieldname": text_attr(field.name),
                    name: attrs.isFilter ? undefined : text_attr(nm),
                    onChange: attrs.onChange,
                    "data-postprocess": `it=='on'?true:it=='off'?false:null`,
                    id: `input${text_attr(nm)}`,
                    value: !isdef(v) || v === null ? "?" : v ? "on" : "off",
                }) +
                    button({
                        onClick: `tristateClick(this, ${JSON.stringify(required)})`,
                        type: "button",
                        "data-true-label": attrs?.true_label,
                        "data-false-label": attrs?.false_label,
                        "data-null-label": attrs?.null_label,
                        class: [
                            "btn btn-xs",
                            !isdef(v) || v === null
                                ? `btn-${attrs.outline_buttons ? "outline-" : ""}secondary`
                                : v
                                    ? `btn-${attrs.outline_buttons ? "outline-" : ""}success`
                                    : `btn-${attrs.outline_buttons ? "outline-" : ""}danger`,
                        ],
                        id: `trib${text_attr(nm)}`,
                    }, !isdef(v) || v === null
                        ? attrs?.null_label || "?"
                        : v
                            ? attrs?.true_label || "T"
                          : attrs?.false_label || "F"),
            },
            thumbs_up_down: {
              isEdit: true,
              description: "Edit with Thumb up/down for True, False and Null (missing) values",
              configFields: [
                {
                  name: "icons",
                  label: "Icons",
                  type: "String",
                  required: true,
                  attributes: {
                    options: [
                      "Thumb",
                      "Arrow",
                      "Caret",
                      "Smile",
                      "Check",
                    ],
                  },
                },
              ],
              run: (nm, v, attrs, cls, required, field) => {
                let yes, no;
                switch (attrs.icons) {
                    case "Arrow":
                        yes = i({ class: "fas fa-arrow-up" });
                        no = i({ class: "fas fa-arrow-down" });
                        break;
                    case "Caret":
                        yes = i({ class: "fas fa-caret-up" });
                        no = i({ class: "fas fa-caret-down" });
                        break;
                    case "Smile":
                        yes = i({ class: "far fa-smile" });
                        no = i({ class: "far fa-frown" });
                        break;
                    case "Check":
                        yes = i({ class: "fas fa-check" });
                        no = i({ class: "fas fa-times" });
                        break;
                    default:
                        yes = i({ class: "far fa-thumbs-up" });
                        no = i({ class: "far fa-thumbs-down" });
                        break;
                }
                return (input({
                    type: "hidden",
                    "data-fieldname": text_attr(field.name),
                    name: attrs.isFilter ? undefined : text_attr(nm),
                    onChange: attrs.onChange,
                    "data-postprocess": `it=='on'?true:it=='off'?false:null`,
                    id: `input${text_attr(nm)}`,
                    value: !isdef(v) || v === null ? "?" : v ? "on" : "off",
                }) +
                    div({ class: "btn-group" }, button({
                        onClick: `thumbsUpDownClick(this, ${JSON.stringify(required)})`,
                        type: "button",
                        class: `btn btn-xs btn-${v === true ? "" : "outline-"}success thumbsup`,
                        id: `trib${text_attr(nm)}`,
                    }, yes), button({
                        onClick: `thumbsUpDownClick(this, ${JSON.stringify(required)})`,
                        type: "button",
                        class: `btn btn-xs btn-${v === false ? "" : "outline-"}danger thumbsdown`,
                        id: `trib${text_attr(nm)}`,
                    }, no)));
              },
            },
          },
          attributes: [
          ],
          readFromFormRecord: (rec, name) => {
            if (rec[name] === "")
                return null;
            if (!rec[name])
                return false;
            if (["undefined", "false", "off", "no"].includes(rec[name]))
                return false;
            if (rec[name] === "?")
                return null;
            return rec[name] ? true : false;
          },
          read: (v) => {
            switch (typeof v) {
                case "string":
                    if (["TRUE", "T", "ON", "YES"].includes(v.toUpperCase()))
                        return true;
                    if (v === "?" || v === "")
                        return null;
                    else
                        return false;
                default:
                    if (v === null)
                        return null;
                    return v ? true : false;
            }
          },
          readFromDB: (v) => (v === null ? null : !!v),
          listAs: (v) => JSON.stringify(v),
          validate: () => (x) => true,
        },
        options: undefined,
        help: undefined,
        required: true,
        is_unique: false,
        hidden: false,
        disabled: false,
        calculated: false,
        primary_key: false,
        stored: false,
        expression: "",
        sourceURL: undefined,
        tab: undefined,
        is_fkey: false,
        input_type: "fromtype",
        attributes: {
          importance: 6,
        },
        table_id: 11,
        in_auto_save: undefined,
        exclude_from_mobile: undefined,
      },
      {
        refname: "id",
        label: "User",
        name: "user_id",
        fieldview: undefined,
        validator: () => true,
        showIf: undefined,
        parent_field: undefined,
        postText: undefined,
        class: "",
        id: 84,
        default: undefined,
        sublabel: undefined,
        description: null,
        type: "Key",
        typename: "Key",
        options: undefined,
        help: undefined,
        required: true,
        is_unique: false,
        hidden: false,
        disabled: false,
        calculated: false,
        primary_key: false,
        stored: false,
        expression: "",
        sourceURL: undefined,
        tab: undefined,
        is_fkey: true,
        reftable_name: "users",
        reftable: undefined,
        input_type: "select",
        reftype: "Integer",
        attributes: {
          importance: 10,
          summary_field: "email",
        },
        table_id: 11,
        in_auto_save: undefined,
        exclude_from_mobile: undefined,
      },
    ],
  },
  fields: [
    {
      name: "default_sharing_permission",
      label: "Default sharing permission",
      type: "String",
      required: false,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "as_text",
        "preFormatted",
        "code",
        "monospace_block",
        "ellipsize",
        "as_link",
        "img_from_url",
        "as_header",
        "show_with_html",
        "edit",
        "fill_formula_btn",
        "make_unique",
        "textarea",
        "code_editor",
        "radio_group",
        "checkbox_group",
        "password",
        "select_by_code",
      ],
    },
    {
      name: "id",
      label: "ID",
      type: "Integer",
      required: true,
      primary_key: true,
      calculated: false,
      is_pk_name: true,
      default_fieldview: null,
      fieldviews: [
        "show",
        "edit",
        "number_slider",
        "range_interval",
        "progress_bar",
        "heat_cell",
        "above_input",
        "below_input",
        "show_with_html",
        "show_star_rating",
        "edit_star_rating",
        "to_locale_string",
        "role_select",
        "select_by_code",
      ],
    },
    {
      name: "locale",
      label: "Locale",
      type: "String",
      required: false,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "as_text",
        "preFormatted",
        "code",
        "monospace_block",
        "ellipsize",
        "as_link",
        "img_from_url",
        "as_header",
        "show_with_html",
        "edit",
        "fill_formula_btn",
        "make_unique",
        "textarea",
        "code_editor",
        "radio_group",
        "checkbox_group",
        "password",
        "select_by_code",
      ],
    },
    {
      name: "notification_prefs",
      label: "Notification preferences",
      type: "JSON",
      required: false,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "show",
        "subfield",
        "edit_subfield",
        "pretty",
        "show_table",
        "edit",
        "edit_table",
        "keys_expand_columns",
        "jsonRangeFilter",
        "jsonFilter",
        "show_with_html",
      ],
    },
    {
      name: "preferred_units",
      label: "Preferred units",
      type: "String",
      required: true,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "as_text",
        "preFormatted",
        "code",
        "monospace_block",
        "ellipsize",
        "as_link",
        "img_from_url",
        "as_header",
        "show_with_html",
        "edit",
        "fill_formula_btn",
        "make_unique",
        "textarea",
        "code_editor",
        "radio_group",
        "checkbox_group",
        "password",
        "select_by_code",
      ],
    },
    {
      name: "two_factor_enabled",
      label: "Two-factor enabled",
      type: "Bool",
      required: true,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "show",
        "checkboxes",
        "TrueFalse",
        "edit",
        "switch",
        "show_with_html",
        "tristate",
        "thumbs_up_down",
      ],
    },
    {
      name: "user_id",
      label: "User",
      type: "Key",
      required: true,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "show",
      ],
    },
  ],
  fieldMap: {
    default_sharing_permission: {
      name: "default_sharing_permission",
      label: "Default sharing permission",
      type: "String",
      required: false,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "as_text",
        "preFormatted",
        "code",
        "monospace_block",
        "ellipsize",
        "as_link",
        "img_from_url",
        "as_header",
        "show_with_html",
        "edit",
        "fill_formula_btn",
        "make_unique",
        "textarea",
        "code_editor",
        "radio_group",
        "checkbox_group",
        "password",
        "select_by_code",
      ],
    },
    id: {
      name: "id",
      label: "ID",
      type: "Integer",
      required: true,
      primary_key: true,
      calculated: false,
      is_pk_name: true,
      default_fieldview: null,
      fieldviews: [
        "show",
        "edit",
        "number_slider",
        "range_interval",
        "progress_bar",
        "heat_cell",
        "above_input",
        "below_input",
        "show_with_html",
        "show_star_rating",
        "edit_star_rating",
        "to_locale_string",
        "role_select",
        "select_by_code",
      ],
    },
    locale: {
      name: "locale",
      label: "Locale",
      type: "String",
      required: false,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "as_text",
        "preFormatted",
        "code",
        "monospace_block",
        "ellipsize",
        "as_link",
        "img_from_url",
        "as_header",
        "show_with_html",
        "edit",
        "fill_formula_btn",
        "make_unique",
        "textarea",
        "code_editor",
        "radio_group",
        "checkbox_group",
        "password",
        "select_by_code",
      ],
    },
    notification_prefs: {
      name: "notification_prefs",
      label: "Notification preferences",
      type: "JSON",
      required: false,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "show",
        "subfield",
        "edit_subfield",
        "pretty",
        "show_table",
        "edit",
        "edit_table",
        "keys_expand_columns",
        "jsonRangeFilter",
        "jsonFilter",
        "show_with_html",
      ],
    },
    preferred_units: {
      name: "preferred_units",
      label: "Preferred units",
      type: "String",
      required: true,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "as_text",
        "preFormatted",
        "code",
        "monospace_block",
        "ellipsize",
        "as_link",
        "img_from_url",
        "as_header",
        "show_with_html",
        "edit",
        "fill_formula_btn",
        "make_unique",
        "textarea",
        "code_editor",
        "radio_group",
        "checkbox_group",
        "password",
        "select_by_code",
      ],
    },
    two_factor_enabled: {
      name: "two_factor_enabled",
      label: "Two-factor enabled",
      type: "Bool",
      required: true,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "show",
        "checkboxes",
        "TrueFalse",
        "edit",
        "switch",
        "show_with_html",
        "tristate",
        "thumbs_up_down",
      ],
    },
    user_id: {
      name: "user_id",
      label: "User",
      type: "Key",
      required: true,
      primary_key: false,
      calculated: false,
      is_pk_name: false,
      default_fieldview: null,
      fieldviews: [
        "show",
      ],
    },
  },
  actions: [
    "Delete",
    "GoBack",
    "blocks",
    "emit_event",
    "loop_rows",
    "webhook",
    "find_or_create_dm_room",
    "send_email",
    "insert_joined_row",
    "duplicate_row",
    "recalculate_stored_fields",
    "insert_any_row",
    "modify_row",
    "delete_rows",
    "navigate",
    "step_control_flow",
    "form_action",
    "copy_to_clipboard",
    "toast",
    "run_js_code",
    "run_js_code_in_field",
    "duplicate_row_prefill_edit",
    "set_user_language",
    "sync_table_from_external",
    "reload_embedded_view",
    "progress_bar",
    "sleep",
    "refresh_user_session",
    "notify_user",
    "convert_session_to_user",
    "train_model_instance",
    "download_file_to_browser",
    "install_progressive_web_app",
    "toggle_dark_mode",
    "Agent",
    "llm_function_call",
    "llm_generate",
    "llm_transcribe_audio",
    "llm_generate_image",
    "llm_generate_json",
    "copilot_generate_page",
    "app_constructor_feedback",
    "Saltcorn Copilot",
    "trig",
  ],
  viewNames: [
  ],
});

describe("normalizeLayoutCandidate", () => {
  it("normalizes candidate", () => {
    const candidate = {
      type: "stack",
      above: [
        {
          type: "blank",
          contents: "User settings",
          textStyle: "h4",
          block: true,
        },
        {
          type: "blank",
          contents:
            "Configure your default units, language, notifications, sharing, and two-factor authentication.",
          textStyle: ["small", "text-muted"],
          block: true,
        },
        {
          type: "field",
          field_name: "preferred_units",
          fieldview: "edit",
          block: true,
        },
        {
          type: "field",
          field_name: "locale",
          fieldview: "edit",
          block: true,
        },
        {
          type: "field",
          field_name: "notification_prefs",
          fieldview: "textarea",
          block: true,
        },
        {
          type: "field",
          field_name: "default_sharing_permission",
          fieldview: "edit",
          block: true,
        },
        {
          type: "field",
          field_name: "two_factor_enabled",
          fieldview: "switch",
          block: true,
        },
        {
          type: "line_break",
        },
        {
          type: "action",
          action_name: "Save",
          action_label: "Save settings",
          action_style: "btn-primary",
          action_class: "me-2",
        },
        {
          type: "action",
          action_name: "set_user_language",
          action_label: "Apply language now",
          action_style: "btn-outline-secondary",
          action_class: "me-2",
        },
        {
          type: "action",
          action_name: "Cancel",
          action_label: "Cancel",
          action_style: "btn-link",
        },
      ],
    };

    const result = normalizeLayoutCandidate(candidate, makeCtx());
    console.log(JSON.stringify(result, null, 2));
    expect(result).not.toBeNull();
  });
});
