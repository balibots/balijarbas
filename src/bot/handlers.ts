import { Bot, session, StorageAdapter } from "grammy";
import { freeStorage } from "@grammyjs/storage-free";
import { MyContext, SessionData } from "./types.js";
import {
  createInitialSession,
  addMessageToSession,
  resetSession,
} from "./session.js";
import { cancelAllTasksForChat } from "./scheduler.js";
import { isGroup, wasMentioned, isReplyToBot, getUserName } from "./helpers.js";
import { decideAndAct } from "./llm.js";

export function setupHandlers(bot: Bot<MyContext>): void {
  // Initialize session middleware with free persistent storage
  bot.use(
    session({
      initial: createInitialSession,
      storage: freeStorage<SessionData>(
        bot.token,
      ) as unknown as StorageAdapter<SessionData>,
    }),
  );

  // Reset session when bot is added to or removed from a chat
  bot.on("my_chat_member", async (ctx) => {
    const newStatus = ctx.myChatMember.new_chat_member.status;
    const oldStatus = ctx.myChatMember.old_chat_member.status;

    // Bot joined or rejoined the chat
    if (
      (newStatus === "member" || newStatus === "administrator") &&
      (oldStatus === "left" || oldStatus === "kicked")
    ) {
      resetSession(ctx);
      console.log(`Bot joined chat ${ctx.chat.id}, session reset.`);
    }

    // Bot left or was removed from the chat
    if (
      (newStatus === "left" || newStatus === "kicked") &&
      (oldStatus === "member" || oldStatus === "administrator")
    ) {
      resetSession(ctx);
      cancelAllTasksForChat(ctx.chat.id);
      console.log(`Bot left chat ${ctx.chat.id}, session and tasks reset.`);
    }
  });

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    if (ctx.from?.is_bot) return;

    // Hard gate: only consider acting in groups when mentioned or replied-to
    if (isGroup(ctx.chat) && !wasMentioned(ctx) && !isReplyToBot(ctx)) return;

    // Store user message in session
    const userName = getUserName(ctx);
    addMessageToSession(ctx, "user", userName, ctx.message.text);

    try {
      await decideAndAct(ctx);
    } catch (e) {
      console.error("decideAndAct error:", e);
      // Stay low-noise; only notify in DMs
      if (!isGroup(ctx.chat)) {
        await ctx.api
          .sendMessage(
            ctx.chat.id,
            "I hit a snag processing that. Try again in a moment.",
            {
              reply_parameters: { message_id: ctx.message.message_id },
            },
          )
          .catch(() => {});
      }
    }
  });
}
