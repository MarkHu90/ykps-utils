import { randomUUID } from "node:crypto";

import { z } from "zod/v4";

import {
  TranslationProviderError,
  type ProviderTranslateRequest,
  type ProviderTranslation,
  type TranslationProvider,
} from "../translation/service.js";

export interface AzureTranslatorProviderOptions {
  endpoint: string;
  key: string;
  region?: string;
  category?: string;
}

type FetchClient = typeof fetch;

const translationResponseSchema = z.array(
  z.object({
    detectedLanguage: z
      .object({
        language: z.string(),
        score: z.number(),
      })
      .optional(),
    translations: z.array(
      z.object({
        text: z.string(),
        to: z.string(),
      }),
    ),
  }),
);

const errorResponseSchema = z.object({
  error: z.object({
    code: z.union([z.string(), z.number()]),
    message: z.string(),
  }),
});

const detectionResponseSchema = z.array(
  z.object({
    language: z.string(),
    score: z.number(),
  }),
);

export class AzureTranslatorProvider implements TranslationProvider {
  readonly name = "azure-translator-v3";

  constructor(
    private readonly options: AzureTranslatorProviderOptions,
    private readonly fetchClient: FetchClient = fetch,
  ) {}

  async detectLanguages(texts: readonly string[]): Promise<readonly string[]> {
    const url = createOperationUrl(this.options.endpoint, "detect");

    try {
      const response = await this.fetchClient(url, {
        method: "POST",
        headers: this.createHeaders(),
        body: JSON.stringify(texts.map((text) => ({ text }))),
        signal: AbortSignal.timeout(30_000),
      });
      const responseBody: unknown = await response.json();

      if (!response.ok) {
        throw createResponseError(response, responseBody, "detect");
      }

      const parsedResponse = detectionResponseSchema.safeParse(responseBody);
      if (!parsedResponse.success) {
        throw new TranslationProviderError(
          "Azure Translator V3 returned an invalid language detection response.",
        );
      }

      return parsedResponse.data.map((item) => item.language);
    } catch (error) {
      if (error instanceof TranslationProviderError) {
        throw error;
      }

      throw new TranslationProviderError(
        "Azure Translator V3 language detection request failed.",
        { cause: error },
      );
    }
  }

  async translate(request: ProviderTranslateRequest): Promise<readonly ProviderTranslation[]> {
    const url = createTranslateUrl(this.options, request);
    const headers = this.createHeaders();

    try {
      const response = await this.fetchClient(url, {
        method: "POST",
        headers,
        body: JSON.stringify(request.texts.map((text) => ({ text }))),
        signal: AbortSignal.timeout(30_000),
      });
      const responseBody: unknown = await response.json();

      if (!response.ok) {
        throw createResponseError(response, responseBody, "translate");
      }

      const parsedResponse = translationResponseSchema.safeParse(responseBody);
      if (!parsedResponse.success) {
        throw new TranslationProviderError(
          "Azure Translator V3 returned an invalid response.",
        );
      }

      return parsedResponse.data.map((item) => {
        const translation = item.translations[0];
        if (translation === undefined) {
          throw new TranslationProviderError(
            "Azure Translator V3 returned an empty translation.",
          );
        }

        return {
          text: translation.text,
          ...(item.detectedLanguage === undefined
            ? {}
            : { detectedSourceLanguage: item.detectedLanguage.language }),
        };
      });
    } catch (error) {
      if (error instanceof TranslationProviderError) {
        throw error;
      }

      throw new TranslationProviderError("Azure Translator V3 request failed.", {
        cause: error,
      });
    }
  }

  private createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=UTF-8",
      "Ocp-Apim-Subscription-Key": this.options.key,
      "X-ClientTraceId": randomUUID(),
    };

    if (this.options.region !== undefined) {
      headers["Ocp-Apim-Subscription-Region"] = this.options.region;
    }

    return headers;
  }
}

function createResponseError(
  response: Response,
  responseBody: unknown,
  operation: string,
): TranslationProviderError {
  const errorResult = errorResponseSchema.safeParse(responseBody);
  const details = errorResult.success
    ? `${errorResult.data.error.code} ${errorResult.data.error.message}`
    : response.statusText;

  return new TranslationProviderError(
    `Azure Translator V3 ${operation} returned ${response.status}: ${details}`,
  );
}

function createOperationUrl(endpoint: string, operation: string): URL {
  const url = new URL(endpoint);
  const basePath = url.pathname.replace(/\/$/, "");
  const resourceSpecificPath = url.hostname.endsWith(".cognitiveservices.azure.com")
    ? "/translator/text/v3.0"
    : "";

  url.pathname = `${basePath || resourceSpecificPath}/${operation}`.replace(/\/+/g, "/");
  url.search = "";
  url.searchParams.set("api-version", "3.0");
  return url;
}

function createTranslateUrl(
  options: AzureTranslatorProviderOptions,
  request: ProviderTranslateRequest,
): URL {
  const url = createOperationUrl(options.endpoint, "translate");
  url.searchParams.set("to", request.targetLanguage);
  url.searchParams.set("textType", request.textType);

  if (request.sourceLanguage !== undefined) {
    url.searchParams.set("from", request.sourceLanguage);
  }
  if (options.category !== undefined) {
    url.searchParams.set("category", options.category);
  }

  return url;
}