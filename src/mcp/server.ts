import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import {
  previewEmailRequestSchema,
  sendEmailRequestSchema,
  toPreviewEmailTemplateCommand,
  toSendEmailCommand,
} from "../api/email-contracts.js";
import {
  sendNotificationRequestSchema,
  toSendNotificationCommand,
} from "../api/notification-contracts.js";
import { toTranslateCommand, translateRequestSchema } from "../api/contracts.js";
import { EmailError, type EmailService } from "../email/service.js";
import {
  NotificationError,
  type NotificationService,
} from "../notification/service.js";
import {
  TranslationError,
  type TranslationService,
} from "../translation/service.js";

const translationOutputSchema = z.object({
  provider: z.string(),
  targetLanguage: z.string(),
  translations: z.array(
    z.object({
      sourceText: z.string(),
      text: z.string(),
      detectedSourceLanguage: z.string().optional(),
    }),
  ),
});

const emailOutputSchema = z.object({
  provider: z.string(),
  messageId: z.string(),
  accepted: z.array(z.string()),
  rejected: z.array(z.string()),
});

const emailPreviewOutputSchema = z.object({
  templateId: z.string(),
  locale: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

const notificationOutputSchema = z.object({
  eventType: z.string(),
  priority: z.enum(["low", "normal", "high", "critical"]),
  idempotencyKey: z.string().optional(),
  duplicate: z.boolean(),
  channels: z.array(z.object({
    channelId: z.string(),
    channelType: z.enum(["email", "webhook", "slack", "teams", "dingtalk", "wechat"]),
    provider: z.string(),
    status: z.enum(["sent", "failed"]),
    attempts: z.number().int(),
    messageId: z.string().optional(),
    error: z.string().optional(),
  })),
});

export function createYkpsMcpServer(
  translationService: TranslationService,
  emailService?: EmailService,
  notificationService?: NotificationService,
): McpServer {
  const server = new McpServer({
    name: "ykps-utils",
    version: "0.1.0",
  });

  server.registerTool(
    "translate_text",
    {
      title: "Translate text",
      description:
        "Translate one text or a batch. Omit sourceLanguage and targetLanguage to automatically translate Chinese to English or English to Simplified Chinese. Provide both fields to choose an explicit direction.",
      inputSchema: translateRequestSchema,
      outputSchema: translationOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (request) => {
      try {
        const result = await translationService.translate(toTranslateCommand(request));
        const output = {
          provider: result.provider,
          targetLanguage: result.targetLanguage,
          translations: result.translations.map((translation) => ({ ...translation })),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        const message =
          error instanceof TranslationError ? error.message : "An unexpected error occurred.";

        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    },
  );

  if (emailService !== undefined) {
    server.registerTool(
      "send_email",
      {
        title: "Send email",
        description:
          "Send a direct or templated email through Aliyun Direct Mail SMTP, including HTML and plain-text alternatives, attachments, and inline images.",
        inputSchema: sendEmailRequestSchema,
        outputSchema: emailOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (request) => {
        try {
          const result = await emailService.send(toSendEmailCommand(request));
          const output = {
            provider: result.provider,
            messageId: result.messageId,
            accepted: [...result.accepted],
            rejected: [...result.rejected],
          };

          return {
            content: [{ type: "text", text: JSON.stringify(output) }],
            structuredContent: output,
          };
        } catch (error) {
          const message =
            error instanceof EmailError ? error.message : "An unexpected error occurred.";

          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      },
    );

    server.registerTool(
      "preview_email",
      {
        title: "Preview email template",
        description:
          "Render a localized email template with validated variables without sending it.",
        inputSchema: previewEmailRequestSchema,
        outputSchema: emailPreviewOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (request) => {
        try {
          const output = emailService.preview(
            toPreviewEmailTemplateCommand(request),
          );
          return {
            content: [{ type: "text", text: JSON.stringify(output) }],
            structuredContent: output,
          };
        } catch (error) {
          const message =
            error instanceof EmailError ? error.message : "An unexpected error occurred.";

          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      },
    );
  }

  if (notificationService !== undefined) {
    server.registerTool(
      "send_notification",
      {
        title: "Send notification",
        description:
          "Send an event notification through configured channels. Routing selects email, Webhook, Slack, Teams, DingTalk, or WeCom without exposing vendors to the caller.",
        inputSchema: sendNotificationRequestSchema,
        outputSchema: notificationOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (request) => {
        try {
          const result = await notificationService.send(
            toSendNotificationCommand(request),
          );
          const output = {
            ...result,
            channels: result.channels.map((channel) => ({ ...channel })),
          };
          return {
            content: [{ type: "text", text: JSON.stringify(output) }],
            structuredContent: output,
          };
        } catch (error) {
          const message = error instanceof NotificationError
            ? error.message
            : "An unexpected error occurred.";
          return {
            isError: true,
            content: [{ type: "text", text: message }],
          };
        }
      },
    );
  }

  return server;
}