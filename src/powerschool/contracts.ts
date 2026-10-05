import { z } from "zod/v4";

import type { GetPowerSchoolAccessTokenCommand } from "./service.js";

export const getPowerSchoolAccessTokenRequestSchema = z.strictObject({
  baseUrl: z.string().min(1).max(2_048),
  clientId: z.string().min(1).max(1_000),
  clientSecret: z.string().min(1).max(4_000),
});

export type GetPowerSchoolAccessTokenRequest = z.infer<
  typeof getPowerSchoolAccessTokenRequestSchema
>;

export function toGetPowerSchoolAccessTokenCommand(
  request: GetPowerSchoolAccessTokenRequest,
): GetPowerSchoolAccessTokenCommand {
  return { ...request };
}