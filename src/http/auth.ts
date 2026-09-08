import { timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

export function createBearerAuthenticator(
  apiKeys: readonly string[],
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const authorization = request.headers.authorization;
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (token !== undefined && apiKeys.some((apiKey) => securelyEquals(token, apiKey))) {
      return;
    }

    await reply.code(401).send({
      error: {
        code: "UNAUTHORIZED",
        message: "A valid bearer token is required.",
        requestId: request.id,
      },
    });
  };
}

function securelyEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}