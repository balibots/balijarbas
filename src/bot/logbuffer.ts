/**
 * In-memory log buffer
 *
 * Captures console output from the bot (and piped output from the MCP child
 * process) into a ring buffer so the admin-only get_recent_logs tool can read
 * it. Importing this module installs the console capture, so import it first.
 */

import { format } from "util";

const MAX_LINES = 2000;
const lines: string[] = [];

// Env values that must never show up in logs handed to the LLM
const SECRET_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|REDIS_URL/i;
// Read lazily: this module loads before dotenv populates process.env
function secretValues(): string[] {
  return Object.entries(process.env)
    .filter(([k, v]) => SECRET_ENV_PATTERN.test(k) && v && v.length >= 8)
    .map(([, v]) => v as string);
}

const SECRET_PATTERNS = [
  /Bearer\s+\S+/gi,
  /FlyV1\s+\S+/g,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\b\d{6,}:[A-Za-z0-9_-]{30,}/g, // Telegram bot token
  /\b(redis|rediss|postgres|postgresql):\/\/[^\s]+/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const secret of secretValues()) {
    out = out.split(secret).join("[REDACTED]");
  }
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export function appendLog(source: string, level: string, text: string): void {
  const ts = new Date().toISOString();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    lines.push(`${ts} [${source}] ${level.toUpperCase()} ${redact(line)}`);
  }
  if (lines.length > MAX_LINES) {
    lines.splice(0, lines.length - MAX_LINES);
  }
}

/**
 * Returns a line-splitting writer for a child process stream, so chunks that
 * break mid-line are still recorded as whole lines.
 */
export function createStreamLogger(
  source: string,
  level: string,
): (chunk: Buffer | string) => void {
  let pending = "";
  return (chunk) => {
    pending += chunk.toString();
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    if (parts.length > 0) appendLog(source, level, parts.join("\n"));
  };
}

export function getRecentLogs(options: {
  lines?: number;
  grep?: string;
}): string[] {
  const limit = Math.min(Math.max(options.lines ?? 100, 1), 500);
  let result = lines;
  if (options.grep) {
    const needle = options.grep.toLowerCase();
    result = result.filter((l) => l.toLowerCase().includes(needle));
  }
  return result.slice(-limit);
}

// Install console capture on import
for (const level of ["log", "info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    appendLog("bot", level, format(...args));
  };
}
