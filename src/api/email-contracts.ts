import { z } from "zod/v4";

import {
  EMAIL_LIMITS,
  type PreviewEmailTemplateCommand,
  type SendEmailCommand,
} from "../email/service.js";

const emailAddressSchema = z.string().trim().email().max(254);
const headerValueSchema = (maxLength: number) => z
  .string()
  .trim()
  .min(1)
  .max(maxLength)
  .refine((value) => !/[\r\n]/.test(value), "Must not contain newline characters.");
const templateVariablesSchema = z.record(
  z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  z.union([z.string(), z.number(), z.boolean()]),
);
const attachmentSchema = z.object({
  filename: headerValueSchema(EMAIL_LIMITS.maxAttachmentFilenameCharacters),
  contentBase64: z.string().min(1).max(
    Math.ceil(EMAIL_LIMITS.maxAttachmentBytes / 3) * 4,
  ),
  contentType: headerValueSchema(EMAIL_LIMITS.maxSubjectCharacters).optional(),
  contentId: headerValueSchema(EMAIL_LIMITS.maxSubjectCharacters).optional(),
  disposition: z.enum(["attachment", "inline"]).default("attachment"),
}).strict().superRefine((attachment, context) => {
  if (attachment.disposition === "inline" && attachment.contentId === undefined) {
    context.addIssue({
      code: "custom",
      path: ["contentId"],
      message: "Required for an inline attachment.",
    });
  }
});

const commonSendFields = {
  from: emailAddressSchema.optional(),
  to: z.union([
    emailAddressSchema,
    z.array(emailAddressSchema).min(1).max(EMAIL_LIMITS.maxRecipients),
  ]),
  replyTo: emailAddressSchema.optional(),
  displayName: headerValueSchema(EMAIL_LIMITS.maxDisplayNameCharacters).optional(),
  attachments: z.array(attachmentSchema).max(EMAIL_LIMITS.maxAttachments).default([]),
};

const directEmailSchema = z.object({
  ...commonSendFields,
  subject: headerValueSchema(EMAIL_LIMITS.maxSubjectCharacters),
  body: z.string().min(1).max(EMAIL_LIMITS.maxBodyCharacters).optional(),
  isBodyHtml: z.boolean().default(true),
  html: z.string().min(1).max(EMAIL_LIMITS.maxBodyCharacters).optional(),
  text: z.string().min(1).max(EMAIL_LIMITS.maxBodyCharacters).optional(),
}).strict().superRefine((request, context) => {
  if (request.body !== undefined && (request.html !== undefined || request.text !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["body"],
      message: "Cannot be combined with html or text.",
    });
  }
  if (request.body === undefined && request.html === undefined && request.text === undefined) {
    context.addIssue({
      code: "custom",
      path: ["body"],
      message: "At least one of body, html, or text is required.",
    });
  }
});

const templateEmailSchema = z.object({
  ...commonSendFields,
  templateId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
  locale: z.string().regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/).optional(),
  variables: templateVariablesSchema.default({}),
}).strict();

export const sendEmailRequestSchema = z.union([
  templateEmailSchema,
  directEmailSchema,
]);

export const previewEmailRequestSchema = z.object({
  templateId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
  locale: z.string().regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/).optional(),
  variables: templateVariablesSchema.default({}),
}).strict();

export type SendEmailRequest = z.infer<typeof sendEmailRequestSchema>;
export type PreviewEmailRequest = z.infer<typeof previewEmailRequestSchema>;

export function toSendEmailCommand(request: SendEmailRequest): SendEmailCommand {
  const attachments = request.attachments.map((attachment) => ({
    filename: attachment.filename,
    contentBase64: attachment.contentBase64,
    disposition: attachment.disposition,
    ...(attachment.contentType === undefined
      ? {}
      : { contentType: attachment.contentType }),
    ...(attachment.contentId === undefined ? {} : { contentId: attachment.contentId }),
  }));

  return {
    to: typeof request.to === "string" ? [request.to] : request.to,
    ...(request.from === undefined ? {} : { from: request.from }),
    ...(request.replyTo === undefined ? {} : { replyTo: request.replyTo }),
    ...(request.displayName === undefined ? {} : { displayName: request.displayName }),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...("templateId" in request
      ? {
          templateId: request.templateId,
          variables: request.variables,
          ...(request.locale === undefined ? {} : { locale: request.locale }),
        }
      : {
          subject: request.subject,
          isBodyHtml: request.isBodyHtml,
          ...(request.body === undefined ? {} : { body: request.body }),
          ...(request.html === undefined ? {} : { html: request.html }),
          ...(request.text === undefined ? {} : { text: request.text }),
        }),
  };
}

export function toPreviewEmailTemplateCommand(
  request: PreviewEmailRequest,
): PreviewEmailTemplateCommand {
  return {
    templateId: request.templateId,
    variables: request.variables,
    ...(request.locale === undefined ? {} : { locale: request.locale }),
  };
}