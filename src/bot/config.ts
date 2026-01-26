import "dotenv/config";

// Telegram Bot Configuration
export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// LLM Provider Configuration
export const LLM_PROVIDER = process.env.LLM_PROVIDER ?? "openai";

// OpenAI Configuration
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

// Google Gemini Configuration
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

// MCP Server Configuration
export const MCP_URL = `${process.env.TELEGRAM_MCP_HOST}/mcp`;
export const MCP_API_KEY = process.env.TELEGRAM_MCP_API_KEY;

// Session Configuration
export const MAX_CONTEXT_MESSAGES = 10;

// Validation
if (!BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
if (!process.env.TELEGRAM_MCP_HOST)
  throw new Error("Missing TELEGRAM_MCP_HOST");

// Validate LLM provider configuration
if (LLM_PROVIDER === "openai" && !OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY (required when LLM_PROVIDER=openai)");
}
if (LLM_PROVIDER === "gemini" && !GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY (required when LLM_PROVIDER=gemini)");
}
