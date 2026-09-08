export const TRANSLATION_LIMITS = {
  maxItems: 100,
  maxCharactersPerItem: 10_000,
  maxCharactersPerRequest: 50_000,
} as const;

export type TextType = "plain" | "html";

export interface TranslateCommand {
  texts: readonly string[];
  targetLanguage?: string;
  sourceLanguage?: string;
  textType?: TextType;
}

export interface ProviderTranslateRequest {
  texts: readonly string[];
  targetLanguage: string;
  sourceLanguage?: string;
  textType: TextType;
}

export interface ProviderTranslation {
  text: string;
  detectedSourceLanguage?: string;
}

export interface TranslationProvider {
  readonly name: string;
  detectLanguages(texts: readonly string[]): Promise<readonly string[]>;
  translate(request: ProviderTranslateRequest): Promise<readonly ProviderTranslation[]>;
}

export interface TranslationItem {
  sourceText: string;
  text: string;
  detectedSourceLanguage?: string;
}

export interface TranslationResult {
  provider: string;
  targetLanguage: string;
  translations: readonly TranslationItem[];
}

export class TranslationError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_REQUEST" | "PROVIDER_ERROR" | "PROVIDER_NOT_CONFIGURED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class TranslationValidationError extends TranslationError {
  constructor(message: string) {
    super(message, "INVALID_REQUEST");
  }
}

export class TranslationProviderError extends TranslationError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "PROVIDER_ERROR", options);
  }
}

const LANGUAGE_CODE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export class TranslationService {
  constructor(private readonly provider: TranslationProvider) {}

  async translate(command: TranslateCommand): Promise<TranslationResult> {
    const normalizedCommand = normalizeCommand(command);
    const targetLanguage =
      normalizedCommand.targetLanguage ??
      (normalizedCommand.sourceLanguage === undefined
        ? await this.detectAutomaticTarget(normalizedCommand.texts)
        : automaticTargetFor(normalizedCommand.sourceLanguage));
    const request: ProviderTranslateRequest = {
      texts: normalizedCommand.texts,
      targetLanguage,
      textType: normalizedCommand.textType,
      ...(normalizedCommand.sourceLanguage === undefined
        ? {}
        : { sourceLanguage: normalizedCommand.sourceLanguage }),
    };
    const translatedItems = await this.provider.translate(request);

    if (translatedItems.length !== request.texts.length) {
      throw new TranslationProviderError(
        `Translation provider returned ${translatedItems.length} result(s) for ${request.texts.length} input(s).`,
      );
    }

    return {
      provider: this.provider.name,
      targetLanguage: request.targetLanguage,
      translations: translatedItems.map((translation, index) => ({
        sourceText: request.texts[index]!,
        text: translation.text,
        ...(translation.detectedSourceLanguage === undefined
          ? {}
          : { detectedSourceLanguage: translation.detectedSourceLanguage }),
      })),
    };
  }

  private async detectAutomaticTarget(texts: readonly string[]): Promise<string> {
    const detectedLanguages = await this.provider.detectLanguages(texts);
    if (detectedLanguages.length !== texts.length) {
      throw new TranslationProviderError(
        `Translation provider detected ${detectedLanguages.length} language(s) for ${texts.length} input(s).`,
      );
    }

    const targets = new Set(detectedLanguages.map(automaticTargetFor));
    if (targets.size !== 1) {
      throw new TranslationValidationError(
        "Automatic routing cannot mix Chinese and English texts in one batch.",
      );
    }

    return [...targets][0]!;
  }
}

interface NormalizedCommand {
  texts: readonly string[];
  targetLanguage?: string;
  sourceLanguage?: string;
  textType: TextType;
}

function normalizeCommand(command: TranslateCommand): NormalizedCommand {
  if (command.texts.length === 0) {
    throw new TranslationValidationError("At least one text is required.");
  }

  if (command.texts.length > TRANSLATION_LIMITS.maxItems) {
    throw new TranslationValidationError(
      `A request can contain at most ${TRANSLATION_LIMITS.maxItems} texts.`,
    );
  }

  let totalCharacters = 0;
  for (const text of command.texts) {
    if (text.trim().length === 0) {
      throw new TranslationValidationError("Texts must not be empty.");
    }

    if (text.length > TRANSLATION_LIMITS.maxCharactersPerItem) {
      throw new TranslationValidationError(
        `Each text can contain at most ${TRANSLATION_LIMITS.maxCharactersPerItem} characters.`,
      );
    }

    totalCharacters += text.length;
  }

  if (totalCharacters > TRANSLATION_LIMITS.maxCharactersPerRequest) {
    throw new TranslationValidationError(
      `A request can contain at most ${TRANSLATION_LIMITS.maxCharactersPerRequest} characters in total.`,
    );
  }

  if ((command.sourceLanguage === undefined) !== (command.targetLanguage === undefined)) {
    throw new TranslationValidationError(
      "sourceLanguage and targetLanguage must be provided together, or both omitted for automatic Chinese-English translation.",
    );
  }

  const targetLanguage = command.targetLanguage
    ? normalizeLanguageCode(command.targetLanguage, "targetLanguage")
    : undefined;
  const sourceLanguage = command.sourceLanguage
    ? normalizeLanguageCode(command.sourceLanguage, "sourceLanguage")
    : undefined;
  const textType = command.textType ?? "plain";

  if (textType !== "plain" && textType !== "html") {
    throw new TranslationValidationError("textType must be either plain or html.");
  }

  return {
    texts: [...command.texts],
    textType,
    ...(targetLanguage === undefined ? {} : { targetLanguage }),
    ...(sourceLanguage === undefined ? {} : { sourceLanguage }),
  };
}

function automaticTargetFor(sourceLanguage: string): string {
  const normalized = sourceLanguage.toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return "en";
  }
  if (normalized === "en" || normalized.startsWith("en-")) {
    return "zh-Hans";
  }

  throw new TranslationValidationError(
    `Automatic routing supports only Chinese and English, but detected ${sourceLanguage}. Specify targetLanguage to translate other languages.`,
  );
}

function normalizeLanguageCode(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!LANGUAGE_CODE_PATTERN.test(normalized)) {
    throw new TranslationValidationError(
      `${fieldName} must be a BCP 47-style language code such as en, zh-Hans, or pt-BR.`,
    );
  }

  return normalized;
}