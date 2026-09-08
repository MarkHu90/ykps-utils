import "dotenv/config";

import {
  createConfiguredEmailService,
  createConfiguredNotificationService,
  createConfiguredTranslationService,
} from "./bootstrap.js";
import { loadHttpConfig } from "./config.js";
import { createHttpApp } from "./http/app.js";

async function main(): Promise<void> {
  const config = loadHttpConfig();
  const emailService = createConfiguredEmailService();
  const notificationService = createConfiguredNotificationService(emailService);
  const app = createHttpApp({
    translationService: createConfiguredTranslationService(),
    emailService,
    ...(notificationService === undefined ? {} : { notificationService }),
    apiKeys: config.apiKeys,
    host: config.host,
    allowedHosts: config.allowedHosts,
    ...(config.allowedOrigins === undefined
      ? {}
      : { allowedOrigins: config.allowedOrigins }),
  });

  const address = await app.listen({ host: config.host, port: config.port });
  process.stdout.write(`YKPS Utils listening at ${address}\n`);

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) {
      return;
    }

    closing = true;
    await app.close();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`Failed to start YKPS Utils: ${message}\n`);
  process.exitCode = 1;
});