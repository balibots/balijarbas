import { fork, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Bot } from "grammy";
import { BOT_TOKEN } from "./bot/config.js";
import { MyContext } from "./bot/types.js";
import { initScheduler } from "./bot/scheduler.js";
import { setupHandlers } from "./bot/handlers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fork the MCP server process
function startMcpServer(): ChildProcess {
  const mcpServerPath = join(
    __dirname,
    "../src/",
    "mcp-server/telegram-mcp/build/index-http.js",
  );

  console.log("Starting MCP server...");

  const mcpProcess = fork(mcpServerPath, [], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: {
      ...process.env,
      MCP_API_KEY: process.env.TELEGRAM_MCP_API_KEY,
    }, // Pass the same environment variables
  });

  mcpProcess.on("error", (err) => {
    console.error("MCP server error:", err);
  });

  mcpProcess.on("exit", (code, signal) => {
    console.log(`MCP server exited with code ${code}, signal ${signal}`);
    // Optionally restart the MCP server
    if (code !== 0 && signal !== "SIGTERM") {
      console.log("Restarting MCP server in 5 seconds...");
      setTimeout(() => startMcpServer(), 5000);
    }
  });

  return mcpProcess;
}

// Start the MCP server
const mcpProcess = startMcpServer();

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

// Handle graceful shutdown
function shutdown() {
  console.log("Shutting down...");

  // Kill the MCP server process
  if (mcpProcess && !mcpProcess.killed) {
    mcpProcess.kill("SIGTERM");
  }

  // Stop the bot
  bot.stop();

  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
