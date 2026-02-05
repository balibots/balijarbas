/**
 * LLM Integration Module
 *
 * Handles all LLM interactions using a provider abstraction layer
 * that supports multiple backends (OpenAI, Gemini, etc.)
 */

import { MyContext } from "./types.js";
import {
  LLMProvider,
  Tool,
  InputItem,
  UserInputContent,
  createProviderFromEnv,
} from "./llm/index.js";
import {
  tools as toolDefinitions,
  handleToolCall,
  getChatConfig,
  formatConfigForPrompt,
} from "./tools.js";
import { formatConversationHistory, addMessageToSession } from "./session.js";
import { wasMentioned, isReplyToBot, getUserName } from "./helpers.js";

// Create the LLM provider based on environment configuration
const provider: LLMProvider = createProviderFromEnv();

console.log(`Using LLM provider: ${provider.name}`);

const BASE_SYSTEM_PROMPT = [
  "You are a Telegram bot assistant controlling actions through tools.",
  "If user mentions the bot, answer their request.",
  "You can see and understand images that users send. When a user sends an image, analyze it and respond appropriately to any questions or requests about it.",
  "Never spam. Never respond to unrelated conversation. Be funny, be cool. This is Telegram for christ's sake.",
  "Use the Telegram MCP server tool to interact with Telegram if you need to. Don't forget to always call sendMessage in order to reply or acknowledge, your text output will NOT be sent automatically.",
  "If using Telegram MCP sendMessage, don't provide a parse_mode or a business_connection_id. NEVER include citations or citation markers on your sendMessage replies.",
  "You can schedule tasks using the schedule_task tool. For recurring tasks, use cron expressions. For one-time tasks, use ISO 8601 date strings. Use the prompt field to prompt yourself - don't be too prescriptive, it's fine to have logic there.",
  "Use web search whenever you're unsure about something - confirm your answers with reliable sources before you respond.",
  "You can configure per-chat configuration settings using get_config, set_config, and reset_config tools. Use these when users want to customize how you behave in their chat.",
  "You can save notes, to-do items, or any context the user wants you to remember using add_note, list_notes, remove_note, and clear_notes tools. Notes are organized by keys/categories (e.g., 'shopping list', 'todos', 'birthdays'). Use these when users ask you to remember something, manage lists, or recall saved information.",
  "You can not do anything else - if the user asks you to do something you can't with the tools you have at your disposal, politely deny the request.",
].join(" ");

function buildSystemPrompt(ctx: MyContext): string {
  const config = getChatConfig(ctx);
  const parts: string[] = [BASE_SYSTEM_PROMPT];

  // Add per-chat configuration
  const configPrompt = formatConfigForPrompt(config);
  if (configPrompt) {
    parts.push(`\n\n${configPrompt}`);
  }

  // Add notes context if any exist - removed this - expect the model to get this through the tool call if it needs it
  // const notesKeys = Object.keys(ctx.session.notes);
  // if (notesKeys.length > 0) {
  //   const notesContext = notesKeys
  //     .map((key) => {
  //       const items = ctx.session.notes[key];
  //       const itemsList = items.map((n) => `  - ${n.content}`).join("\n");
  //       return `${key}:\n${itemsList}`;
  //     })
  //     .join("\n");
  //   parts.push(`\n\nSaved notes/context for this chat:\n${notesContext}`);
  // }

  // Add current date
  parts.push(
    `\n\nThis is the current date if you need it: ${new Date().toISOString()}`,
  );

  return parts.join("");
}

function buildUserInput(
  ctx: MyContext,
  conversationHistory: string,
  imageUrl?: string,
): UserInputContent {
  const msg = ctx.message!;
  const chat = ctx.chat!;

  const textContent = [
    `chat_id=${chat.id} chat_type=${chat.type} chat_title=${"title" in chat ? chat.title : ""}`,
    `from=${ctx.from?.first_name ?? ""} ${ctx.from?.last_name ?? ""} (@${ctx.from?.username ?? ""})`,
    `message_id=${msg.message_id}`,
    `text=${"text" in msg ? msg.text : ""}`,
    `caption=${"caption" in msg ? msg.caption : ""}`,
    `was_mentioned=${wasMentioned(ctx)}`,
    `is_reply_to_bot=${isReplyToBot(ctx)}`,
    "",
    "--- Recent conversation history ---",
    conversationHistory,
    "--- End of history ---",
  ].join("\n");

  if (imageUrl) {
    return [
      { type: "input_text", text: textContent },
      { type: "input_image", image_url: imageUrl, detail: "auto" },
    ];
  }

  return textContent;
}

/**
 * Main decision and action loop
 * Uses the configured LLM provider to process messages and execute tool calls
 */
export async function decideAndAct(
  ctx: MyContext,
  imageUrl?: string,
): Promise<void> {
  const chat = ctx.chat!;

  const conversationHistory = formatConversationHistory(ctx.session.messages);
  const input = buildUserInput(ctx, conversationHistory, imageUrl);
  const userName = getUserName(ctx);

  const systemPrompt = buildSystemPrompt(ctx);

  // Build initial input
  let currentInput: InputItem[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input },
  ];

  // Convert tool definitions to the common format
  const tools: Tool[] = toolDefinitions as unknown as Tool[];

  // Loop to handle tool calls
  const MAX_TOOL_CALLS = 8;
  let numToolsCalled = 0;

  while (true) {
    const response = await provider.complete(currentInput, tools);

    // Check for function calls that need handling
    const functionCalls = response.toolCalls.filter(
      (tc) => tc.type === "function_call",
    );

    if (functionCalls.length > 0) {
      const toolResults: Array<{ callId: string; result: string }> = [];

      // Process each function call
      for (const call of functionCalls) {
        numToolsCalled++;

        const result = await handleToolCall(
          call.name,
          JSON.parse(call.arguments),
          ctx,
          userName,
        );

        console.log(`Tool call ${call.name} result: ${result}`);

        toolResults.push({
          callId: call.id,
          result,
        });
      }

      // Build input for next iteration
      currentInput = provider.buildNextInput(
        currentInput,
        response,
        toolResults,
      );

      // Continue the loop to let the model respond
      if (numToolsCalled <= MAX_TOOL_CALLS) {
        continue;
      } else {
        console.warn(
          `Maximum number of tools called (${numToolsCalled}) reached.`,
        );
      }
    }

    // Find any sendMessage MCP calls
    const sendMessages = response.toolCalls.filter(
      (tc) => tc.type === "mcp_call" && tc.name === "sendMessage",
    );

    console.log(
      `Found ${sendMessages.length} messages to send: ${JSON.stringify(sendMessages)}`,
    );

    // Record assistant messages in session
    for (const message of sendMessages) {
      try {
        const args = JSON.parse(message.arguments);
        addMessageToSession(
          ctx,
          "assistant",
          ctx.me?.first_name ?? "Bot",
          args.text ?? "",
        );
      } catch {
        // Ignore parse errors
      }
    }

    break;
  }
}

/**
 * Export the current provider for use in other modules (e.g., scheduler)
 */
export function getProvider(): LLMProvider {
  return provider;
}

/**
 * Process an inline query and return a text response
 * This is a simplified version without MCP tools or session context
 */
export async function processInlineQuery(
  query: string,
  userId: number,
  userName: string,
): Promise<string> {
  const systemPrompt = [
    "You are an AI assistant responding to an inline query in Telegram.",
    "Provide a helpful, concise, and direct answer to the user's query.",
    "Keep responses clear and informative. Do not use citations or markdown formatting that won't render properly.",
    "Use web search if you need to look up current information or verify facts.",
    `Current date: ${new Date().toISOString()}`,
  ].join(" ");

  const userInput = `User ${userName} (ID: ${userId}) asks: ${query}`;

  let currentInput: InputItem[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userInput },
  ];

  // Only allow web search for inline queries
  const tools: Tool[] = [{ type: "web_search" }];

  // Simple loop to handle potential web search calls
  const MAX_ITERATIONS = 3;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const response = await provider.complete(currentInput, tools);

    // If there's text output, return it
    if (response.textContent) {
      return response.textContent;
    }

    // If no output text and no tool calls, break
    if (response.toolCalls.length === 0) {
      break;
    }

    // Continue loop to let model process any web search results
    // The provider handles web search internally, so we just need to wait
    // for the final text response
    break;
  }

  return "I couldn't generate a response. Please try a different query.";
}
