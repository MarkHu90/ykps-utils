# Repository instructions

- Use Node.js 20 or newer, TypeScript ESM, strict compiler settings, and `.js` suffixes in relative imports.
- Keep translation behavior in `src/translation/`; REST and MCP modules should remain protocol adapters around `TranslationService`.
- Add translation vendors by implementing `TranslationProvider`. Never read provider credentials outside configuration/bootstrap code.
- Never log API keys, Azure SDK request objects, authorization headers, or source text.
- Keep stdout free of non-protocol output in `src/stdio.ts`; stdio diagnostics belong on stderr.
- Validate changes with `npm run check` and `npm run build`.

Official references:

- MCP TypeScript SDK v2: https://ts.sdk.modelcontextprotocol.io/v2/
- MCP TypeScript SDK source and examples: https://github.com/modelcontextprotocol/typescript-sdk
- MCP specification: https://modelcontextprotocol.io/specification/latest
- Azure Translator TypeScript REST client: https://learn.microsoft.com/javascript/api/overview/azure/ai-translation-text-rest-readme
- Azure Translator text API: https://learn.microsoft.com/azure/ai-services/translator/text-translation/reference/v3/translate