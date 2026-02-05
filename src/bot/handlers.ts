import { Bot, session, StorageAdapter } from "grammy";
import { freeStorage } from "@grammyjs/storage-free";
import { MyContext, SessionData } from "./types.js";
import {
  createInitialSession,
  addMessageToSession,
  resetSession,
} from "./session.js";
import { cancelAllTasksForChat } from "./scheduler.js";
import {
  isGroup,
  wasMentioned,
  isReplyToBot,
  getUserName,
  downloadTelegramImage,
} from "./helpers.js";
import { decideAndAct, processInlineQuery } from "./llm.js";
import { InlineQueryResultArticle } from "grammy/types";

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

  // Handle photo messages
  bot.on("message:photo", async (ctx) => {
    if (ctx.from?.is_bot) return;

    // Hard gate: only consider acting in groups when mentioned or replied-to
    if (isGroup(ctx.chat) && !wasMentioned(ctx) && !isReplyToBot(ctx)) return;

    const userName = getUserName(ctx);
    const caption = ctx.message.caption ?? "";

    try {
      // Get the largest photo (last in the array)
      const photos = ctx.message.photo;
      const largestPhoto = photos[photos.length - 1];
      const imageUrl = await downloadTelegramImage(ctx, largestPhoto.file_id);

      // Store user message with image flag in session (not the full base64)
      addMessageToSession(ctx, "user", userName, caption, true);

      await decideAndAct(ctx, imageUrl);
    } catch (e) {
      console.error("decideAndAct error (photo):", e);
      // Stay low-noise; only notify in DMs
      if (!isGroup(ctx.chat)) {
        await ctx.api
          .sendMessage(
            ctx.chat.id,
            "I hit a snag processing that image. Try again in a moment.",
            {
              reply_parameters: { message_id: ctx.message.message_id },
            },
          )
          .catch(() => {});
      }
    }
  });

  // Handle inline queries - allows users to use @botname query in any chat
  bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim();

    // Require at least 3 characters to trigger a response
    if (query.length < 3) {
      await ctx.answerInlineQuery([], { cache_time: 0 });
      return;
    }

    const userId = ctx.from.id;
    const userName = ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : "");

    try {
      console.log(`Inline query from ${userName} (${userId}): ${query}`);

      const response = await processInlineQuery(query, userId, userName);

      // Truncate response if too long (Telegram limit is 4096 for message_text)
      const truncatedResponse = response.length > 4000
        ? response.slice(0, 3997) + "..."
        : response;

      // Create a preview/description (first 100 chars)
      const description = truncatedResponse.length > 100
        ? truncatedResponse.slice(0, 97) + "..."
        : truncatedResponse;

      const result: InlineQueryResultArticle = {
        type: "article",
        id: `inline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title: `Answer: ${query.slice(0, 50)}${query.length > 50 ? "..." : ""}`,
        description: description,
        input_message_content: {
          message_text: truncatedResponse,
        },
      };

      await ctx.answerInlineQuery([result], {
        cache_time: 300, // Cache for 5 minutes
        is_personal: true, // Results are personal to the user
      });

      console.log(`Inline query answered for ${userName}`);
    } catch (e) {
      console.error("Inline query error:", e);

      // Return an error result
      const errorResult: InlineQueryResultArticle = {
        type: "article",
        id: `error_${Date.now()}`,
        title: "Error processing query",
        description: "Something went wrong. Please try again.",
        input_message_content: {
          message_text: "Sorry, I couldn't process that query. Please try again or ask me directly in a chat.",
        },
      };

      await ctx.answerInlineQuery([errorResult], {
        cache_time: 0,
        is_personal: true,
      });
    }
  });
}
