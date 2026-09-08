import { describe, expect, it } from "vitest";

import {
  TranslationProviderError,
  TranslationService,
  type ProviderTranslateRequest,
  type ProviderTranslation,
  type TranslationProvider,
} from "../../src/translation/service.js";

class StubProvider implements TranslationProvider {
  readonly name = "stub";
  lastRequest?: ProviderTranslateRequest;
  detectedLanguages: readonly string[] = ["en"];

  async detectLanguages(): Promise<readonly string[]> {
    return this.detectedLanguages;
  }

  async translate(request: ProviderTranslateRequest): Promise<readonly ProviderTranslation[]> {
    this.lastRequest = request;
    return request.texts.map((text) => ({
      text: `[${request.targetLanguage}] ${text}`,
      detectedSourceLanguage: request.sourceLanguage ?? "en",
    }));
  }
}

describe("TranslationService", () => {
  it("normalizes a command and maps provider output to the public result", async () => {
    const provider = new StubProvider();
    const service = new TranslationService(provider);

    const result = await service.translate({
      texts: ["Hello", "Goodbye"],
      sourceLanguage: " en ",
      targetLanguage: " zh-Hans ",
    });

    expect(provider.lastRequest).toEqual({
      texts: ["Hello", "Goodbye"],
      sourceLanguage: "en",
      targetLanguage: "zh-Hans",
      textType: "plain",
    });
    expect(result).toEqual({
      provider: "stub",
      targetLanguage: "zh-Hans",
      translations: [
        { sourceText: "Hello", text: "[zh-Hans] Hello", detectedSourceLanguage: "en" },
        { sourceText: "Goodbye", text: "[zh-Hans] Goodbye", detectedSourceLanguage: "en" },
      ],
    });
  });

  it.each([
    ["Hello", "en", "zh-Hans"],
    ["你好", "zh-Hans", "en"],
  ])("detects %s as %s and automatically targets %s", async (text, detected, target) => {
    const provider = new StubProvider();
    provider.detectedLanguages = [detected];
    const service = new TranslationService(provider);

    const result = await service.translate({ texts: [text] });

    expect(provider.lastRequest).toEqual({
      texts: [text],
      targetLanguage: target,
      textType: "plain",
    });
    expect(result.targetLanguage).toBe(target);
  });

  it("uses an explicit source and target without automatic detection", async () => {
    const provider = new StubProvider();
    provider.detectLanguages = async () => {
      throw new Error("detectLanguages should not be called");
    };
    const service = new TranslationService(provider);

    await service.translate({
      texts: ["Bonjour"],
      sourceLanguage: "fr",
      targetLanguage: "de",
    });

    expect(provider.lastRequest).toMatchObject({
      sourceLanguage: "fr",
      targetLanguage: "de",
    });
  });

  it.each([
    [{ texts: [], sourceLanguage: "en", targetLanguage: "fr" }, "At least one text"],
    [
      { texts: ["  "], sourceLanguage: "en", targetLanguage: "fr" },
      "must not be empty",
    ],
    [
      { texts: ["Hello"], sourceLanguage: "en", targetLanguage: "not a language" },
      "BCP 47-style",
    ],
  ])("rejects an invalid command", async (command, expectedMessage) => {
    const service = new TranslationService(new StubProvider());

    await expect(service.translate(command)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining(expectedMessage),
    });
  });

  it("rejects a provider response with the wrong item count", async () => {
    const provider: TranslationProvider = {
      name: "broken",
      detectLanguages: async () => ["en"],
      translate: async () => [],
    };
    const service = new TranslationService(provider);

    await expect(
      service.translate({
        texts: ["Hello"],
        sourceLanguage: "en",
        targetLanguage: "fr",
      }),
    ).rejects.toBeInstanceOf(TranslationProviderError);
  });
});