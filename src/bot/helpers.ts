import { MyContext } from "./types.js";
import { BOT_TOKEN } from "./config.js";

export function isGroup(chat: MyContext["chat"]): boolean {
  return chat?.type === "group" || chat?.type === "supergroup";
}

export async function downloadTelegramImage(
  ctx: MyContext,
  fileId: string,
): Promise<string> {
  const file = await ctx.api.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const mimeType = file.file_path?.endsWith(".png") ? "image/png" : "image/jpeg";

  return `data:${mimeType};base64,${base64}`;
}

export function wasMentioned(ctx: MyContext): boolean {
  const me = ctx.me?.username;
  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
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
