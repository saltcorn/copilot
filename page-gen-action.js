const { eval_expression } = require("@saltcorn/data/models/expression");
const { interpolate } = require("@saltcorn/data/utils");
const { getState } = require("@saltcorn/data/db/state");
const File = require("@saltcorn/data/models/file");
const Page = require("@saltcorn/data/models/page");

const GeneratePage = require("./actions/generate-page");
const { parseHTML } = require("./common");

const numericIdRE = /^\d+$/;

const arrayify = (value) => {
  if (value === null || typeof value === "undefined") return [];
  return Array.isArray(value) ? value : [value];
};

const normalizeName = (value) =>
  typeof value === "string" ? value.trim() : value || "";

const findFileSafe = async (identifier) => {
  if (identifier === null || typeof identifier === "undefined") return null;
  if (
    typeof identifier === "object" &&
    identifier.mimetype &&
    typeof identifier.get_contents === "function"
  )
    return identifier;
  const attempts = [];
  if (typeof identifier === "object" && identifier.id)
    attempts.push({ id: identifier.id });
  if (typeof identifier === "object" && identifier.path_to_serve)
    attempts.push(identifier.path_to_serve);
  if (typeof identifier === "number") attempts.push({ id: identifier });
  if (typeof identifier === "string") {
    const trimmed = identifier.trim();
    if (trimmed) {
      attempts.push(trimmed);
      if (numericIdRE.test(trimmed)) attempts.push({ id: +trimmed });
      attempts.push({ name: trimmed });
      attempts.push({ filename: trimmed });
      attempts.push({ path_to_serve: trimmed });
    }
  }
  for (const attempt of attempts) {
    try {
      const file = await File.findOne(attempt);
      if (file) return file;
    } catch (e) {
      // ignore lookup errors
    }
  }
  return null;
};

const valueToDataUrl = async (value) => {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value === "string" && value.trim().startsWith("data:"))
    return value.trim();
  const file = await findFileSafe(value);
  if (!file) return null;
  const base64 = await file.get_contents("base64");
  return `data:${file.mimetype};base64,${base64}`;
};

const gatherImageDataFromValue = async (value) => {
  const urls = [];
  for (const entry of arrayify(value)) {
    const url = await valueToDataUrl(entry);
    if (url) urls.push(url);
  }
  return urls;
};

const gatherImagesFromExpression = async (expression, row, user, label) => {
  if (!expression) return [];
  const resolved = eval_expression(expression, row, user, label);
  return await gatherImageDataFromValue(resolved);
};

const buildImageMessages = (dataUrls, label) =>
  (dataUrls || []).map((image) => ({
    role: "user",
    content: [
      ...(label ? [{ type: "text", text: label }] : []),
      { type: "image", image },
    ],
  }));

const loadExistingPageAssets = async (pageName) => {
  if (!pageName) return { page: null, html: null };
  const page = await Page.findOne({ name: pageName });
  if (!page) return { page: null, html: null };
  let html = null;
  if (page.layout?.html_file) {
    const file = await findFileSafe(page.layout.html_file);
    if (file) html = await file.get_contents("utf8");
  }
  return { page, html };
};

const refreshPagesSoon = () =>
  setTimeout(() => getState().refresh_pages(), 200);

const upsertHtmlPreviewPage = async (name, html, title, description, user) => {
  const file = await File.from_contents(
    `${name}.html`,
    "text/html",
    html,
    user.id,
    100,
  );
  const layout = { html_file: file.path_to_serve };
  const existing = await Page.findOne({ name });
  if (existing) await existing.update({ title, description, layout });
  else
    await Page.create({
      name,
      title,
      description,
      min_role: 100,
      layout,
    });
  refreshPagesSoon();
};

module.exports = {
  description: "Generate page with AI copilot",
  configFields: ({ table, mode }) => {
    if (mode === "workflow") {
      return [
        {
          name: "page_name",
          label: "Page name",
          sublabel:
            "Leave blank to not save a Saltcorn page. Use interpolations {{ }} to access variables in the context",
          type: "String",
        },
        {
          name: "prompt_template",
          label: "Prompt",
          sublabel:
            "Prompt text. Use interpolations {{ }} to access variables in the context",
          type: "String",
          fieldview: "textarea",
          required: true,
        },
        {
          name: "image_prompt",
          label: "Prompt image files",
          sublabel:
            "Optional. An expression, based on the context, for file path or array of file paths for prompting",
          class: "validate-expression",
          type: "String",
        },
        {
          name: "design_image_expression",
          label: "Design image expression",
          sublabel:
            "Optional expression returning a file, file id, data URL, or array with reference design images to guide generation",
          class: "validate-expression",
          type: "String",
        },
        {
          name: "feedback_image_expression",
          label: "Feedback image expression",
          sublabel:
            "Optional expression returning a file, file id, data URL, or array with annotated feedback screenshots",
          class: "validate-expression",
          type: "String",
        },
        {
          name: "existing_page_name",
          label: "Existing page name",
          sublabel:
            "Optional expression evaluating to the name of the page to use as a baseline. If provided, its HTML will be included automatically",
          class: "validate-expression",
          type: "String",
        },
        {
          name: "existing_page_html",
          label: "Existing page HTML",
          sublabel:
            "Optional. An expression, based on the context, for the existing page HTML to be edited",
          class: "validate-expression",
          type: "String",
        },
        {
          name: "answer_field",
          label: "Answer variable",
          sublabel: "Optional. Set the generated HTML to this context variable",
          class: "validate-identifier",
          type: "String",
        },
        {
          name: "convert_to_saltcorn",
          label: "Editable format",
          sublabel: "Convert to Saltcorn editable pages",
          type: "Bool",
        },
        //   ...override_fields,
        {
          name: "model",
          label: "Model",
          sublabel: "Override default model name",
          type: "String",
        },
      ];
    } else if (table) {
      const textFields = table.fields
        .filter((f) => f.type?.sql_name === "text")
        .map((f) => f.name);
      const fileFields = table.fields
        .filter((f) => ["File", "Image"].includes(f.type?.name))
        .map((f) => f.name);

      return [
        {
          name: "prompt_field",
          label: "Prompt field",
          sublabel: "Field with the text of the prompt",
          type: "String",
          required: true,
          attributes: { options: [...textFields, "Formula"] },
        },
        {
          name: "prompt_formula",
          label: "Prompt formula",
          type: "String",
          showIf: { prompt_field: "Formula" },
        },
        {
          name: "answer_field",
          label: "Answer field",
          sublabel: "Output field will be set to the generated answer",
          type: "String",
          required: true,
          attributes: { options: textFields },
        },
        {
          name: "existing_page_field",
          label: "Existing page name field",
          sublabel:
            "Optional text field storing the name of the page to update",
          type: "String",
          attributes: { options: textFields },
        },
        {
          name: "design_image_field",
          label: "Design image field",
          sublabel:
            "Optional file/image field containing a reference design supplied by the user",
          type: "String",
          attributes: { options: fileFields },
        },
        {
          name: "feedback_image_field",
          label: "Feedback image field",
          sublabel:
            "Optional file/image field with annotated feedback screenshots to consider during updates",
          type: "String",
          attributes: { options: fileFields },
        },
        //  ...override_fields,
      ];
    }
  },
  run: async ({
    row,
    table,
    user,
    mode,
    configuration: {
      page_name,
      prompt_field,
      prompt_formula,
      prompt_template,
      answer_field,
      image_prompt,
      design_image_expression,
      feedback_image_expression,
      design_image_field,
      feedback_image_field,
      existing_page_field,
      existing_page_name,
      existing_page_html,
      chat_history_field,
      convert_to_saltcorn,
      model,
    },
  }) => {
    let prompt;
    if (mode === "workflow") prompt = interpolate(prompt_template, row, user);
    else if (prompt_field === "Formula")
      prompt = eval_expression(
        prompt_formula,
        row,
        user,
        "copilot_generate_page prompt formula",
      );
    else prompt = row[prompt_field];

    const resolvedExistingName = normalizeName(
      mode === "workflow"
        ? existing_page_name
          ? eval_expression(
              existing_page_name,
              row,
              user,
              "copilot_generate_page existing page name",
            )
          : null
        : existing_page_field
          ? row?.[existing_page_field]
          : null,
    );
    const existingAssets = resolvedExistingName
      ? await loadExistingPageAssets(resolvedExistingName)
      : { page: null, html: null };

    let manualExistingHtml;
    if (existing_page_html) {
      manualExistingHtml = eval_expression(
        existing_page_html,
        row,
        user,
        "copilot_generate_page existing page html",
      );
    }
    const existingHtmlForPrompt = manualExistingHtml || existingAssets.html;
    if (existingHtmlForPrompt) {
      const label = resolvedExistingName ? ` ${resolvedExistingName}` : "";
      prompt = `This is the HTML code for the existing page${label} you should edit:\n\n\`\`\`html\n${existingHtmlForPrompt}\n\`\`\`\n\n${prompt}`;
    }

    const chatMessages = [];
    if (mode === "workflow") {
      const referenceImages = await gatherImagesFromExpression(
        image_prompt,
        row,
        user,
        "copilot_generate_page image prompt",
      );
      chatMessages.push(
        ...buildImageMessages(referenceImages, "Reference image"),
      );
      const designImages = await gatherImagesFromExpression(
        design_image_expression,
        row,
        user,
        "copilot_generate_page design image",
      );
      chatMessages.push(
        ...buildImageMessages(designImages, "Design reference"),
      );
      const feedbackImages = await gatherImagesFromExpression(
        feedback_image_expression,
        row,
        user,
        "copilot_generate_page feedback image",
      );
      chatMessages.push(
        ...buildImageMessages(feedbackImages, "Feedback reference"),
      );
    } else if (row) {
      chatMessages.push(
        ...buildImageMessages(
          await gatherImageDataFromValue(row[design_image_field]),
          "Design reference",
        ),
      );
      chatMessages.push(
        ...buildImageMessages(
          await gatherImageDataFromValue(row[feedback_image_field]),
          "Feedback reference",
        ),
      );
    }
    const chat = chatMessages.length ? chatMessages : undefined;

    const systemPrompt = await GeneratePage.system_prompt();
    const tools = [
      {
        type: "function",
        function: {
          name: GeneratePage.function_name,
          description: GeneratePage.description,
          parameters: await GeneratePage.json_schema(),
        },
      },
    ];
    const { llm_generate } = getState().functions;
    const llmOptions = {
      tools,
      chat,
      systemPrompt,
      ...(model ? { model } : {}),
    };
    const initial_ans = await llm_generate.run(prompt, llmOptions);
    const initial_info =
      initial_ans.tool_calls[0].input ||
      JSON.parse(initial_ans.tool_calls[0].function.arguments);
    const full = await GeneratePage.follow_on_generate(initial_info);
    const prompt_part_2 = convert_to_saltcorn
      ? `Only generate the inner part of the body. 
      Do not include the top menu. Generate the HTML that comes below the navbar menu.
      if you want to change the overall styling of the page, include a <style> element where you can change styles with CSS rules or CSS variables.`
      : `If you need to include the standard bootstrap CSS and javascript files, they are available as:

      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB" crossorigin="anonymous">

      and 

      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js" integrity="sha384-FKyoEForCGlyvwx9Hj09JcYn3nv7wiPVlz7YYwJrWVcXK/BmnVDxM+D2scQbITxI" crossorigin="anonymous"></script>`;
    const generationPrompt = `${prompt}

The page title is: ${initial_info.title}.
Further page description: ${initial_info.description}.

Generate the HTML for the web page using the Bootstrap 5 CSS framework.

${prompt_part_2}

Just generate HTML code, do not wrap in markdown code tags`;
    const page_html = await llm_generate.run(generationPrompt, {
      debugResult: true,
      chat,
      ...(model ? { model } : {}),
      response_format: full.response_schema
        ? {
            type: "json_schema",
            json_schema: {
              name: "generate_page",
              schema: full.response_schema,
            },
          }
        : undefined,
    });

    const requestedName = page_name ? interpolate(page_name, row, user) : "";
    const targetPageName = normalizeName(
      requestedName || resolvedExistingName || "",
    );
    const updatingExisting =
      targetPageName &&
      resolvedExistingName &&
      targetPageName === resolvedExistingName &&
      existingAssets.page;

    if (targetPageName) {
      let layout;
      if (convert_to_saltcorn) {
        layout = parseHTML(page_html, true);
        await upsertHtmlPreviewPage(
          `${targetPageName}_html`,
          wrapExample(page_html),
          initial_info.title,
          initial_info.description,
          user,
        );
      } else {
        const file = await File.from_contents(
          `${targetPageName}.html`,
          "text/html",
          page_html,
          user.id,
          100,
        );
        layout = { html_file: file.path_to_serve };
      }

      const pagePayload = {
        title: initial_info.title,
        description: initial_info.description,
        layout,
      };

      if (updatingExisting) {
        await existingAssets.page.update(pagePayload);
        refreshPagesSoon();
      } else {
        await Page.create({
          name: targetPageName,
          min_role: 100,
          ...pagePayload,
        });
        refreshPagesSoon();
      }
    }

    const upd = answer_field ? { [answer_field]: page_html } : {};
    if (mode === "workflow") return upd;
    else if (answer_field) await table.updateRow(upd, row[table.pk_name]);
  },
};

const wrapExample = (inner) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Artisan Goat Cheese.</title>
  <meta name="description" content="Handcrafted, small-batch goat cheese made from ethically sourced milk. Farm-to-table flavors with aged, tangy, and creamy varieties. Available online and at select markets, with subscription options and artisan pairings." />
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB" crossorigin="anonymous">
  <style>
    :root {
      --brand: #7a7a4a;
    }
    body {
      background-color: #fff;
    }
    /* Hero styling */
    #home {
      padding-top: 2rem;
      padding-bottom: 2rem;
    }
    .hero {
      background: linear-gradient(135deg, #f7f4ef 0%, #ffffff 60%);
      border-bottom: 1px solid #eee;
    }
    .hero-img {
      max-height: 420px;
      object-fit: cover;
      width: 100%;
      border-radius: 0.5rem;
      border: 1px solid #eee;
    }
    /* Card image sizing for consistency */
    .card-img-top {
      height: 180px;
      object-fit: cover;
    }
  </style>
</head>
<body>

  <!-- Navbar -->
  <nav class="navbar navbar-expand-lg navbar-light bg-white sticky-top shadow-sm" aria-label="Main navigation">
    <div class="container">
      <a class="navbar-brand fw-semibold" href="#home">Artisan Goat Cheese</a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMenu" aria-controls="navMenu" aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="navMenu">
        <ul class="navbar-nav ms-auto mb-2 mb-lg-0">
          <li class="nav-item"><a class="nav-link active" aria-current="page" href="#home">Home</a></li>
          <li class="nav-item"><a class="nav-link" href="#products">Cheeses</a></li>
          <li class="nav-item"><a class="nav-link" href="#subscription">Subscriptions</a></li>
          <li class="nav-item"><a class="nav-link" href="#markets">Markets</a></li>
          <li class="nav-item"><a class="nav-link" href="#pairings">Pairings</a></li>
          <li class="nav-item"><a class="nav-link" href="#about">About</a></li>
        </ul>
      </div>
    </div>
     </nav>

    ${inner}
    
  <!-- Bootstrap JS -->
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js" integrity="sha384-FKyoEForCGlyvwx9Hj09JcYn3nv7wiPVlz7YYwJrWVcXK/BmnVDxM+D2scQbITxI" crossorigin="anonymous"></script>
</body>
</html>
    `;
