import { describe, expect, it, vi } from "vitest";

import {
  EMAIL_LIMITS,
  EmailService,
  EmailValidationError,
  type EmailProvider,
  type ProviderSendEmailRequest,
} from "../../src/email/service.js";
import { EmailTemplateService } from "../../src/email/template-service.js";

describe("email service", () => {
  it("normalizes and sends HTML email by default", async () => {
    const send = vi.fn(async (_request: ProviderSendEmailRequest) => ({
      messageId: "message-1",
      accepted: ["first@example.com", "second@example.com"],
      rejected: [],
    }));
    const provider: EmailProvider = { name: "test-smtp", send };
    const service = new EmailService(provider);

    await expect(
      service.send({
        from: " sender@example.com ",
        to: ["first@example.com", "second@example.com", "first@example.com"],
        replyTo: "reply@example.com",
        subject: " Test subject ",
        body: "<p>Hello</p>",
        displayName: "Example Sender",
      }),
    ).resolves.toEqual({
      provider: "test-smtp",
      messageId: "message-1",
      accepted: ["first@example.com", "second@example.com"],
      rejected: [],
    });
    expect(send).toHaveBeenCalledWith({
      from: "sender@example.com",
      to: ["first@example.com", "second@example.com"],
      replyTo: "reply@example.com",
      subject: "Test subject",
      html: "<p>Hello</p>",
      displayName: "Example Sender",
      attachments: [],
    });
  });

  it("uses the SMTP username as the default sender", async () => {
    const send = vi.fn(async (_request: ProviderSendEmailRequest) => ({
      messageId: "message-2",
      accepted: ["recipient@example.com"],
      rejected: [],
    }));
    const service = new EmailService(
      { name: "test-smtp", send },
      "smtp-user@example.com",
    );

    await service.send({
      to: ["recipient@example.com"],
      subject: "Test",
      body: "Hello",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "smtp-user@example.com" }),
    );
  });

  it("rejects header injection in email addresses", async () => {
    const provider: EmailProvider = {
      name: "test-smtp",
      send: async () => ({ messageId: "unused", accepted: [], rejected: [] }),
    };

    await expect(
      new EmailService(provider).send({
        from: "sender@example.com\r\nBcc: hidden@example.com",
        to: ["recipient@example.com"],
        subject: "Test",
        body: "Hello",
      }),
    ).rejects.toBeInstanceOf(EmailValidationError);
  });

  it("renders a localized template with HTML and plain-text alternatives", async () => {
    const send = vi.fn(async (_request: ProviderSendEmailRequest) => ({
      messageId: "message-3",
      accepted: ["recipient@example.com"],
      rejected: [],
    }));
    const templates = new EmailTemplateService([
      {
        id: "welcome",
        defaultLocale: "en",
        locales: {
          en: {
            subject: "Welcome, {{name}}",
            html: "<p>Hello & welcome, {{name}}</p>",
            text: "Hello & welcome, {{name}}",
          },
          zh: {
            subject: "欢迎，{{name}}",
            html: "<p>你好，{{name}}</p>",
            text: "你好，{{name}}",
          },
        },
      },
    ]);
    const service = new EmailService(
      { name: "test-smtp", send },
      "sender@example.com",
      templates,
    );

    await service.send({
      to: ["recipient@example.com"],
      templateId: "welcome",
      locale: "zh-CN",
      variables: { name: "<小明>" },
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "欢迎，<小明>",
        html: "<p>你好，&lt;小明&gt;</p>",
        text: "你好，<小明>",
      }),
    );
    expect(service.preview({
      templateId: "welcome",
      variables: { name: "Ada" },
    })).toMatchObject({ locale: "en", subject: "Welcome, Ada" });
  });

  it("rejects missing and unexpected template variables", () => {
    const templates = new EmailTemplateService([
      {
        id: "receipt",
        defaultLocale: "en",
        locales: {
          en: {
            subject: "Receipt {{number}}",
            html: "<p>Total: {{total}}</p>",
            text: "Total: {{total}}",
          },
        },
      },
    ]);
    const service = new EmailService(undefined, undefined, templates);

    expect(() => service.preview({
      templateId: "receipt",
      variables: { number: "R-1", extra: true },
    })).toThrow("Missing email template variables: total.");
  });

  it("decodes attachments and validates inline content IDs", async () => {
    const send = vi.fn(async (_request: ProviderSendEmailRequest) => ({
      messageId: "message-4",
      accepted: ["recipient@example.com"],
      rejected: [],
    }));
    const service = new EmailService(
      { name: "test-smtp", send },
      "sender@example.com",
    );

    await service.send({
      to: ["recipient@example.com"],
      subject: "Image",
      html: "<img src=\"cid:logo\">",
      text: "Image",
      attachments: [{
        filename: "logo.png",
        contentBase64: Buffer.from("image-data").toString("base64"),
        contentType: "image/png",
        contentId: "logo",
        disposition: "inline",
      }],
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [expect.objectContaining({
          filename: "logo.png",
          content: Buffer.from("image-data"),
          contentId: "logo",
          disposition: "inline",
        })],
      }),
    );
  });

  it("rejects attachment header injection and oversized attachments", async () => {
    const provider: EmailProvider = {
      name: "test-smtp",
      send: async () => ({ messageId: "unused", accepted: [], rejected: [] }),
    };
    const service = new EmailService(provider, "sender@example.com");
    const command = {
      to: ["recipient@example.com"],
      subject: "Attachment",
      text: "See attachment",
    } as const;

    await expect(service.send({
      ...command,
      attachments: [{
        filename: "report.pdf\r\nBcc: hidden@example.com",
        contentBase64: "YQ==",
      }],
    })).rejects.toThrow("must not contain newline characters");

    await expect(service.send({
      ...command,
      attachments: [{
        filename: "large.bin",
        contentBase64: Buffer.alloc(EMAIL_LIMITS.maxAttachmentBytes + 1).toString("base64"),
      }],
    })).rejects.toThrow("exceeds the 10485760 byte limit");
  });
});