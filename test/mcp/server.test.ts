import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import { createYkpsMcpServer } from "../../src/mcp/server.js";
import { EmailService, type EmailProvider } from "../../src/email/service.js";
import { EmailTemplateService } from "../../src/email/template-service.js";
import {
  NotificationService,
  type NotificationProvider,
} from "../../src/notification/service.js";
import {
  TranslationService,
  type TranslationProvider,
} from "../../src/translation/service.js";

describe("translation MCP server", () => {
  it("lists and calls the translate_text tool", async () => {
    const provider: TranslationProvider = {
      name: "test-provider",
      detectLanguages: async (texts) => texts.map(() => "en"),
      translate: async (request) =>
        request.texts.map((text) => ({
          text: `translated:${text}`,
          detectedSourceLanguage: request.sourceLanguage ?? "en",
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
      channelType: "slack",
      name: "slack",
      send: async () => ({ messageId: "notification-1" }),
    };
    const server = createYkpsMcpServer(
      new TranslationService(provider),
      new EmailService(
        emailProvider,
        undefined,
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
            },
          },
        ]),
      ),
      new NotificationService(
        [notificationProvider],
        [{ eventTypes: ["deployment.failed"], channelIds: ["operations"] }],
      ),
    );
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("translate_text");
      expect(tools.tools.map((tool) => tool.name)).toContain("send_email");
      expect(tools.tools.map((tool) => tool.name)).toContain("preview_email");
      expect(tools.tools.map((tool) => tool.name)).toContain("send_notification");

      const result = await client.callTool({
        name: "translate_text",
        arguments: {
          text: ["Hello", "Goodbye"],
          sourceLanguage: "en",
          targetLanguage: "zh-Hans",
        },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        provider: "test-provider",
        targetLanguage: "zh-Hans",
        translations: [
          {
            sourceText: "Hello",
            text: "translated:Hello",
            detectedSourceLanguage: "en",
          },
          {
            sourceText: "Goodbye",
            text: "translated:Goodbye",
            detectedSourceLanguage: "en",
          },
        ],
      });

      const emailResult = await client.callTool({
        name: "send_email",
        arguments: {
          from: "sender@example.com",
          to: "recipient@example.com",
          subject: "Hello",
          body: "Hello",
          isBodyHtml: false,
        },
      });

      expect(emailResult.isError).not.toBe(true);
      expect(emailResult.structuredContent).toEqual({
        provider: "test-smtp",
        messageId: "message-1",
        accepted: ["recipient@example.com"],
        rejected: [],
      });

      const previewResult = await client.callTool({
        name: "preview_email",
        arguments: {
          templateId: "welcome",
          variables: { name: "Ada" },
        },
      });

      expect(previewResult.isError).not.toBe(true);
      expect(previewResult.structuredContent).toEqual({
        templateId: "welcome",
        locale: "en",
        subject: "Welcome, Ada",
        html: "<p>Welcome, Ada</p>",
        text: "Welcome, Ada",
      });

      const notificationResult = await client.callTool({
        name: "send_notification",
        arguments: {
          eventType: "deployment.failed",
          title: "Deployment failed",
          message: "Production deployment 42 failed.",
          priority: "critical",
          idempotencyKey: "deployment-42",
        },
      });

      expect(notificationResult.isError).not.toBe(true);
      expect(notificationResult.structuredContent).toEqual({
        eventType: "deployment.failed",
        priority: "critical",
        idempotencyKey: "deployment-42",
        duplicate: false,
        channels: [{
          channelId: "operations",
          channelType: "slack",
          provider: "slack",
          status: "sent",
          attempts: 1,
          messageId: "notification-1",
        }],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});