import "dotenv/config";

// Telegram Bot Configuration
export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// LLM Provider Configuration
export const LLM_PROVIDER = process.env.LLM_PROVIDER ?? "openai";

// OpenAI Configuration
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

// Google Gemini Configuration
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash";

// MCP Server Configuration
export const MCP_URL = `${process.env.TELEGRAM_MCP_HOST}/mcp`;
export const MCP_API_KEY = process.env.TELEGRAM_MCP_API_KEY;

// ElevenLabs TTS Configuration
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
export const ELEVENLABS_DEFAULT_VOICE_ID =
  process.env.ELEVENLABS_DEFAULT_VOICE_ID ?? "aLFUti4k8YKvtQGXv0UO";
export const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2";

// Session Configuration
export const MAX_CONTEXT_MESSAGES = 5;

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
