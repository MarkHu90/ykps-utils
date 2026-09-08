import "dotenv/config";

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import {
  createConfiguredEmailService,
  createConfiguredNotificationService,
  createConfiguredTranslationService,
} from "./bootstrap.js";
import { createYkpsMcpServer } from "./mcp/server.js";

async function main(): Promise<void> {
  const emailService = createConfiguredEmailService();
  const server = createYkpsMcpServer(
    createConfiguredTranslationService(),
    emailService,
    createConfiguredNotificationService(emailService),
  );
  const transport = new StdioServerTransport();

  await server.connect(transport);
  process.stderr.write("YKPS Utils MCP server connected over stdio.\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`Failed to start YKPS Utils MCP server: ${message}\n`);
  process.exitCode = 1;
});