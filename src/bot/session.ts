import { ChatMessage, ChatConfig, MyContext, SessionData } from "./types.js";
import { MAX_CONTEXT_MESSAGES } from "./config.js";

export const DEFAULT_CONFIG: ChatConfig = {
  customPrompt: null,
  language: null,
  personality: null,
};

export function createInitialSession(): SessionData {
  return {
    messages: [],
    config: { ...DEFAULT_CONFIG },
    notes: {},
  };
}

export function addMessageToSession(
  ctx: MyContext,
  role: "user" | "assistant",
  name: string,
  content: string,
): void {
  ctx.session.messages.push({
    role,
    name,
    content,
    timestamp: Date.now(),
  });

  // Keep only the last N messages
  if (ctx.session.messages.length > MAX_CONTEXT_MESSAGES) {
    ctx.session.messages = ctx.session.messages.slice(-MAX_CONTEXT_MESSAGES);
  }
}

export function formatConversationHistory(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    return "No previous messages in this conversation.";
  }

  return messages
    .map((msg) => `[${msg.role}] ${msg.name}: ${msg.content}`)
    .join("\n");
}

export function resetSession(ctx: MyContext): void {
  ctx.session.messages = [];
  ctx.session.config = { ...DEFAULT_CONFIG };
  ctx.session.notes = {};
}
