import { createHash } from "node:crypto";

export const NOTIFICATION_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export const NOTIFICATION_CHANNEL_TYPES = [
  "email",
  "webhook",
  "slack",
  "teams",
  "dingtalk",
  "wechat",
] as const;

export type NotificationPriority = typeof NOTIFICATION_PRIORITIES[number];
export type NotificationChannelType = typeof NOTIFICATION_CHANNEL_TYPES[number];
export type NotificationValue =
  | string
  | number
  | boolean
  | null
  | readonly NotificationValue[]
  | { readonly [key: string]: NotificationValue };

export interface SendNotificationCommand {
  eventType: string;
  message: string;
  title?: string;
  priority?: NotificationPriority;
  idempotencyKey?: string;
  data?: Readonly<Record<string, NotificationValue>>;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface ProviderNotification {
  eventType: string;
  message: string;
  title?: string;
  priority: NotificationPriority;
  idempotencyKey?: string;
  data?: Readonly<Record<string, NotificationValue>>;
}

export interface NotificationProviderResult {
  messageId?: string;
}

export interface NotificationProvider {
  readonly channelId: string;
  readonly channelType: NotificationChannelType;
  readonly name: string;
  send(
    notification: ProviderNotification,
    signal: AbortSignal,
  ): Promise<NotificationProviderResult>;
}

export interface NotificationRoute {
  eventTypes: readonly string[];
  channelIds: readonly string[];
}

export interface NotificationChannelResult {
  channelId: string;
  channelType: NotificationChannelType;
  provider: string;
  status: "sent" | "failed";
  attempts: number;
  messageId?: string;
  error?: string;
}

export interface SendNotificationResult {
  eventType: string;
  priority: NotificationPriority;
  idempotencyKey?: string;
  duplicate: boolean;
  channels: readonly NotificationChannelResult[];
}

export class NotificationError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_REQUEST" | "NO_ROUTE" | "CONFIGURATION_ERROR",
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

export interface NotificationServiceOptions {
  defaultTimeoutMs?: number;
  retryDelayMs?: number;
}

const DEFAULT_ATTEMPTS: Readonly<Record<NotificationPriority, number>> = {
  low: 1,
  normal: 2,
  high: 3,
  critical: 4,
};

export class NotificationService {
  private readonly providers = new Map<string, NotificationProvider>();
  private readonly idempotentRequests = new Map<
    string,
    { fingerprint: string; result: Promise<SendNotificationResult> }
  >();
  private readonly defaultTimeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(
    providers: readonly NotificationProvider[],
    private readonly routes: readonly NotificationRoute[],
    options: NotificationServiceOptions = {},
  ) {
    for (const provider of providers) {
      if (this.providers.has(provider.channelId)) {
        throw new NotificationError(
          `Notification channel ID is duplicated: ${provider.channelId}.`,
          "CONFIGURATION_ERROR",
        );
      }
      this.providers.set(provider.channelId, provider);
    }

    for (const route of routes) {
      for (const channelId of route.channelIds) {
        if (!this.providers.has(channelId)) {
          throw new NotificationError(
            `Notification route references unknown channel: ${channelId}.`,
            "CONFIGURATION_ERROR",
          );
        }
      }
    }

    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;
    this.retryDelayMs = options.retryDelayMs ?? 250;
  }

  async send(command: SendNotificationCommand): Promise<SendNotificationResult> {
    const normalized = normalizeCommand(command, this.defaultTimeoutMs);
    if (normalized.idempotencyKey === undefined) {
      return this.dispatch(normalized);
    }

    const fingerprint = createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
    const existing = this.idempotentRequests.get(normalized.idempotencyKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        throw new NotificationError(
          "The idempotency key was already used for a different notification.",
          "INVALID_REQUEST",
        );
      }
      return { ...(await existing.result), duplicate: true };
    }

    const result = this.dispatch(normalized);
    this.idempotentRequests.set(normalized.idempotencyKey, { fingerprint, result });
    return result;
  }

  private async dispatch(
    notification: ProviderNotification & { timeoutMs: number; maxAttempts: number },
  ): Promise<SendNotificationResult> {
    const channelIds = [...new Set(
      this.routes
        .filter((route) => route.eventTypes.includes(notification.eventType)
          || route.eventTypes.includes("*"))
        .flatMap((route) => route.channelIds),
    )];
    if (channelIds.length === 0) {
      throw new NotificationError(
        `No notification route matches event type: ${notification.eventType}.`,
        "NO_ROUTE",
      );
    }

    const channels = await Promise.all(channelIds.map(async (channelId) => {
      const provider = this.providers.get(channelId)!;
      return this.sendWithRetry(
        provider,
        notification,
        notification.maxAttempts,
        notification.timeoutMs,
      );
    }));

    return {
      eventType: notification.eventType,
      priority: notification.priority,
      ...(notification.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: notification.idempotencyKey }),
      duplicate: false,
      channels,
    };
  }

  private async sendWithRetry(
    provider: NotificationProvider,
    notification: ProviderNotification,
    maxAttempts: number,
    timeoutMs: number,
  ): Promise<NotificationChannelResult> {
    let lastError = "Notification provider failed.";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await sendWithTimeout(provider, notification, timeoutMs);
        return {
          channelId: provider.channelId,
          channelType: provider.channelType,
          provider: provider.name,
          status: "sent",
          attempts: attempt,
          ...(result.messageId === undefined ? {} : { messageId: result.messageId }),
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
        if (attempt < maxAttempts && this.retryDelayMs > 0) {
          await delay(this.retryDelayMs * 2 ** (attempt - 1));
        }
      }
    }

    return {
      channelId: provider.channelId,
      channelType: provider.channelType,
      provider: provider.name,
      status: "failed",
      attempts: maxAttempts,
      error: lastError,
    };
  }
}

function normalizeCommand(
  command: SendNotificationCommand,
  defaultTimeoutMs: number,
): ProviderNotification & { timeoutMs: number; maxAttempts: number } {
  const eventType = command.eventType.trim();
  const message = command.message.trim();
  const title = command.title?.trim();
  const idempotencyKey = command.idempotencyKey?.trim();
  const priority = command.priority ?? "normal";
  const timeoutMs = command.timeoutMs ?? defaultTimeoutMs;
  const maxAttempts = command.maxAttempts ?? DEFAULT_ATTEMPTS[priority];

  if (eventType.length === 0 || message.length === 0) {
    throw new NotificationError("eventType and message must not be empty.", "INVALID_REQUEST");
  }
  if (title !== undefined && title.length === 0) {
    throw new NotificationError("title must not be empty.", "INVALID_REQUEST");
  }
  if (idempotencyKey !== undefined && idempotencyKey.length === 0) {
    throw new NotificationError("idempotencyKey must not be empty.", "INVALID_REQUEST");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new NotificationError(
      "timeoutMs must be an integer between 1 and 120000.",
      "INVALID_REQUEST",
    );
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new NotificationError(
      "maxAttempts must be an integer between 1 and 10.",
      "INVALID_REQUEST",
    );
  }

  return {
    eventType,
    message,
    priority,
    ...(title === undefined ? {} : { title }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(command.data === undefined ? {} : { data: command.data }),
    timeoutMs,
    maxAttempts,
  };
}

async function sendWithTimeout(
  provider: NotificationProvider,
  notification: ProviderNotification,
  timeoutMs: number,
): Promise<NotificationProviderResult> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`Notification attempt timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      provider.send(notification, controller.signal),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}