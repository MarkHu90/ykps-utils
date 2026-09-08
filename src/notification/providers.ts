import { randomUUID } from "node:crypto";

import type { EmailService } from "../email/service.js";
import type {
  NotificationChannelType,
  NotificationProvider,
  NotificationProviderResult,
  ProviderNotification,
} from "./service.js";

export interface WebhookNotificationProviderOptions {
  channelId: string;
  channelType: Exclude<NotificationChannelType, "email">;
  url: string;
  headers?: Readonly<Record<string, string>>;
}

export class WebhookNotificationProvider implements NotificationProvider {
  readonly channelId: string;
  readonly channelType: Exclude<NotificationChannelType, "email">;
  readonly name: string;

  constructor(private readonly options: WebhookNotificationProviderOptions) {
    this.channelId = options.channelId;
    this.channelType = options.channelType;
    this.name = options.channelType;
  }

  async send(
    notification: ProviderNotification,
    signal: AbortSignal,
  ): Promise<NotificationProviderResult> {
    const response = await fetch(this.options.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.options.headers,
        ...(notification.idempotencyKey === undefined
          ? {}
          : { "idempotency-key": notification.idempotencyKey }),
      },
      body: JSON.stringify(formatPayload(this.channelType, notification)),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Webhook provider returned HTTP ${response.status}.`);
    }

    return { messageId: response.headers.get("x-request-id") ?? randomUUID() };
  }
}

export class EmailNotificationProvider implements NotificationProvider {
  readonly channelType = "email" as const;
  readonly name = "email";

  constructor(
    readonly channelId: string,
    private readonly recipients: readonly string[],
    private readonly emailService: EmailService,
  ) {}

  async send(
    notification: ProviderNotification,
    _signal: AbortSignal,
  ): Promise<NotificationProviderResult> {
    const result = await this.emailService.send({
      to: this.recipients,
      subject: notification.title ?? notification.eventType,
      text: notification.message,
    });
    return { messageId: result.messageId };
  }
}

function formatPayload(
  channelType: Exclude<NotificationChannelType, "email">,
  notification: ProviderNotification,
): unknown {
  const text = notification.title === undefined
    ? notification.message
    : `${notification.title}\n${notification.message}`;

  switch (channelType) {
    case "slack":
    case "teams":
      return { text };
    case "dingtalk":
      return { msgtype: "text", text: { content: text } };
    case "wechat":
      return { msgtype: "text", text: { content: text } };
    case "webhook":
      return notification;
  }
}