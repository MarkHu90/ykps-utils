import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import type { TranslationService } from "../translation/service.js";
import type { EmailService } from "../email/service.js";
import type { NotificationService } from "../notification/service.js";
import { createYkpsMcpServer } from "./server.js";

type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerMcpHttpRoutes(
  app: FastifyInstance,
  translationService: TranslationService,
  authenticate: PreHandler,
  emailService?: EmailService,
  notificationService?: NotificationService,
): void {
  app.post("/mcp", { preHandler: authenticate }, async (request, reply) => {
    const server = createYkpsMcpServer(
      translationService,
      emailService,
      notificationService,
    );
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    let closed = false;

    const close = async (): Promise<void> => {
      if (closed) {
        return;
      }

      closed = true;
      await Promise.allSettled([transport.close(), server.close()]);
    };

    reply.raw.once("close", () => {
      void close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      await close();
      throw error;
    }
  });

  app.get("/mcp", { preHandler: authenticate }, async (_request, reply) =>
    methodNotAllowed(reply),
  );
  app.delete("/mcp", { preHandler: authenticate }, async (_request, reply) =>
    methodNotAllowed(reply),
  );
}

function methodNotAllowed(reply: FastifyReply): FastifyReply {
  return reply
    .code(405)
    .header("allow", "POST")
    .send({
      jsonrpc: "2.0",
      error: { code: -32_000, message: "Method not allowed." },
      id: null,
    });
}