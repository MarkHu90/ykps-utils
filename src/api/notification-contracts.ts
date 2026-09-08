import { z } from "zod/v4";

import {
  NOTIFICATION_PRIORITIES,
  type SendNotificationCommand,
} from "../notification/service.js";

const notificationValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(notificationValueSchema),
  z.record(z.string(), notificationValueSchema),
]));

export const sendNotificationRequestSchema = z.object({
  eventType: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(100_000),
  title: z.string().trim().min(1).max(500).optional(),
  priority: z.enum(NOTIFICATION_PRIORITIES).default("normal"),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  data: z.record(z.string(), notificationValueSchema).optional(),
  timeoutMs: z.number().int().min(1).max(120_000).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
}).strict();

export type SendNotificationRequest = z.infer<typeof sendNotificationRequestSchema>;

export function toSendNotificationCommand(
  request: SendNotificationRequest,
): SendNotificationCommand {
  return {
    eventType: request.eventType,
    message: request.message,
    priority: request.priority,
    ...(request.title === undefined ? {} : { title: request.title }),
    ...(request.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: request.idempotencyKey }),
    ...(request.data === undefined
      ? {}
      : { data: request.data as NonNullable<SendNotificationCommand["data"]> }),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    ...(request.maxAttempts === undefined ? {} : { maxAttempts: request.maxAttempts }),
  };
}