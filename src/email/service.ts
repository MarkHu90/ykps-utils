import {
  EmailTemplateService,
  EmailTemplateValidationError,
  type EmailTemplateVariables,
  type RenderedEmailTemplate,
} from "./template-service.js";

export const EMAIL_LIMITS = {
  maxRecipients: 100,
  maxSubjectCharacters: 998,
  maxBodyCharacters: 1_000_000,
  maxDisplayNameCharacters: 200,
  maxAttachments: 20,
  maxAttachmentBytes: 10 * 1024 * 1024,
  maxTotalAttachmentBytes: 20 * 1024 * 1024,
  maxAttachmentFilenameCharacters: 255,
  maxRequestBodyBytes: 30 * 1024 * 1024,
} as const;

export interface EmailAttachment {
  filename: string;
  contentBase64: string;
  contentType?: string;
  contentId?: string;
  disposition?: "attachment" | "inline";
}

export interface SendEmailCommand {
  from?: string;
  to: readonly string[];
  replyTo?: string;
  subject?: string;
  body?: string;
  isBodyHtml?: boolean;
  html?: string;
  text?: string;
  displayName?: string;
  templateId?: string;
  locale?: string;
  variables?: EmailTemplateVariables;
  attachments?: readonly EmailAttachment[];
}

export interface ProviderEmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  contentId?: string;
  disposition: "attachment" | "inline";
}

export interface ProviderSendEmailRequest {
  from: string;
  to: readonly string[];
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  displayName?: string;
  attachments: readonly ProviderEmailAttachment[];
}

export interface ProviderSendEmailResult {
  messageId: string;
  accepted: readonly string[];
  rejected: readonly string[];
}

export interface EmailProvider {
  readonly name: string;
  send(request: ProviderSendEmailRequest): Promise<ProviderSendEmailResult>;
}

export interface SendEmailResult extends ProviderSendEmailResult {
  provider: string;
}

export interface PreviewEmailTemplateCommand {
  templateId: string;
  locale?: string;
  variables?: EmailTemplateVariables;
}

export class EmailError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_REQUEST" | "PROVIDER_ERROR" | "PROVIDER_NOT_CONFIGURED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class EmailValidationError extends EmailError {
  constructor(message: string) {
    super(message, "INVALID_REQUEST");
  }
}

export class EmailProviderError extends EmailError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "PROVIDER_ERROR", options);
  }
}

export class EmailService {
  constructor(
    private readonly provider?: EmailProvider,
    private readonly defaultFrom?: string,
    private readonly templateService?: EmailTemplateService,
  ) {}

  async send(command: SendEmailCommand): Promise<SendEmailResult> {
    if (this.provider === undefined) {
      throw new EmailError(
        "SMTP email is not configured.",
        "PROVIDER_NOT_CONFIGURED",
      );
    }

    const renderedCommand = command.templateId === undefined
      ? command
      : this.applyTemplate(command);
    const request = normalizeCommand(renderedCommand, this.defaultFrom);
    const result = await this.provider.send(request);

    return { provider: this.provider.name, ...result };
  }

  preview(command: PreviewEmailTemplateCommand): RenderedEmailTemplate {
    return this.renderTemplate(command);
  }

  private applyTemplate(command: SendEmailCommand): SendEmailCommand {
    const rendered = this.renderTemplate({
      templateId: command.templateId!,
      ...(command.locale === undefined ? {} : { locale: command.locale }),
      ...(command.variables === undefined ? {} : { variables: command.variables }),
    });

    return {
      to: command.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(command.from === undefined ? {} : { from: command.from }),
      ...(command.replyTo === undefined ? {} : { replyTo: command.replyTo }),
      ...(command.displayName === undefined ? {} : { displayName: command.displayName }),
      ...(command.attachments === undefined ? {} : { attachments: command.attachments }),
    };
  }

  private renderTemplate(command: PreviewEmailTemplateCommand): RenderedEmailTemplate {
    if (this.templateService === undefined) {
      throw new EmailValidationError("Email templates are not configured.");
    }

    try {
      return this.templateService.render(
        command.templateId,
        command.locale,
        command.variables,
      );
    } catch (error) {
      if (error instanceof EmailTemplateValidationError) {
        throw new EmailValidationError(error.message);
      }
      throw error;
    }
  }
}

function normalizeCommand(
  command: SendEmailCommand,
  defaultFrom?: string,
): ProviderSendEmailRequest {
  const fromValue = command.from ?? defaultFrom;
  if (fromValue === undefined) {
    throw new EmailValidationError(
      "from is required when no default SMTP username is configured.",
    );
  }

  const from = normalizeEmail(fromValue, "from");
  const to = [...new Set(command.to.map((address) => normalizeEmail(address, "to")))];
  const displayName = command.displayName?.trim();

  if (to.length === 0) {
    throw new EmailValidationError("At least one recipient is required.");
  }
  if (to.length > EMAIL_LIMITS.maxRecipients) {
    throw new EmailValidationError(
      `A message can have at most ${EMAIL_LIMITS.maxRecipients} recipients.`,
    );
  }
  if (displayName !== undefined) {
    validateHeaderValue(
      displayName,
      "displayName",
      EMAIL_LIMITS.maxDisplayNameCharacters,
    );
  }

  const content = normalizeContent(command);
  const attachments = normalizeAttachments(command.attachments ?? []);

  return {
    from,
    to,
    subject: content.subject,
    ...(content.html === undefined ? {} : { html: content.html }),
    ...(content.text === undefined ? {} : { text: content.text }),
    ...(command.replyTo === undefined
      ? {}
      : { replyTo: normalizeEmail(command.replyTo, "replyTo") }),
    ...(displayName === undefined ? {} : { displayName }),
    attachments,
  };
}

function normalizeContent(
  command: SendEmailCommand,
): { subject: string; html?: string; text?: string } {
  if (command.templateId !== undefined) {
    throw new EmailValidationError("Template email content was not rendered.");
  }
  if (command.subject === undefined) {
    throw new EmailValidationError("subject is required for a direct email.");
  }

  const hasLegacyBody = command.body !== undefined;
  const hasMultipartBody = command.html !== undefined || command.text !== undefined;
  if (hasLegacyBody && hasMultipartBody) {
    throw new EmailValidationError("body cannot be combined with html or text.");
  }

  const html = hasLegacyBody && (command.isBodyHtml ?? true)
    ? command.body
    : command.html;
  const text = hasLegacyBody && !(command.isBodyHtml ?? true)
    ? command.body
    : command.text;
  validateHeaderValue(command.subject, "subject", EMAIL_LIMITS.maxSubjectCharacters);
  validateBody(html, "html");
  validateBody(text, "text");

  if (html === undefined && text === undefined) {
    throw new EmailValidationError("At least one of body, html, or text is required.");
  }

  return {
    subject: command.subject.trim(),
    ...(html === undefined ? {} : { html }),
    ...(text === undefined ? {} : { text }),
  };
}

function normalizeAttachments(
  attachments: readonly EmailAttachment[],
): ProviderEmailAttachment[] {
  if (attachments.length > EMAIL_LIMITS.maxAttachments) {
    throw new EmailValidationError(
      `A message can have at most ${EMAIL_LIMITS.maxAttachments} attachments.`,
    );
  }

  let totalBytes = 0;
  return attachments.map((attachment, index) => {
    const fieldName = `attachments[${index}]`;
    const filename = attachment.filename.trim();
    validateHeaderValue(
      filename,
      `${fieldName}.filename`,
      EMAIL_LIMITS.maxAttachmentFilenameCharacters,
    );
    validateOptionalHeaderValue(attachment.contentType, `${fieldName}.contentType`);
    validateOptionalHeaderValue(attachment.contentId, `${fieldName}.contentId`);

    if (attachment.disposition === "inline" && attachment.contentId === undefined) {
      throw new EmailValidationError(
        `${fieldName}.contentId is required for an inline attachment.`,
      );
    }

    const content = decodeBase64(attachment.contentBase64, fieldName);
    if (content.byteLength > EMAIL_LIMITS.maxAttachmentBytes) {
      throw new EmailValidationError(
        `${fieldName} exceeds the ${EMAIL_LIMITS.maxAttachmentBytes} byte limit.`,
      );
    }
    totalBytes += content.byteLength;
    if (totalBytes > EMAIL_LIMITS.maxTotalAttachmentBytes) {
      throw new EmailValidationError(
        `Attachments exceed the ${EMAIL_LIMITS.maxTotalAttachmentBytes} byte total limit.`,
      );
    }

    return {
      filename,
      content,
      disposition: attachment.disposition ?? "attachment",
      ...(attachment.contentType === undefined
        ? {}
        : { contentType: attachment.contentType.trim() }),
      ...(attachment.contentId === undefined
        ? {}
        : { contentId: attachment.contentId.trim() }),
    };
  });
}

function validateBody(value: string | undefined, fieldName: string): void {
  if (value === undefined) {
    return;
  }
  if (value.length === 0 || value.length > EMAIL_LIMITS.maxBodyCharacters) {
    throw new EmailValidationError(
      `${fieldName} must contain between 1 and ${EMAIL_LIMITS.maxBodyCharacters} characters.`,
    );
  }
}

function validateHeaderValue(value: string, fieldName: string, maxLength: number): void {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new EmailValidationError(
      `${fieldName} must contain between 1 and ${maxLength} characters.`,
    );
  }
  if (containsNewline(normalized)) {
    throw new EmailValidationError(`${fieldName} must not contain newline characters.`);
  }
}

function validateOptionalHeaderValue(value: string | undefined, fieldName: string): void {
  if (value !== undefined) {
    validateHeaderValue(value, fieldName, EMAIL_LIMITS.maxSubjectCharacters);
  }
}

function decodeBase64(value: string, fieldName: string): Buffer {
  if (value.length === 0 || value.length % 4 !== 0) {
    throw new EmailValidationError(`${fieldName}.contentBase64 must be valid Base64.`);
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedBytes = (value.length / 4) * 3 - padding;
  if (decodedBytes > EMAIL_LIMITS.maxAttachmentBytes) {
    throw new EmailValidationError(
      `${fieldName} exceeds the ${EMAIL_LIMITS.maxAttachmentBytes} byte limit.`,
    );
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new EmailValidationError(`${fieldName}.contentBase64 must be valid Base64.`);
  }

  return Buffer.from(value, "base64");
}

function normalizeEmail(value: string, fieldName: string): string {
  const normalized = value.trim();
  const atIndex = normalized.lastIndexOf("@");
  if (
    normalized.length > 254 ||
    atIndex <= 0 ||
    atIndex === normalized.length - 1 ||
    containsNewline(normalized)
  ) {
    throw new EmailValidationError(`${fieldName} must be a valid email address.`);
  }

  return normalized;
}

function containsNewline(value: string): boolean {
  return value.includes("\r") || value.includes("\n");
}