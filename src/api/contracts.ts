import { z } from "zod/v4";

import {
  TRANSLATION_LIMITS,
  type TranslateCommand,
} from "../translation/service.js";

const textSchema = z.string().min(1).max(TRANSLATION_LIMITS.maxCharactersPerItem);

export const translateRequestSchema = z
  .object({
    text: z.union([
      textSchema,
      z.array(textSchema).min(1).max(TRANSLATION_LIMITS.maxItems),
    ]),
    targetLanguage: z.string().min(2).max(35).optional(),
    sourceLanguage: z.string().min(2).max(35).optional(),
    textType: z.enum(["plain", "html"]).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if ((request.sourceLanguage === undefined) !== (request.targetLanguage === undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "sourceLanguage and targetLanguage must be provided together, or both omitted for automatic Chinese-English translation.",
        path: [
          request.sourceLanguage === undefined ? "sourceLanguage" : "targetLanguage",
        ],
      });
    }
  });

export type TranslateRequest = z.infer<typeof translateRequestSchema>;

export function toTranslateCommand(request: TranslateRequest): TranslateCommand {
  return {
    texts: typeof request.text === "string" ? [request.text] : request.text,
    ...(request.targetLanguage === undefined
      ? {}
      : { targetLanguage: request.targetLanguage }),
    ...(request.sourceLanguage === undefined
      ? {}
      : { sourceLanguage: request.sourceLanguage }),
    ...(request.textType === undefined ? {} : { textType: request.textType }),
  };
}