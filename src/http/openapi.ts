export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "YKPS Utils API",
    version: "0.1.0",
    description:
      "YKPS utility APIs for translation, email, and event-routed notifications, exposed through REST and MCP.",
  },
  servers: [{ url: "/" }],
  paths: {
    "/": {
      get: {
        operationId: "getServiceInfo",
        summary: "Get YKPS Utils service information",
        responses: { "200": { description: "Service information and endpoints." } },
      },
    },
    "/health": {
      get: {
        operationId: "getHealth",
        summary: "Check service health",
        responses: {
          "200": {
            description: "The service process is healthy.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { const: "ok" } },
                  required: ["status"],
                },
              },
            },
          },
        },
      },
    },
    "/v1/translate": {
      get: {
        operationId: "getTranslateUsage",
        summary: "Get translation endpoint usage information",
        responses: { "200": { description: "POST request usage information." } },
      },
      post: {
        operationId: "translateText",
        summary: "Translate one or more texts",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TranslateRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Translation completed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TranslateResponse" },
              },
            },
          },
          "400": { description: "Invalid request." },
          "401": { description: "Missing or invalid bearer token." },
          "502": { description: "The translation provider failed." },
        },
      },
    },
    "/v1/email/send": {
      get: {
        operationId: "getSendEmailUsage",
        summary: "Get email endpoint usage information",
        responses: { "200": { description: "POST request usage information." } },
      },
      post: {
        operationId: "sendEmail",
        summary: "Send an email through Aliyun Direct Mail SMTP",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SendEmailRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Email accepted by the SMTP server.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SendEmailResponse" },
              },
            },
          },
          "400": { description: "Invalid request." },
          "401": { description: "Missing or invalid bearer token." },
          "502": { description: "The SMTP provider failed." },
          "503": { description: "SMTP email is not configured." },
        },
      },
    },
    "/v1/email/preview": {
      get: {
        operationId: "getPreviewEmailUsage",
        summary: "Get email template preview endpoint usage information",
        responses: { "200": { description: "POST request usage information." } },
      },
      post: {
        operationId: "previewEmailTemplate",
        summary: "Render an email template without sending it",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PreviewEmailRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Rendered HTML and plain-text template preview.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PreviewEmailResponse" },
              },
            },
          },
          "400": { description: "Invalid template, locale, or variables." },
          "401": { description: "Missing or invalid bearer token." },
        },
      },
    },
    "/v1/notifications/send": {
      get: {
        operationId: "getSendNotificationUsage",
        summary: "Get notification endpoint usage information",
        responses: { "200": { description: "POST request usage information." } },
      },
      post: {
        operationId: "sendNotification",
        summary: "Route an event notification to configured channels",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SendNotificationRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Notification dispatch completed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SendNotificationResponse" },
              },
            },
          },
          "400": { description: "Invalid request or idempotency key conflict." },
          "401": { description: "Missing or invalid bearer token." },
          "422": { description: "No route matches the event type." },
          "503": { description: "Notifications are not configured." },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      TranslateRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: {
            oneOf: [
              { type: "string", minLength: 1, maxLength: 10_000 },
              {
                type: "array",
                minItems: 1,
                maxItems: 100,
                items: { type: "string", minLength: 1, maxLength: 10_000 },
              },
            ],
          },
          targetLanguage: {
            type: "string",
            examples: ["zh-Hans"],
            description: "Explicit target language; requires sourceLanguage.",
          },
          sourceLanguage: {
            type: "string",
            examples: ["en"],
            description: "Explicit source language; requires targetLanguage.",
          },
          textType: { type: "string", enum: ["plain", "html"], default: "plain" },
        },
        required: ["text"],
        dependentRequired: {
          sourceLanguage: ["targetLanguage"],
          targetLanguage: ["sourceLanguage"],
        },
      },
      TranslateResponse: {
        type: "object",
        properties: {
          requestId: { type: "string" },
          provider: { type: "string" },
          targetLanguage: { type: "string" },
          translations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sourceText: { type: "string" },
                text: { type: "string" },
                detectedSourceLanguage: { type: "string" },
              },
              required: ["sourceText", "text"],
            },
          },
        },
        required: ["requestId", "provider", "targetLanguage", "translations"],
      },
      SendEmailRequest: {
        oneOf: [
          { $ref: "#/components/schemas/DirectEmailRequest" },
          { $ref: "#/components/schemas/TemplateEmailRequest" },
        ],
      },
      DirectEmailRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          from: {
            type: "string",
            format: "email",
            description: "Sender address. Defaults to SMTP_USERNAME when omitted.",
          },
          to: {
            oneOf: [
              { type: "string", format: "email" },
              {
                type: "array",
                minItems: 1,
                maxItems: 100,
                items: { type: "string", format: "email" },
              },
            ],
          },
          replyTo: { type: "string", format: "email" },
          subject: { type: "string", minLength: 1, maxLength: 998 },
          body: { type: "string", minLength: 1, maxLength: 1_000_000 },
          isBodyHtml: { type: "boolean", default: true },
          html: { type: "string", minLength: 1, maxLength: 1_000_000 },
          text: { type: "string", minLength: 1, maxLength: 1_000_000 },
          displayName: { type: "string", minLength: 1, maxLength: 200 },
          attachments: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/EmailAttachment" },
          },
        },
        required: ["to", "subject"],
        description: "Provide body for a single-part email, or html and/or text for alternatives.",
      },
      TemplateEmailRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          from: {
            type: "string",
            format: "email",
            description: "Sender address. Defaults to SMTP_USERNAME when omitted.",
          },
          to: {
            oneOf: [
              { type: "string", format: "email" },
              {
                type: "array",
                minItems: 1,
                maxItems: 100,
                items: { type: "string", format: "email" },
              },
            ],
          },
          replyTo: { type: "string", format: "email" },
          displayName: { type: "string", minLength: 1, maxLength: 200 },
          templateId: { type: "string", examples: ["welcome"] },
          locale: { type: "string", examples: ["zh-CN"] },
          variables: { $ref: "#/components/schemas/EmailTemplateVariables" },
          attachments: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/EmailAttachment" },
          },
        },
        required: ["to", "templateId"],
      },
      EmailAttachment: {
        type: "object",
        additionalProperties: false,
        properties: {
          filename: { type: "string", minLength: 1, maxLength: 255 },
          contentBase64: {
            type: "string",
            contentEncoding: "base64",
            description: "Base64 content, at most 10 MiB after decoding.",
          },
          contentType: { type: "string", examples: ["image/png"] },
          contentId: {
            type: "string",
            description: "Required when disposition is inline.",
          },
          disposition: {
            type: "string",
            enum: ["attachment", "inline"],
            default: "attachment",
          },
        },
        required: ["filename", "contentBase64"],
      },
      EmailTemplateVariables: {
        type: "object",
        additionalProperties: {
          oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
        },
      },
      PreviewEmailRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          templateId: { type: "string" },
          locale: { type: "string" },
          variables: { $ref: "#/components/schemas/EmailTemplateVariables" },
        },
        required: ["templateId"],
      },
      PreviewEmailResponse: {
        type: "object",
        properties: {
          requestId: { type: "string" },
          templateId: { type: "string" },
          locale: { type: "string" },
          subject: { type: "string" },
          html: { type: "string" },
          text: { type: "string" },
        },
        required: ["requestId", "templateId", "locale", "subject", "html", "text"],
      },
      SendEmailResponse: {
        type: "object",
        properties: {
          requestId: { type: "string" },
          provider: { type: "string" },
          messageId: { type: "string" },
          accepted: { type: "array", items: { type: "string" } },
          rejected: { type: "array", items: { type: "string" } },
        },
        required: ["requestId", "provider", "messageId", "accepted", "rejected"],
      },
      SendNotificationRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          eventType: { type: "string", minLength: 1, maxLength: 200 },
          message: { type: "string", minLength: 1, maxLength: 100_000 },
          title: { type: "string", minLength: 1, maxLength: 500 },
          priority: {
            type: "string",
            enum: ["low", "normal", "high", "critical"],
            default: "normal",
          },
          idempotencyKey: { type: "string", minLength: 1, maxLength: 200 },
          data: { type: "object", additionalProperties: true },
          timeoutMs: { type: "integer", minimum: 1, maximum: 120_000 },
          maxAttempts: { type: "integer", minimum: 1, maximum: 10 },
        },
        required: ["eventType", "message"],
      },
      SendNotificationResponse: {
        type: "object",
        properties: {
          requestId: { type: "string" },
          eventType: { type: "string" },
          priority: { type: "string", enum: ["low", "normal", "high", "critical"] },
          idempotencyKey: { type: "string" },
          duplicate: { type: "boolean" },
          channels: {
            type: "array",
            items: {
              type: "object",
              properties: {
                channelId: { type: "string" },
                channelType: {
                  type: "string",
                  enum: ["email", "webhook", "slack", "teams", "dingtalk", "wechat"],
                },
                provider: { type: "string" },
                status: { type: "string", enum: ["sent", "failed"] },
                attempts: { type: "integer" },
                messageId: { type: "string" },
                error: { type: "string" },
              },
              required: ["channelId", "channelType", "provider", "status", "attempts"],
            },
          },
        },
        required: ["requestId", "eventType", "priority", "duplicate", "channels"],
      },
    },
  },
} as const;