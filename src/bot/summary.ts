/**
 * Rolling conversation summary
 *
 * The oldest messages are folded into a summary by an extra LLM call when a
 * chat's unsummarized history outgrows the history budget (keeping the most
 * recent ones verbatim), or when a new conversation starts after a long pause
 * (folding the whole previous one). The summary lives under its own Redis key
 * (not in the Grammy session) so it can be written in the background without
 * racing the session middleware, and `coveredUpTo` marks which messages it
 * includes.
 */

import { ChatMessage } from "./types.js";
import { LLMProvider } from "./llm/index.js";
import { redis } from "./redis.js";
import { formatHistoryLine, formatTime, truncate } from "./session.js";
import {
  HISTORY_MAX_MESSAGES,
  HISTORY_CHAR_BUDGET,
  HISTORY_KEEP_RECENT,
  SUMMARY_MAX_CHARS,
  SUMMARY_MODEL,
  CONVERSATION_GAP_MS,
} from "./config.js";

export interface ChatSummary {
  text: string;
  coveredUpTo: number; // timestamp of the newest message folded into the summary
  updatedAt: number;
}

const SUMMARY_PROMPT = [
  "You maintain the running memory of a Telegram chat between users and a bot assistant.",
  "You get the current date, the current summary (possibly empty) and a transcript of the next, older messages that are about to leave the bot's view. Rewrite the summary so it also covers them.",
  "",
  "Use exactly these two sections:",
  "",
  "ABOUT THE CHAT — lasting facts that don't expire:",
  "- who the participants are, how they relate, facts and stated preferences about them;",
  "- running jokes, recurring topics and the general tone of the chat.",
  "",
  "RECENT EVENTS — dated bullets, newest first, each starting with its date (e.g. '2026-10-03:'):",
  "- topics discussed and what was concluded or decided;",
  "- open questions, unfinished requests and anything someone is waiting on;",
  "- what the bot did or promised (lines starting with ⚙ are its tool calls — keep task IDs, scheduled times, note keys);",
  "- concrete details worth remembering: names, dates, numbers, places, links.",
  "",
  "Rules:",
  "- Always use absolute dates. Turn relative times ('tomorrow', 'in 2 hours') into dates using the message timestamps.",
  "- Compare plans and deadlines with the current date: if their date has passed, rewrite them as past ('trip to Lisbon was planned for Nov 6–9 — probably happened') instead of keeping them as upcoming.",
  "- Events older than about two weeks: squeeze into a single line or drop them, unless they are still open or someone is waiting on them. Move anything lasting they revealed (a preference, a fact about someone) to ABOUT THE CHAT.",
  "- Drop small talk, greetings and anything fully resolved or superseded by later messages.",
  "- Write in English, keeping names and quoted terms in their original language.",
  `- Stay under ${Math.floor(SUMMARY_MAX_CHARS / 6)} words. Merge and compress rather than append; if space runs out, drop the oldest and least relevant events first.`,
  "",
  "Output only the summary.",
].join("\n");

const key = (chatId: number) => `summary:${chatId}`;

// Chats with a compaction in flight (single process, so in-memory is enough)
const compacting = new Set<number>();

export async function getSummary(chatId: number): Promise<ChatSummary | null> {
  try {
    const raw = await redis.get(key(chatId));
    return raw ? (JSON.parse(raw) as ChatSummary) : null;
  } catch (error) {
    console.error(`[summary] read failed chat=${chatId}:`, error);
    return null;
  }
}

export async function clearSummary(chatId: number): Promise<void> {
  await redis.del(key(chatId)).catch((error) => {
    console.error(`[summary] clear failed chat=${chatId}:`, error);
  });
}

/**
 * Index where the newest conversation starts: right after the last pause
 * longer than CONVERSATION_GAP_MS (0 if there is none).
 */
function lastConversationStart(pending: ChatMessage[]): number {
  for (let i = pending.length - 1; i > 0; i--) {
    if (pending[i].timestamp - pending[i - 1].timestamp > CONVERSATION_GAP_MS) {
      return i;
    }
  }
  return 0;
}

/**
 * Pick the messages to fold into the summary, or none if nothing is due.
 * - After a long pause, the whole previous conversation is folded.
 * - If what's left still outgrows the history budget, only the newest
 *   HISTORY_KEEP_RECENT messages (within half the char budget) are kept.
 */
function selectMessagesToFold(
  messages: ChatMessage[],
  coveredUpTo: number,
): ChatMessage[] {
  const pending = messages.filter((msg) => msg.timestamp > coveredUpTo);
  const lengths = pending.map((msg) => formatHistoryLine(msg).length);

  let foldEnd = lastConversationStart(pending);
  const remainingChars = lengths
    .slice(foldEnd)
    .reduce((sum, len) => sum + len, 0);

  if (
    pending.length - foldEnd > HISTORY_MAX_MESSAGES ||
    remainingChars > HISTORY_CHAR_BUDGET
  ) {
    let kept = 0;
    let keptChars = 0;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (kept >= HISTORY_KEEP_RECENT) break;
      if (keptChars + lengths[i] > HISTORY_CHAR_BUDGET / 2) break;
      kept++;
      keptChars += lengths[i];
    }
    foldEnd = Math.max(foldEnd, pending.length - kept);
  }

  // History turns start on a user message, so leading bot messages in the kept
  // part would be dropped from view — fold them in instead
  while (foldEnd < pending.length && pending[foldEnd].role === "assistant") {
    foldEnd++;
  }

  const fold = pending.slice(0, foldEnd);
  if (fold.length === 0) return [];

  // Messages sharing the boundary timestamp go in too, since the history
  // filter hides everything up to and including coveredUpTo
  const boundary = fold[fold.length - 1].timestamp;
  return pending.filter((msg) => msg.timestamp <= boundary);
}

function formatTranscriptLine(msg: ChatMessage): string {
  const line = formatHistoryLine(msg);
  // User lines already carry time and name
  return msg.role === "user"
    ? line
    : `[${formatTime(msg.timestamp)}] ${msg.name} (bot): ${line}`;
}

/**
 * Fold old messages into the chat's summary if a fold is due (long pause or
 * history over budget). Meant to be called without awaiting, after the reply has been sent.
 */
export async function maybeCompactHistory(
  chatId: number,
  messages: ChatMessage[],
  provider: LLMProvider,
): Promise<void> {
  if (compacting.has(chatId)) return;
  compacting.add(chatId);

  try {
    const current = await getSummary(chatId);
    const fold = selectMessagesToFold(messages, current?.coveredUpTo ?? 0);
    if (fold.length === 0) return;

    const input = [
      `Current date: ${formatTime(Date.now())} UTC`,
      "",
      "=== CURRENT SUMMARY ===",
      current?.text ?? "(empty)",
      "",
      "=== MESSAGES TO FOLD IN (oldest first, UTC timestamps) ===",
      ...fold.map(formatTranscriptLine),
    ].join("\n");

    const response = await provider.complete(
      [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: input },
      ],
      [],
      { ...(SUMMARY_MODEL && { model: SUMMARY_MODEL }) },
    );

    const text = response.textContent?.trim();
    if (!text) {
      console.warn(`[summary] empty summary chat=${chatId}, keeping previous`);
      return;
    }

    const summary: ChatSummary = {
      text: truncate(text, SUMMARY_MAX_CHARS),
      coveredUpTo: fold[fold.length - 1].timestamp,
      updatedAt: Date.now(),
    };
    await redis.set(key(chatId), JSON.stringify(summary));

    console.log(
      `[summary] chat=${chatId} folded=${fold.length} chars=${summary.text.length}`,
    );
  } catch (error) {
    console.error(`[summary] compaction failed chat=${chatId}:`, error);
  } finally {
    compacting.delete(chatId);
  }
}
