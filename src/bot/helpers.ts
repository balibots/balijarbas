import { MyContext } from "./types.js";

export function isGroup(chat: MyContext["chat"]): boolean {
  return chat?.type === "group" || chat?.type === "supergroup";
}

export function wasMentioned(ctx: MyContext): boolean {
  const me = ctx.me?.username;
  const text = ctx.message?.text ?? "";
  if (!me) return false;
  return text.includes(`@${me}`);
}

export function isReplyToBot(ctx: MyContext): boolean {
  const reply = ctx.message?.reply_to_message;
  if (!reply?.from?.is_bot) return false;
  return reply.from.username === ctx.me?.username;
}

export function getUserName(ctx: MyContext): string {
  return (
    [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") ||
    "Unknown"
  );
}
