import { createMcpFastifyApp } from "@modelcontextprotocol/fastify";
import type { OpenAPIV3 } from "openapi-types";
import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

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
import { EMAIL_LIMITS, EmailError, EmailService } from "../email/service.js";
import {
  NotificationError,
  type NotificationService,
} from "../notification/service.js";
import {
  TranslationError,
  type TranslationService,
} from "../translation/service.js";
import { registerMcpHttpRoutes } from "../mcp/http.js";
import { createBearerAuthenticator } from "./auth.js";
import { openApiDocument } from "./openapi.js";

export interface HttpAppOptions {
  translationService: TranslationService;
  emailService?: EmailService;
  notificationService?: NotificationService;
  apiKeys: readonly string[];
  host?: string;
  allowedHosts?: readonly string[];
  allowedOrigins?: readonly string[];
}

export function createHttpApp(options: HttpAppOptions): FastifyInstance {
  const app = createMcpFastifyApp({
    host: options.host ?? "127.0.0.1",
    ...(options.allowedHosts === undefined
      ? {}
      : { allowedHosts: [...options.allowedHosts] }),
    ...(options.allowedOrigins === undefined
      ? {}
      : { allowedOrigins: [...options.allowedOrigins] }),
  });
  const authenticate = createBearerAuthenticator(options.apiKeys);
  const emailService = options.emailService ?? new EmailService();

  // Swagger UI：以静态模式复用现有 OpenAPI 文档，UI 挂在 /docs，
  // 插件在 /docs/json 暴露同一份规范（/openapi.json 保持不变）。
  app.register(swagger, {
    mode: "static",
    specification: {
      // openApiDocument 声明为 as const（深只读、含 3.1 字段），插件类型
      // 只接受可变的 3.0 文档，运行时仅做序列化，因此这里显式收窄。
      document: openApiDocument as unknown as OpenAPIV3.Document,
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/", async () => ({
    name: "YKPS Utils",
    apiVersion: "3.0",
    status: "ok",
    endpoints: {
      translate: "/v1/translate",
      sendEmail: "/v1/email/send",
      previewEmail: "/v1/email/preview",
      sendNotification: "/v1/notifications/send",
      mcp: "/mcp",
      openapi: "/openapi.json",
      health: "/health",
    },
  }));
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/openapi.json", async () => openApiDocument);
  app.get("/v1/email/send", async () => ({
    name: "SMTP Email API",
    operation: "sendEmail",
    method: "POST",
    authentication: "Authorization: Bearer <SERVICE_API_KEY>",
    contentType: "application/json",
    requestBody: {
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      body: "<p>Hello</p>",
      isBodyHtml: true,
      displayName: "Example Sender",
    },
    documentation: "/openapi.json",
  }));
  app.get("/v1/email/preview", async () => ({
    name: "Email Template Preview API",
    operation: "previewEmailTemplate",
    method: "POST",
    authentication: "Authorization: Bearer <SERVICE_API_KEY>",
    contentType: "application/json",
    requestBody: {
      templateId: "welcome",
      locale: "zh-CN",
      variables: { name: "小明" },
    },
    documentation: "/openapi.json",
  }));
  app.get("/v1/translate", async () => ({
    name: "YKPS Utils Translation API",
    operation: "translateText",
    method: "POST",
    authentication: "Authorization: Bearer <SERVICE_API_KEY>",
    contentType: "application/json",
    requestBody: {
      text: "Hello",
    },
    automaticMode:
      "Omit sourceLanguage and targetLanguage to translate Chinese to English or English to Simplified Chinese.",
    explicitMode:
      "Provide sourceLanguage and targetLanguage together to choose the translation direction.",
    documentation: "/openapi.json",
  }));
  app.get("/v1/notifications/send", async () => ({
    name: "Notification API",
    operation: "sendNotification",
    method: "POST",
    authentication: "Authorization: Bearer <SERVICE_API_KEY>",
    contentType: "application/json",
    requestBody: {
      eventType: "deployment.failed",
      title: "Deployment failed",
      message: "Production deployment failed.",
      priority: "critical",
      idempotencyKey: "deployment-42",
    },
    documentation: "/openapi.json",
  }));

  app.post("/v1/translate", { preHandler: authenticate }, async (request, reply) => {
    const parsedRequest = translateRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: parsedRequest.error.issues
            .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
            .join("; "),
          requestId: request.id,
        },
      });
    }

    const result = await options.translationService.translate(
      toTranslateCommand(parsedRequest.data),
    );
    return reply.code(200).send({ requestId: request.id, ...result });
  });

  app.post(
    "/v1/email/send",
    { preHandler: authenticate, bodyLimit: EMAIL_LIMITS.maxRequestBodyBytes },
    async (request, reply) => {
      const parsedRequest = sendEmailRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: {
            code: "INVALID_REQUEST",
            message: parsedRequest.error.issues
              .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
              .join("; "),
            requestId: request.id,
          },
        });
      }

      const result = await emailService.send(toSendEmailCommand(parsedRequest.data));
      return reply.code(200).send({ requestId: request.id, ...result });
    },
  );

  app.post("/v1/email/preview", { preHandler: authenticate }, async (request, reply) => {
    const parsedRequest = previewEmailRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: parsedRequest.error.issues
            .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
            .join("; "),
          requestId: request.id,
        },
      });
    }

    const result = emailService.preview(
      toPreviewEmailTemplateCommand(parsedRequest.data),
    );
    return reply.code(200).send({ requestId: request.id, ...result });
  });

  app.post(
    "/v1/notifications/send",
    { preHandler: authenticate },
    async (request, reply) => {
      const parsedRequest = sendNotificationRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        return reply.code(400).send({
          error: {
            code: "INVALID_REQUEST",
            message: parsedRequest.error.issues
              .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
              .join("; "),
            requestId: request.id,
          },
        });
      }
      if (options.notificationService === undefined) {
        return reply.code(503).send({
          error: {
            code: "PROVIDER_NOT_CONFIGURED",
            message: "Notifications are not configured.",
            requestId: request.id,
          },
        });
      }

      const result = await options.notificationService.send(
        toSendNotificationCommand(parsedRequest.data),
      );
      return reply.code(200).send({ requestId: request.id, ...result });
    },
  );

  registerMcpHttpRoutes(
    app,
    options.translationService,
    authenticate,
    emailService,
    options.notificationService,
  );

  app.setErrorHandler((error, request, reply) => {
    if (
      error instanceof TranslationError
      || error instanceof EmailError
      || error instanceof NotificationError
    ) {
      const statusCode =
        error.code === "INVALID_REQUEST"
          ? 400
          : error.code === "NO_ROUTE"
            ? 422
          : error.code === "PROVIDER_NOT_CONFIGURED"
            ? 503
            : 502;

      return reply.code(statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id },
      });
    }

    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const statusCode = getClientErrorStatusCode(error) ?? 500;
    request.log.error(
      { errorName, errorMessage },
      "HTTP request failed",
    );
    return reply.code(statusCode).send({
      error: {
        code: statusCode < 500 ? "INVALID_REQUEST" : "INTERNAL_ERROR",
        message: statusCode < 500 ? errorMessage : "An unexpected error occurred.",
        requestId: request.id,
      },
    });
  });

  return app;
}

function getClientErrorStatusCode(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return error.statusCode;
  }

  return undefined;
}