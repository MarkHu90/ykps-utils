import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHttpApp } from "../../src/http/app.js";
import {
  TranslationService,
  type ProviderTranslateRequest,
  type TranslationProvider,
} from "../../src/translation/service.js";

describe("browser CORS handling", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const provider: TranslationProvider = {
      name: "test-provider",
      detectLanguages: async (texts) =>
        texts.map((text) => (/\p{Script=Han}/u.test(text) ? "zh-Hans" : "en")),
      translate: async (request: ProviderTranslateRequest) =>
        request.texts.map((text) => ({
          text: `translated:${text}`,
          ...(request.sourceLanguage === undefined
            ? { detectedSourceLanguage: "en" }
            : {}),
        })),
    };
    app = createHttpApp({
      translationService: new TranslationService(provider),
      apiKeys: ["client-key"],
      allowedOrigins: ["localhost"],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("answers CORS preflight requests from allowed origins", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/translate",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toContain(
      "authorization",
    );
  });

  it("marks responses for allowed origins so the browser exposes them", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/translate",
      headers: {
        authorization: "Bearer client-key",
        origin: "http://localhost:3000",
      },
      payload: { text: "你好" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    expect(response.json()).toMatchObject({
      translations: [{ sourceText: "你好" }],
    });
  });

  it("denies origins that are not allowlisted", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/translate",
      headers: {
        authorization: "Bearer client-key",
        origin: "http://evil.example",
      },
      payload: { text: "Hello" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
