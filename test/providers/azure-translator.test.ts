import { describe, expect, it, vi } from "vitest";

import { AzureTranslatorProvider } from "../../src/providers/azure-translator.js";

describe("AzureTranslatorProvider", () => {
  it("detects source languages through the V3 detect endpoint", async () => {
    const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { language: "en", score: 1 },
          { language: "zh-Hans", score: 0.99 },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const provider = new AzureTranslatorProvider(
      {
        endpoint: "https://api.cognitive.microsofttranslator.com",
        key: "not-a-real-key",
        region: "eastus",
      },
      fetchClient,
    );

    const result = await provider.detectLanguages(["Hello", "你好"]);

    const [url, init] = fetchClient.mock.calls[0]!;
    expect(url.toString()).toBe(
      "https://api.cognitive.microsofttranslator.com/detect?api-version=3.0",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Region": "eastus" },
      body: JSON.stringify([{ text: "Hello" }, { text: "你好" }]),
    });
    expect(result).toEqual(["en", "zh-Hans"]);
  });

  it("sends the classic Translator REST API V3 request", async () => {
    const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            detectedLanguage: { language: "en", score: 0.99 },
            translations: [{ to: "fr", text: "Bonjour" }],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const provider = new AzureTranslatorProvider(
      {
        endpoint: "https://api.cognitive.microsofttranslator.com",
        key: "not-a-real-key",
        region: "eastasia",
        category: "custom-category",
      },
      fetchClient,
    );

    const result = await provider.translate({
      texts: ["Hello"],
      sourceLanguage: "en",
      targetLanguage: "fr",
      textType: "html",
    });

    const [url, init] = fetchClient.mock.calls[0]!;
    expect(url.toString()).toBe(
      "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=fr&textType=html&from=en&category=custom-category",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Ocp-Apim-Subscription-Key": "not-a-real-key",
        "Ocp-Apim-Subscription-Region": "eastasia",
      },
      body: JSON.stringify([{ text: "Hello" }]),
    });
    expect((init?.headers as Record<string, string>)["X-ClientTraceId"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result).toEqual([{ text: "Bonjour", detectedSourceLanguage: "en" }]);
  });

  it("uses the V3 resource path for a custom Azure endpoint", async () => {
    const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([{ translations: [{ to: "fr", text: "Bonjour" }] }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const provider = new AzureTranslatorProvider(
      {
        endpoint: "https://example.cognitiveservices.azure.com",
        key: "not-a-real-key",
      },
      fetchClient,
    );

    await provider.translate({ texts: ["Hello"], targetLanguage: "fr", textType: "plain" });

    expect(fetchClient.mock.calls[0]![0].toString()).toBe(
      "https://example.cognitiveservices.azure.com/translator/text/v3.0/translate?api-version=3.0&to=fr&textType=plain",
    );
  });

  it("maps a V3 error response without exposing credentials", async () => {
    const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 401000, message: "The request is not authorized." } }),
        { status: 401, statusText: "Unauthorized" },
      ),
    );
    const provider = new AzureTranslatorProvider(
      { endpoint: "https://api.cognitive.microsofttranslator.com", key: "secret-value" },
      fetchClient,
    );

    await expect(
      provider.translate({ texts: ["Hello"], targetLanguage: "fr", textType: "plain" }),
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message:
        "Azure Translator V3 translate returned 401: 401000 The request is not authorized.",
    });
  });
});