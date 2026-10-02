import "dotenv/config";

// Telegram Bot Configuration
export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// LLM Provider Configuration
export const LLM_PROVIDER = process.env.LLM_PROVIDER ?? "openai";

// OpenAI Configuration
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-6-luna";

// Google Gemini Configuration
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash";

// MCP Server Configuration
export const MCP_URL = `${process.env.TELEGRAM_MCP_HOST}/mcp`;
export const MCP_API_KEY = process.env.TELEGRAM_MCP_API_KEY;

// ElevenLabs TTS Configuration
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
export const ELEVENLABS_DEFAULT_VOICE_ID =
  process.env.ELEVENLABS_DEFAULT_VOICE_ID ?? "UgBBYS2sOqTuMpoF3BR0"; // Mark
export const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2";

// Ops Configuration (admin-only access to own code, logs and infra)
export const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS ?? "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => Number.isInteger(id) && id > 0);
export const GITHUB_MCP_TOKEN = process.env.GITHUB_MCP_TOKEN;
export const GITHUB_REPO = process.env.GITHUB_REPO ?? "balibots/balijarbas";
export const FLY_API_TOKEN = process.env.FLY_API_TOKEN;
// Fly sets FLY_APP_NAME automatically on its machines
export const FLY_APP_NAME = process.env.FLY_APP_NAME ?? "balijarbas";

// Session Configuration
// How many messages (including tool action records) are kept in the session
export const MAX_STORED_MESSAGES = 60;
// Conversation history sent to the model: newest messages first, until either limit is hit
export const HISTORY_MAX_MESSAGES = 40;
export const HISTORY_CHAR_BUDGET = 24_000; // ~6k tokens
// Long messages are trimmed (head + tail) when rendered into history
export const HISTORY_MESSAGE_MAX_CHARS = 1_500;
export const TOOL_ACTION_MAX_CHARS = 300;
// Once unsummarized history outgrows the limits above, the oldest messages are
// folded into a rolling summary, keeping this many recent ones verbatim
export const HISTORY_KEEP_RECENT = 20;
export const SUMMARY_MAX_CHARS = 3_000;
// Model for summarization (defaults to the provider's main model)
export const SUMMARY_MODEL = process.env.SUMMARY_MODEL;

// Redis Configuration
export const REDIS_URL = process.env.REDIS_URL;

// Validation
if (!BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
if (!REDIS_URL) throw new Error("Missing REDIS_URL");
if (!process.env.TELEGRAM_MCP_HOST)
  throw new Error("Missing TELEGRAM_MCP_HOST");

// Validate LLM provider configuration
if (LLM_PROVIDER === "openai" && !OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY (required when LLM_PROVIDER=openai)");
}
if (LLM_PROVIDER === "gemini" && !GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY (required when LLM_PROVIDER=gemini)");
}
