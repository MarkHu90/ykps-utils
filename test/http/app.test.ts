import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHttpApp } from "../../src/http/app.js";
import { EmailService, type EmailProvider } from "../../src/email/service.js";
import { EmailTemplateService } from "../../src/email/template-service.js";
import {
  NotificationService,
  type NotificationProvider,
} from "../../src/notification/service.js";
import {
  TranslationService,
  type ProviderTranslateRequest,
  type TranslationProvider,
} from "../../src/translation/service.js";

describe("translation REST API", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const provider: TranslationProvider = {
      name: "test-provider",
      detectLanguages: async (texts) =>
        texts.map((text) => (/\p{Script=Han}/u.test(text) ? "zh-Hans" : "en")),
      translate: async (request: ProviderTranslateRequest) =>
        request.texts.map((text) => ({
          text: `translated:${text}`,
          ...(request.sourceLanguage === undefined
            ? { detectedSourceLanguage: "en" }
            : {}),
        })),
    };
    const emailProvider: EmailProvider = {
      name: "test-smtp",
      send: async (request) => ({
        messageId: "message-1",
        accepted: [...request.to],
        rejected: [],
      }),
    };
    const notificationProvider: NotificationProvider = {
      channelId: "operations",
      channelType: "teams",
      name: "teams",
      send: async () => ({ messageId: "notification-1" }),
    };
    app = createHttpApp({
      translationService: new TranslationService(provider),
      emailService: new EmailService(
        emailProvider,
        "smtp-user@example.com",
        new EmailTemplateService([
          {
            id: "welcome",
            defaultLocale: "en",
            locales: {
              en: {
                subject: "Welcome, {{name}}",
                html: "<p>Welcome, {{name}}</p>",
                text: "Welcome, {{name}}",
              },
              zh: {
                subject: "欢迎，{{name}}",
                html: "<p>欢迎，{{name}}</p>",
                text: "欢迎，{{name}}",
              },
            },
          },
        ]),
      ),
      notificationService: new NotificationService(
        [notificationProvider],
        [{ eventTypes: ["deployment.failed"], channelIds: ["operations"] }],
      ),
      apiKeys: ["client-key"],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("describes YKPS Utils at the root path", async () => {
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
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
    });
  });

  it("rejects requests without a valid bearer token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/translate",
      payload: { text: "Hello" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("describes POST usage when the translate URL is opened in a browser", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/translate" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "YKPS Utils Translation API",
      operation: "translateText",
      method: "POST",
      requestBody: { text: "Hello" },
    });
  });

  it("publishes the REST contract as OpenAPI", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      openapi: "3.1.0",
      paths: { "/v1/translate": { post: { security: [{ bearerAuth: [] }] } } },
    });
  });

  it("serves the swagger ui at /docs", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain('id="swagger-ui"');
  });

  it("serves the openapi document to the swagger ui", async () => {
    const response = await app.inject({ method: "GET", url: "/docs/json" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      openapi: "3.1.0",
      paths: { "/v1/translate": { post: { security: [{ bearerAuth: [] }] } } },
    });
  });

  it("translates single and batched text through the shared service", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/translate",
      headers: { authorization: "Bearer client-key" },
      payload: {
        text: ["Hello", "Goodbye"],
        sourceLanguage: "en",
        targetLanguage: "fr",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "test-provider",
      targetLanguage: "fr",
      translations: [
        { sourceText: "Hello", text: "translated:Hello" },
        { sourceText: "Goodbye", text: "translated:Goodbye" },
      ],
    });
    expect(response.json().requestId).toEqual(expect.any(String));
  });

  it("sends email through the shared service", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/email/send",
      headers: { authorization: "Bearer client-key" },
      payload: {
        from: "sender@example.com",
        to: ["first@example.com", "second@example.com"],
        replyTo: "reply@example.com",
        subject: "Hello",
        body: "<p>Hello</p>",
        isBodyHtml: true,
        displayName: "Example Sender",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "test-smtp",
      messageId: "message-1",
      accepted: ["first@example.com", "second@example.com"],
      rejected: [],
    });
    expect(response.json().requestId).toEqual(expect.any(String));
  });

  it("uses the configured SMTP username when from is omitted", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/email/send",
      headers: { authorization: "Bearer client-key" },
      payload: {
        to: "recipient@example.com",
        subject: "Hello",
        body: "Hello",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "test-smtp",
      accepted: ["recipient@example.com"],
    });
  });

  it("previews a localized email template without sending it", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/email/preview",
      headers: { authorization: "Bearer client-key" },
      payload: {
        templateId: "welcome",
        locale: "zh-CN",
        variables: { name: "小明" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      templateId: "welcome",
      locale: "zh",
      subject: "欢迎，小明",
      html: "<p>欢迎，小明</p>",
      text: "欢迎，小明",
    });
  });

  it("routes and deduplicates notifications through the shared service", async () => {
    const request = {
      method: "POST" as const,
      url: "/v1/notifications/send",
      headers: { authorization: "Bearer client-key" },
      payload: {
        eventType: "deployment.failed",
        message: "Production deployment failed.",
        priority: "critical",
        idempotencyKey: "deployment-42",
      },
    };

    const first = await app.inject(request);
    const duplicate = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      eventType: "deployment.failed",
      priority: "critical",
      duplicate: false,
      channels: [{ channelId: "operations", channelType: "teams", status: "sent" }],
    });
    expect(duplicate.json()).toMatchObject({ duplicate: true });
  });

  it("automatically translates detected English text to Chinese", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/translate",
      headers: { authorization: "Bearer client-key" },
      payload: { text: "Hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      targetLanguage: "zh-Hans",
      translations: [
        {
          sourceText: "Hello",
          text: "translated:Hello",
          detectedSourceLanguage: "en",
        },
      ],
    });
  });

  it("automatically translates detected Chinese text to English", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/translate",
      headers: { authorization: "Bearer client-key" },
      payload: { text: "你好" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      targetLanguage: "en",
      translations: [{ sourceText: "你好", text: "translated:你好" }],
    });
  });

  it("returns a structured validation error", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/translate",
      headers: { authorization: "Bearer client-key" },
      payload: {
        text: "Hello",
        sourceLanguage: "en",
        targetLanguage: "invalid language",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("serves the translation tool over authenticated Streamable HTTP", async () => {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const transport = new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: { headers: { authorization: "Bearer client-key" } },
    });
    const client = new Client({ name: "http-test-client", version: "1.0.0" });

    await client.connect(transport);

    try {
      const result = await client.callTool({
        name: "translate_text",
        arguments: {
          text: "Hello",
          sourceLanguage: "en",
          targetLanguage: "fr",
        },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        provider: "test-provider",
        translations: [{ sourceText: "Hello", text: "translated:Hello" }],
      });
    } finally {
      await client.close();
    }
  });
});