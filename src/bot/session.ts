import { ChatMessage, ChatConfig, MyContext, SessionData } from "./types.js";
import {
  MAX_STORED_MESSAGES,
  HISTORY_MAX_MESSAGES,
  HISTORY_CHAR_BUDGET,
  HISTORY_MESSAGE_MAX_CHARS,
  TOOL_ACTION_MAX_CHARS,
  GAP_MARKER_MS,
} from "./config.js";

export const DEFAULT_CONFIG: ChatConfig = {
  customPrompt: null,
  language: null,
  personality: null,
};

// Prefix for tool action records in the history (the system prompt explains it)
export const ACTION_PREFIX = "⚙";

// Tools whose effect is already recorded as a chat message
const UNRECORDED_TOOLS = new Set(["send_message", "send_voice_reply"]);

export function createInitialSession(): SessionData {
  return {
    messages: [],
    config: { ...DEFAULT_CONFIG },
    notes: {},
  };
}

function pushMessage(ctx: MyContext, message: ChatMessage): void {
  ctx.session.messages.push(message);

  // Keep only the last N messages
  if (ctx.session.messages.length > MAX_STORED_MESSAGES) {
    ctx.session.messages = ctx.session.messages.slice(-MAX_STORED_MESSAGES);
  }
}

export function addMessageToSession(
  ctx: MyContext,
  role: "user" | "assistant",
  name: string,
  content: string,
  hasImage?: boolean,
): void {
  pushMessage(ctx, {
    role,
    name,
    content,
    ...(hasImage && { hasImage }),
    timestamp: Date.now(),
  });
}

/**
 * Record a compact trace of a tool call so follow-ups ("move that reminder")
 * can refer to what the bot actually did.
 */
export function addToolActionToSession(
  ctx: MyContext,
  toolName: string,
  args: Record<string, unknown>,
  result?: string,
): void {
  if (UNRECORDED_TOOLS.has(toolName)) return;

  const { chat_id: _chatId, ...rest } = args;
  const argsText = truncate(JSON.stringify(rest), TOOL_ACTION_MAX_CHARS);
  const resultText = result ? ` → ${truncate(result, TOOL_ACTION_MAX_CHARS)}` : "";

  pushMessage(ctx, {
    role: "assistant",
    name: ctx.me?.first_name ?? "Bot",
    content: `${ACTION_PREFIX} ${toolName}(${argsText})${resultText}`,
    isAction: true,
    timestamp: Date.now(),
  });
}

/**
 * Trim long text, keeping the start and the end
 */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.67);
  const tail = maxChars - head;
  return `${text.slice(0, head)} […truncated…] ${text.slice(-tail)}`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Human-readable length of a pause, e.g. "5 hours", "2 days"
 */
export function formatGap(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

export function formatHistoryLine(msg: ChatMessage): string {
  const content = truncate(msg.content, HISTORY_MESSAGE_MAX_CHARS);
  if (msg.role === "assistant") return content;

  const imageNote = msg.hasImage ? " [sent an image]" : "";
  return `[${formatTime(msg.timestamp)}] ${msg.name}: ${content}${imageNote}`;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Turn the stored messages into user/assistant turns for the model.
 * The last stored message is the one being handled and is sent separately.
 * Messages up to `coveredUpTo` are already in the summary and are skipped.
 * Takes the newest messages that fit the message/char budget; consecutive
 * messages from the same side (e.g. several group members) share a turn.
 */
export function buildHistoryTurns(
  messages: ChatMessage[],
  coveredUpTo = 0,
): HistoryTurn[] {
  const past = messages
    .slice(0, -1)
    .filter((msg) => msg.timestamp > coveredUpTo);

  const window: string[] = [];
  const roles: Array<"user" | "assistant"> = [];
  let chars = 0;
  for (
    let i = past.length - 1;
    i >= 0 && window.length < HISTORY_MAX_MESSAGES;
    i--
  ) {
    // Mark long pauses so old conversation isn't mistaken for the current one
    const gap = i > 0 ? past[i].timestamp - past[i - 1].timestamp : 0;
    const marker = gap > GAP_MARKER_MS ? `— ${formatGap(gap)} later —\n` : "";
    const line = marker + formatHistoryLine(past[i]);
    if (chars + line.length > HISTORY_CHAR_BUDGET) break;
    chars += line.length;
    window.unshift(line);
    roles.unshift(past[i].role);
  }

  const turns: HistoryTurn[] = [];
  window.forEach((line, i) => {
    const last = turns[turns.length - 1];
    if (last && last.role === roles[i]) {
      last.content += `\n${line}`;
    } else {
      turns.push({ role: roles[i], content: line });
    }
  });

  // Start on a user turn (some providers reject a leading model turn)
  while (turns[0]?.role === "assistant") turns.shift();

  return turns;
}

export function resetSession(ctx: MyContext): void {
  ctx.session.messages = [];
  ctx.session.config = { ...DEFAULT_CONFIG };
  ctx.session.notes = {};
}
