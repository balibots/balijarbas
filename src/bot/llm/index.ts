/**
 * LLM Provider Factory and Exports
 */

export * from "./types.js";
export { OpenAIProvider } from "./openai-provider.js";
export { GeminiProvider } from "./gemini-provider.js";

import { LLMProvider, OpenAIProviderConfig, GeminiProviderConfig } from "./types.js";
import { OpenAIProvider } from "./openai-provider.js";
import { GeminiProvider } from "./gemini-provider.js";

export type ProviderType = "openai" | "gemini";

export interface CreateProviderOptions {
  type: ProviderType;
  config: OpenAIProviderConfig | GeminiProviderConfig;
}

/**
 * Factory function to create an LLM provider
 */
export function createProvider(options: CreateProviderOptions): LLMProvider {
  switch (options.type) {
    case "openai":
      return new OpenAIProvider(options.config as OpenAIProviderConfig);
    case "gemini":
      return new GeminiProvider(options.config as GeminiProviderConfig);
    default:
      throw new Error(`Unknown provider type: ${options.type}`);
  }
}

/**
 * Create provider from environment variables
 */
export function createProviderFromEnv(): LLMProvider {
  const providerType = (process.env.LLM_PROVIDER ?? "openai") as ProviderType;

  switch (providerType) {
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is required for OpenAI provider");
      }
      return new OpenAIProvider({
        apiKey,
        defaultModel: process.env.OPENAI_MODEL,
      });
    }
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is required for Gemini provider");
      }
      return new GeminiProvider({
        apiKey,
        defaultModel: process.env.GEMINI_MODEL,
      });
    }
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${providerType}`);
  }
}
