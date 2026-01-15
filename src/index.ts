import { Bot } from "grammy";
import { BOT_TOKEN } from "./config.js";
import { MyContext } from "./types.js";
import { initScheduler } from "./scheduler.js";
import { setupHandlers } from "./handlers.js";

// Create bot instance
const bot = new Bot<MyContext>(BOT_TOKEN!);

// Initialize scheduler with bot instance
initScheduler(bot);

// Setup all handlers
setupHandlers(bot);

// Start the bot
bot.start();

console.log("Bot running (grammy polling) with MCP actions + model decision.");
console.log("Scheduled tasks system initialized.");
