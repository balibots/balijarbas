import OpenAI from "openai";
import { ResponseOutputMessage } from "openai/resources/responses/responses.js";
import { OPENAI_API_KEY } from "./config.js";
import { MyContext } from "./types.js";
import {
  tools,
  handleToolCall,
  getChatConfig,
  formatConfigForPrompt,
} from "./tools.js";
import { formatConversationHistory, addMessageToSession } from "./session.js";
import { isGroup, wasMentioned, isReplyToBot, getUserName } from "./helpers.js";
import { MCP_URL, MCP_API_KEY } from "./config.js";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const BASE_SYSTEM_PROMPT = [
  "You are a Telegram bot assistant controlling actions through tools.",
  "If user mentions the bot, answer their request.",
  "Never spam. Never respond to unrelated conversation. Be funny, be cool. This is Telegram for christ's sake.",
  "When you do respond, keep it short.",
  "Use the Telegram MCP server tool to interact with Telegram if you need to. Don't forget to always call sendMessage in order to reply or acknowledge, your text output will NOT be sent automatically.",
  `If using Telegram MCP sendMessage, don't provide a parse_mode`,
  "You can schedule tasks using the schedule_task tool. For recurring tasks, use cron expressions. For one-time tasks, use ISO 8601 date strings. Use the prompt field to prompt yourself - don't be too prescriptive, it's fine to have logic there.",
  "Use web search whenever you're unsure about something - confirm your answers with reliable sources before you respond.",
  "You can configure per-chat settings using get_config, set_config, and reset_config tools. Use these when users want to customize how you behave in their chat.",
  "You can save notes, to-do items, or any context the user wants you to remember using add_note, list_notes, remove_note, and clear_notes tools. Notes are organized by keys/categories (e.g., 'shopping list', 'todos', 'birthdays'). Use these when users ask you to remember something, manage lists, or recall saved information.",
].join(" ");

function buildSystemPrompt(ctx: MyContext): string {
  const config = getChatConfig(ctx);
  const parts: string[] = [BASE_SYSTEM_PROMPT];

  // Add per-chat configuration
  const configPrompt = formatConfigForPrompt(config);
  if (configPrompt) {
    parts.push(`\n\n${configPrompt}`);
  }

  // Add notes context if any exist
  const notesKeys = Object.keys(ctx.session.notes);
  if (notesKeys.length > 0) {
    const notesContext = notesKeys
      .map((key) => {
        const items = ctx.session.notes[key];
        const itemsList = items.map((n) => `  - ${n.content}`).join("\n");
        return `${key}:\n${itemsList}`;
      })
      .join("\n");
    parts.push(`\n\nSaved notes/context for this chat:\n${notesContext}`);
  }

  // Add current date
  parts.push(
    `\n\nThis is the current date if you need it: ${new Date().toISOString()}`,
  );

  return parts.join("");
}

function buildUserInput(ctx: MyContext, conversationHistory: string): string {
  const msg = ctx.message!;
  const chat = ctx.chat!;

  return [
    `chat_id=${chat.id} chat_type=${chat.type} chat_title=${"title" in chat ? chat.title : ""}`,
    `from=${ctx.from?.first_name ?? ""} ${ctx.from?.last_name ?? ""} (@${ctx.from?.username ?? ""})`,
    `message_id=${msg.message_id}`,
    `text=${msg.text}`,
    `was_mentioned=${wasMentioned(ctx)}`,
    `is_reply_to_bot=${isReplyToBot(ctx)}`,
    "",
    "--- Recent conversation history ---",
    conversationHistory,
    "--- End of history ---",
  ].join("\n");
}

export async function decideAndAct(ctx: MyContext): Promise<void> {
  const chat = ctx.chat!;

  const conversationHistory = formatConversationHistory(ctx.session.messages);
  const input = buildUserInput(ctx, conversationHistory);
  const userName = getUserName(ctx);

  console.log(JSON.stringify(input));

  const systemPrompt = buildSystemPrompt(ctx);

  let currentInput: OpenAI.Responses.ResponseInput = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input },
  ];

  // Loop to handle tool calls
  let numToolsCalled = 0;
  while (true) {
    const resp = await openai.responses.create({
      model: "gpt-5-mini",
      input: currentInput,
      tools,
    });

    // Check for function calls that need handling
    const functionCalls = resp.output.filter(
      (item) => item.type === "function_call",
    );

    if (functionCalls.length > 0) {
      // Add all outputs to input for context
      currentInput = [...currentInput, ...resp.output];

      // Process each function call
      for (const call of functionCalls) {
        numToolsCalled++;
        if (call.type === "function_call") {
          const result = await handleToolCall(
            call.name,
            JSON.parse(call.arguments),
            ctx,
            userName,
          );

          console.log(`Tool call ${call.name} result: ${result}`);

          currentInput.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: result,
          });
        }
      }

      // Continue the loop to let the model respond
      if (numToolsCalled <= 6) {
        continue;
      } else {
        console.warn(
          `Maximum number of tools called (${numToolsCalled}) reached.`,
        );
      }
    }

    // Find any sendMessage mcp function calls
    const sendMessages = resp.output.filter(
      (resp) => resp.type === "mcp_call" && resp.name === "sendMessage",
    );

    console.log(
      `Found ${sendMessages.length} messages to send: ${JSON.stringify(sendMessages)}`,
    );

    sendMessages.forEach(async (message) => {
      addMessageToSession(
        ctx,
        "assistant",
        ctx.me?.first_name ?? "Bot",
        "arguments" in message ? JSON.parse(message.arguments).text : "",
      );
    });

    break;
  }
}

export async function _telegramMcpCall(
  tool: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(MCP_API_KEY && { authorization: `Bearer ${MCP_API_KEY}` }),
    },
    body: JSON.stringify({ tool, params }),
  });
  if (!res.ok) {
    throw new Error(`MCP ${tool} failed: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}
