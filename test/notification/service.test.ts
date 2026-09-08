import { describe, expect, it, vi } from "vitest";

import {
  NotificationError,
  NotificationService,
  type NotificationProvider,
} from "../../src/notification/service.js";

function provider(
  channelId: string,
  send: NotificationProvider["send"],
): NotificationProvider {
  return { channelId, channelType: "webhook", name: "test-webhook", send };
}

describe("notification service", () => {
  it("routes an event to all configured channels", async () => {
    const billingSend = vi.fn(async () => ({ messageId: "billing-1" }));
    const auditSend = vi.fn(async () => ({ messageId: "audit-1" }));
    const service = new NotificationService(
      [provider("billing", billingSend), provider("audit", auditSend)],
      [
        { eventTypes: ["invoice.overdue"], channelIds: ["billing"] },
        { eventTypes: ["*"], channelIds: ["audit"] },
      ],
      { retryDelayMs: 0 },
    );

    await expect(service.send({
      eventType: "invoice.overdue",
      title: "Invoice overdue",
      message: "Invoice 42 is overdue.",
      priority: "high",
    })).resolves.toMatchObject({
      eventType: "invoice.overdue",
      priority: "high",
      duplicate: false,
      channels: [
        { channelId: "billing", status: "sent", attempts: 1 },
        { channelId: "audit", status: "sent", attempts: 1 },
      ],
    });
    expect(billingSend).toHaveBeenCalledOnce();
    expect(auditSend).toHaveBeenCalledOnce();
  });

  it("retries failures according to priority", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ messageId: "message-1" });
    const service = new NotificationService(
      [provider("operations", send)],
      [{ eventTypes: ["deploy.failed"], channelIds: ["operations"] }],
      { retryDelayMs: 0 },
    );

    const result = await service.send({
      eventType: "deploy.failed",
      message: "Deployment failed.",
      priority: "normal",
    });

    expect(result.channels[0]).toMatchObject({ status: "sent", attempts: 2 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("times out each attempt and reports a channel failure", async () => {
    const service = new NotificationService(
      [provider("slow", async () => new Promise(() => undefined))],
      [{ eventTypes: ["*"], channelIds: ["slow"] }],
      { retryDelayMs: 0 },
    );

    const result = await service.send({
      eventType: "test.slow",
      message: "Slow message",
      timeoutMs: 5,
      maxAttempts: 1,
    });

    expect(result.channels[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      error: "Notification attempt timed out after 5 ms.",
    });
  });

  it("deduplicates concurrent and completed sends", async () => {
    const send = vi.fn(async () => ({ messageId: "message-1" }));
    const service = new NotificationService(
      [provider("operations", send)],
      [{ eventTypes: ["*"], channelIds: ["operations"] }],
    );
    const command = {
      eventType: "build.completed",
      message: "Build completed.",
      idempotencyKey: "build-42",
    } as const;

    const [first, second] = await Promise.all([
      service.send(command),
      service.send(command),
    ]);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect((await service.send(command)).duplicate).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    await expect(service.send({ ...command, message: "Different" }))
      .rejects.toBeInstanceOf(NotificationError);
  });

  it("rejects events without a matching route", async () => {
    const service = new NotificationService([], []);
    await expect(service.send({ eventType: "unknown", message: "Hello" }))
      .rejects.toMatchObject({ code: "NO_ROUTE" });
  });
});