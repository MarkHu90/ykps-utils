import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ConfigurationError,
  loadAliyunSmtpOptions,
  loadAzureTranslatorOptions,
  loadEmailTemplateDefinitions,
  loadHttpConfig,
  loadNotificationConfig,
} from "../src/config.js";

describe("configuration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("loads Azure and HTTP settings with secure defaults", () => {
    const environment = {
      AZURE_TRANSLATOR_KEY: "azure-secret",
      AZURE_TRANSLATOR_REGION: "eastasia",
      AZURE_TRANSLATOR_CATEGORY: "custom-category",
      SERVICE_API_KEYS: "first-client-key-value, second-client-key-value",
    };

    expect(loadAzureTranslatorOptions(environment)).toEqual({
      endpoint: "https://api.cognitive.microsofttranslator.com",
      key: "azure-secret",
      region: "eastasia",
      category: "custom-category",
    });
    expect(loadHttpConfig(environment)).toEqual({
      host: "127.0.0.1",
      port: 3030,
      apiKeys: ["first-client-key-value", "second-client-key-value"],
      allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
    });
    expect(
      loadAliyunSmtpOptions({
        SMTP_USERNAME: "smtp-user",
        SMTP_PASSWORD: "smtp-password",
      }),
    ).toEqual({
      host: "smtpdm.aliyun.com",
      port: 25,
      secure: false,
      username: "smtp-user",
      password: "smtp-password",
    });
  });

  it("does not require HTTP credentials for stdio MCP configuration", () => {
    expect(loadAzureTranslatorOptions({ AZURE_TRANSLATOR_KEY: "azure-secret" })).toMatchObject({
      key: "azure-secret",
    });
  });

  it("normalizes ALLOWED_ORIGINS entries to bare hostnames", () => {
    const environment = {
      SERVICE_API_KEYS: "first-client-key-value",
      ALLOWED_ORIGINS: "https://ps.ykpaoschool.cn, localhost:3000, ykpaoschool.cn",
    };

    expect(loadHttpConfig(environment).allowedOrigins).toEqual([
      "ps.ykpaoschool.cn",
      "localhost",
      "ykpaoschool.cn",
    ]);
  });

  it("leaves SMTP email disabled when credentials are omitted", () => {
    expect(loadAliyunSmtpOptions({})).toBeUndefined();
  });

  it("loads email templates from a JSON catalog", () => {
    const directory = mkdtempSync(join(tmpdir(), "ykps-email-templates-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "templates.json");
    writeFileSync(filePath, JSON.stringify([{
      id: "welcome",
      defaultLocale: "en",
      locales: {
        en: { subject: "Welcome", html: "<p>Welcome</p>", text: "Welcome" },
      },
    }]));

    expect(loadEmailTemplateDefinitions({ EMAIL_TEMPLATES_FILE: filePath }))
      .toEqual([expect.objectContaining({ id: "welcome", defaultLocale: "en" })]);
    expect(loadEmailTemplateDefinitions({})).toBeUndefined();
  });

  it("rejects malformed email template files", () => {
    const directory = mkdtempSync(join(tmpdir(), "ykps-email-templates-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "templates.json");
    writeFileSync(filePath, JSON.stringify([{ id: "welcome" }]));

    expect(() => loadEmailTemplateDefinitions({ EMAIL_TEMPLATES_FILE: filePath }))
      .toThrow("EMAIL_TEMPLATES_FILE is invalid");
  });

  it("loads notification channels and event routes from JSON", () => {
    const directory = mkdtempSync(join(tmpdir(), "ykps-notifications-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "notifications.json");
    writeFileSync(filePath, JSON.stringify({
      channels: [{
        id: "operations",
        type: "slack",
        url: "https://hooks.slack.com/services/test",
      }],
      routes: [{ eventTypes: ["deployment.failed"], channelIds: ["operations"] }],
      defaultTimeoutMs: 3000,
    }));

    expect(loadNotificationConfig({ NOTIFICATION_CONFIG_FILE: filePath }))
      .toMatchObject({
        channels: [{ id: "operations", type: "slack" }],
        routes: [{ eventTypes: ["deployment.failed"], channelIds: ["operations"] }],
        defaultTimeoutMs: 3000,
      });
    expect(loadNotificationConfig({})).toBeUndefined();
  });

  it("rejects unknown notification route channels", () => {
    const directory = mkdtempSync(join(tmpdir(), "ykps-notifications-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "notifications.json");
    writeFileSync(filePath, JSON.stringify({
      channels: [{
        id: "operations",
        type: "teams",
        url: "https://example.com/teams-hook",
      }],
      routes: [{ eventTypes: ["*"], channelIds: ["missing"] }],
    }));

    expect(() => loadNotificationConfig({ NOTIFICATION_CONFIG_FILE: filePath }))
      .toThrow("Unknown channel ID: missing");
  });

  it.each([
    [() => loadAzureTranslatorOptions({}), "AZURE_TRANSLATOR_KEY is required"],
    [() => loadHttpConfig({}), "SERVICE_API_KEYS is required"],
    [
      () => loadAliyunSmtpOptions({ SMTP_USERNAME: "smtp-user" }),
      "SMTP_USERNAME and SMTP_PASSWORD must be provided together",
    ],
    [
      () =>
        loadHttpConfig({
          SERVICE_API_KEYS: "short",
        }),
      "at least 16 characters",
    ],
  ])("rejects unsafe or incomplete settings", (load, expectedMessage) => {
    expect(load).toThrowError(ConfigurationError);
    expect(load).toThrowError(expectedMessage);
  });
});