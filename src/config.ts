import { readFileSync } from "node:fs";

import { z } from "zod/v4";

import type { EmailTemplateDefinition } from "./email/template-service.js";
import {
  NOTIFICATION_CHANNEL_TYPES,
  type NotificationChannelType,
  type NotificationRoute,
} from "./notification/service.js";
import type { AzureTranslatorProviderOptions } from "./providers/azure-translator.js";
import type { AliyunSmtpProviderOptions } from "./providers/aliyun-smtp.js";

const DEFAULT_AZURE_TRANSLATOR_ENDPOINT =
  "https://api.cognitive.microsofttranslator.com";
const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;
const DEFAULT_SMTP_HOST = "smtpdm.aliyun.com";

export interface HttpConfig {
  host: string;
  port: number;
  apiKeys: readonly string[];
  allowedHosts: readonly string[];
  allowedOrigins?: readonly string[];
}

export interface NotificationChannelConfig {
  id: string;
  type: NotificationChannelType;
  url?: string;
  headers?: Readonly<Record<string, string>> | undefined;
  recipients?: readonly string[];
}

export interface NotificationConfig {
  channels: readonly NotificationChannelConfig[];
  routes: readonly NotificationRoute[];
  defaultTimeoutMs?: number | undefined;
  retryDelayMs?: number | undefined;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const emailTemplateDefinitionsSchema = z.array(z.object({
  id: z.string(),
  defaultLocale: z.string(),
  locales: z.record(z.string(), z.object({
    subject: z.string(),
    html: z.string(),
    text: z.string(),
  }).strict()),
}).strict());

const notificationChannelSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
    type: z.literal("email"),
    recipients: z.array(z.string().trim().email().max(254)).min(1).max(100),
  }).strict(),
  z.object({
    id: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
    type: z.enum(NOTIFICATION_CHANNEL_TYPES.filter((type) => type !== "email")),
    url: z.string().url().refine((value) => new URL(value).protocol === "https:", {
      message: "Webhook URLs must use HTTPS.",
    }),
    headers: z.record(z.string(), z.string()).optional(),
  }).strict(),
]);

const notificationConfigSchema = z.object({
  channels: z.array(notificationChannelSchema).min(1),
  routes: z.array(z.object({
    eventTypes: z.array(z.string().trim().min(1)).min(1),
    channelIds: z.array(z.string().trim().min(1)).min(1),
  }).strict()).min(1),
  defaultTimeoutMs: z.number().int().min(1).max(120_000).optional(),
  retryDelayMs: z.number().int().min(0).max(60_000).optional(),
}).strict().superRefine((config, context) => {
  const channelIds = new Set<string>();
  for (const [index, channel] of config.channels.entries()) {
    if (channelIds.has(channel.id)) {
      context.addIssue({
        code: "custom",
        path: ["channels", index, "id"],
        message: "Channel IDs must be unique.",
      });
    }
    channelIds.add(channel.id);
  }
  for (const [routeIndex, route] of config.routes.entries()) {
    for (const [channelIndex, channelId] of route.channelIds.entries()) {
      if (!channelIds.has(channelId)) {
        context.addIssue({
          code: "custom",
          path: ["routes", routeIndex, "channelIds", channelIndex],
          message: `Unknown channel ID: ${channelId}.`,
        });
      }
    }
  }
});

export function loadEmailTemplateDefinitions(
  environment: NodeJS.ProcessEnv = process.env,
): readonly EmailTemplateDefinition[] | undefined {
  const filePath = optionalValue(environment.EMAIL_TEMPLATES_FILE);
  if (filePath === undefined) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const result = emailTemplateDefinitionsSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigurationError(
        `EMAIL_TEMPLATES_FILE is invalid: ${result.error.issues
          .map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    return result.data;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(
      `Could not load EMAIL_TEMPLATES_FILE: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export function loadNotificationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): NotificationConfig | undefined {
  const filePath = optionalValue(environment.NOTIFICATION_CONFIG_FILE);
  if (filePath === undefined) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const result = notificationConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigurationError(
        `NOTIFICATION_CONFIG_FILE is invalid: ${result.error.issues
          .map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    return result.data;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(
      `Could not load NOTIFICATION_CONFIG_FILE: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export function loadAliyunSmtpOptions(
  environment: NodeJS.ProcessEnv = process.env,
): AliyunSmtpProviderOptions | undefined {
  const username = optionalValue(environment.SMTP_USERNAME);
  const password = optionalValue(environment.SMTP_PASSWORD);

  if (username === undefined && password === undefined) {
    return undefined;
  }
  if (username === undefined || password === undefined) {
    throw new ConfigurationError(
      "SMTP_USERNAME and SMTP_PASSWORD must be provided together.",
    );
  }

  return {
    host: optionalValue(environment.SMTP_HOST) ?? DEFAULT_SMTP_HOST,
    port: parseConfiguredPort(environment.SMTP_PORT, 25, "SMTP_PORT"),
    secure: parseBoolean(environment.SMTP_SECURE, false, "SMTP_SECURE"),
    username,
    password,
  };
}

export function loadAzureTranslatorOptions(
  environment: NodeJS.ProcessEnv = process.env,
): AzureTranslatorProviderOptions {
  const endpoint = normalizeHttpsEndpoint(
    environment.AZURE_TRANSLATOR_ENDPOINT ?? DEFAULT_AZURE_TRANSLATOR_ENDPOINT,
  );
  const key = requireValue(environment, "AZURE_TRANSLATOR_KEY");
  const region = optionalValue(environment.AZURE_TRANSLATOR_REGION);
  const category = optionalValue(
    environment.AZURE_TRANSLATOR_CATEGORY ?? environment.AZURE_TRANSLATOR_DEPLOYMENT,
  );

  return {
    endpoint,
    key,
    ...(region === undefined ? {} : { region }),
    ...(category === undefined ? {} : { category }),
  };
}

export function loadHttpConfig(
  environment: NodeJS.ProcessEnv = process.env,
): HttpConfig {
  const host = optionalValue(environment.HOST) ?? "127.0.0.1";
  const port = parsePort(environment.PORT);
  const apiKeys = parseList(requireValue(environment, "SERVICE_API_KEYS"));
  const allowedHosts = environment.ALLOWED_HOSTS
    ? parseList(environment.ALLOWED_HOSTS)
    : [...DEFAULT_ALLOWED_HOSTS];
  const allowedOrigins = environment.ALLOWED_ORIGINS
    ? parseList(environment.ALLOWED_ORIGINS)
    : undefined;

  if (apiKeys.some((apiKey) => apiKey.length < 16)) {
    throw new ConfigurationError("Each SERVICE_API_KEYS value must be at least 16 characters.");
  }

  return {
    host,
    port,
    apiKeys,
    allowedHosts,
    ...(allowedOrigins === undefined ? {} : { allowedOrigins }),
  };
}

function requireValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = optionalValue(environment[name]);
  if (value === undefined) {
    throw new ConfigurationError(`${name} is required.`);
  }

  return value;
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseList(value: string): string[] {
  const values = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (values.length === 0) {
    throw new ConfigurationError("Comma-separated configuration values must not be empty.");
  }

  return values;
}

function parsePort(value: string | undefined): number {
  return parseConfiguredPort(value, 3030, "PORT");
}

function parseConfiguredPort(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  const port = value === undefined ? defaultValue : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigurationError(`${name} must be an integer between 1 and 65535.`);
  }

  return port;
}

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
  name: string,
): boolean {
  const normalized = optionalValue(value)?.toLowerCase();
  if (normalized === undefined) {
    return defaultValue;
  }
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new ConfigurationError(`${name} must be true or false.`);
}

function normalizeHttpsEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value.trim());
  } catch (error) {
    throw new ConfigurationError(
      `AZURE_TRANSLATOR_ENDPOINT must be a valid URL: ${error instanceof Error ? error.message : "invalid URL"}`,
    );
  }

  if (endpoint.protocol !== "https:") {
    throw new ConfigurationError("AZURE_TRANSLATOR_ENDPOINT must use HTTPS.");
  }

  return endpoint.href.replace(/\/$/, "");
}