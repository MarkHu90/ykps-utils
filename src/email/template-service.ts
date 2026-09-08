export interface EmailTemplateContent {
  subject: string;
  html: string;
  text: string;
}

export interface EmailTemplateDefinition {
  id: string;
  defaultLocale: string;
  locales: Readonly<Record<string, EmailTemplateContent>>;
}

export type EmailTemplateVariables = Readonly<
  Record<string, string | number | boolean>
>;

export interface RenderedEmailTemplate extends EmailTemplateContent {
  templateId: string;
  locale: string;
}

export class EmailTemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailTemplateValidationError";
  }
}

export class EmailTemplateService {
  private readonly templates: ReadonlyMap<string, ValidatedTemplate>;

  constructor(definitions: readonly EmailTemplateDefinition[]) {
    const templates = new Map<string, ValidatedTemplate>();

    for (const definition of definitions) {
      const validated = validateDefinition(definition);
      if (templates.has(validated.id)) {
        throw new Error(`Duplicate email template id: ${validated.id}.`);
      }
      templates.set(validated.id, validated);
    }

    this.templates = templates;
  }

  render(
    templateId: string,
    locale?: string,
    variables: EmailTemplateVariables = {},
  ): RenderedEmailTemplate {
    const template = this.templates.get(templateId);
    if (template === undefined) {
      throw new EmailTemplateValidationError(
        `Unknown email template: ${templateId}.`,
      );
    }

    const resolvedLocale = resolveLocale(template, locale);
    const content = template.locales.get(resolvedLocale)!;
    validateVariables(template.variableNames, variables);

    return {
      templateId,
      locale: resolvedLocale,
      subject: interpolate(content.subject, variables, false),
      html: interpolate(content.html, variables, true),
      text: interpolate(content.text, variables, false),
    };
  }
}

interface ValidatedTemplate {
  id: string;
  defaultLocale: string;
  locales: ReadonlyMap<string, EmailTemplateContent>;
  localeLookup: ReadonlyMap<string, string>;
  variableNames: ReadonlySet<string>;
}

const TEMPLATE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const LOCALE_PATTERN = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/;
const VARIABLE_PATTERN = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g;

function validateDefinition(definition: EmailTemplateDefinition): ValidatedTemplate {
  if (!TEMPLATE_ID_PATTERN.test(definition.id)) {
    throw new Error(`Invalid email template id: ${definition.id}.`);
  }
  if (!LOCALE_PATTERN.test(definition.defaultLocale)) {
    throw new Error(
      `Invalid default locale for email template ${definition.id}: ${definition.defaultLocale}.`,
    );
  }

  const locales = new Map<string, EmailTemplateContent>();
  const localeLookup = new Map<string, string>();
  let variableNames: ReadonlySet<string> | undefined;

  for (const [locale, content] of Object.entries(definition.locales)) {
    if (!LOCALE_PATTERN.test(locale)) {
      throw new Error(`Invalid locale for email template ${definition.id}: ${locale}.`);
    }
    validateTemplateContent(definition.id, locale, content);

    const normalizedLocale = locale.toLowerCase();
    if (localeLookup.has(normalizedLocale)) {
      throw new Error(
        `Duplicate locale for email template ${definition.id}: ${locale}.`,
      );
    }

    const contentVariables = collectVariables(content);
    if (variableNames !== undefined && !setsEqual(variableNames, contentVariables)) {
      throw new Error(
        `All locales for email template ${definition.id} must use the same variables.`,
      );
    }

    variableNames = contentVariables;
    locales.set(locale, { ...content });
    localeLookup.set(normalizedLocale, locale);
  }

  const defaultLocale = localeLookup.get(definition.defaultLocale.toLowerCase());
  if (defaultLocale === undefined) {
    throw new Error(
      `Default locale ${definition.defaultLocale} is missing from email template ${definition.id}.`,
    );
  }

  return {
    id: definition.id,
    defaultLocale,
    locales,
    localeLookup,
    variableNames: variableNames ?? new Set(),
  };
}

function validateTemplateContent(
  templateId: string,
  locale: string,
  content: EmailTemplateContent,
): void {
  for (const [field, value] of Object.entries(content)) {
    if (value.length === 0) {
      throw new Error(
        `${field} must not be empty for email template ${templateId} locale ${locale}.`,
      );
    }
  }
}

function collectVariables(content: EmailTemplateContent): ReadonlySet<string> {
  const names = new Set<string>();
  for (const value of [content.subject, content.html, content.text]) {
    for (const match of value.matchAll(VARIABLE_PATTERN)) {
      names.add(match[1]!);
    }
  }
  return names;
}

function resolveLocale(template: ValidatedTemplate, requested?: string): string {
  if (requested === undefined) {
    return template.defaultLocale;
  }
  if (!LOCALE_PATTERN.test(requested)) {
    throw new EmailTemplateValidationError(`Invalid email template locale: ${requested}.`);
  }

  const exactLocale = template.localeLookup.get(requested.toLowerCase());
  if (exactLocale !== undefined) {
    return exactLocale;
  }

  const language = requested.split("-")[0]!.toLowerCase();
  const languageLocale = template.localeLookup.get(language);
  if (languageLocale !== undefined) {
    return languageLocale;
  }

  throw new EmailTemplateValidationError(
    `Email template ${template.id} does not support locale ${requested}.`,
  );
}

function validateVariables(
  expectedNames: ReadonlySet<string>,
  variables: EmailTemplateVariables,
): void {
  const actualNames = new Set(Object.keys(variables));
  const missing = [...expectedNames].filter((name) => !actualNames.has(name));
  const unexpected = [...actualNames].filter((name) => !expectedNames.has(name));

  if (missing.length > 0) {
    throw new EmailTemplateValidationError(
      `Missing email template variables: ${missing.sort().join(", ")}.`,
    );
  }
  if (unexpected.length > 0) {
    throw new EmailTemplateValidationError(
      `Unexpected email template variables: ${unexpected.sort().join(", ")}.`,
    );
  }
}

function interpolate(
  value: string,
  variables: EmailTemplateVariables,
  escapeHtmlValues: boolean,
): string {
  return value.replace(VARIABLE_PATTERN, (_placeholder, name: string) => {
    const replacement = String(variables[name]!);
    return escapeHtmlValues ? escapeHtml(replacement) : replacement;
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}