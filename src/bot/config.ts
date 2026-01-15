import "dotenv/config";

export const BOT_TOKEN = process.env.BOT_TOKEN;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const MCP_URL = `${process.env.TELEGRAM_MCP_HOST}/mcp`;
export const MCP_API_KEY = process.env.TELEGRAM_MCP_API_KEY;
export const MAX_CONTEXT_MESSAGES = 10;

if (!BOT_TOKEN) throw new Error("Missing BOT_TOKEN");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!process.env.TELEGRAM_MCP_HOST)
  throw new Error("Missing TELEGRAM_MCP_HOST");
