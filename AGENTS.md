# Agents Architecture

This document describes the AI agent architecture used in Balijarbas.

## Overview

Balijarbas uses a tool-calling agent pattern where an LLM acts as the central decision-maker, with access to various tools it can invoke to accomplish tasks. The agent operates in a loop, making tool calls until it determines the task is complete.

The system supports multiple LLM providers (OpenAI, Google Gemini) through a provider abstraction layer, making it easy to switch between or add new backends.

## Process Architecture

The application runs as two processes managed from a single entry point:

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Process (index.ts)                  │
├─────────────────────────────────────────────────────────────┤
│  • Grammy bot (Telegram polling)                            │
│  • Session management                                        │
│  • LLM agent loop                                           │
│  • Task scheduler                                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ fork()
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Child Process (MCP Server)                  │
├─────────────────────────────────────────────────────────────┤
│  • HTTP server on port 3001                                 │
│  • 162 Telegram Bot API methods                             │
│  • Streamable HTTP transport                                │
│  • Optional API key authentication                          │
└─────────────────────────────────────────────────────────────┘
```

**Location:** `src/index.ts`

The main process:
1. Forks the MCP server as a child process
2. Starts the Grammy bot
3. Handles graceful shutdown of both processes
4. Auto-restarts the MCP server if it crashes

```typescript
// Fork the MCP server process
const mcpProcess = fork(mcpServerPath, [], {
  stdio: ["inherit", "inherit", "inherit", "ipc"],
  env: process.env, // Share environment variables
});
```

## LLM Provider Architecture

The bot uses a provider abstraction layer to support multiple LLM backends.

**Location:** `src/bot/llm/`

```
src/bot/llm/
├── types.ts           # Common interfaces (LLMProvider, Tool, Message, etc.)
├── openai-provider.ts # OpenAI implementation
├── gemini-provider.ts # Google Gemini implementation
└── index.ts           # Factory functions and exports
```

### Provider Interface

```typescript
interface LLMProvider {
  readonly name: string;

  complete(
    input: InputItem[],
    tools: Tool[],
    options?: CompletionOptions,
  ): Promise<LLMResponse>;

  buildNextInput(
    currentInput: InputItem[],
    response: LLMResponse,
    toolResults: Array<{ callId: string; result: string }>,
  ): InputItem[];
}
```

### Supported Providers

| Provider | Environment Variable | Default Model | MCP Support | Web Search | SDK |
|----------|---------------------|---------------|-------------|------------|-----|
| OpenAI   | `OPENAI_API_KEY`    | gpt-6-luna  | ✅ Yes      | ✅ Yes     | `openai` |
| Gemini   | `GEMINI_API_KEY`    | gemini-3-flash | ⚠️ Limited | ✅ Yes (Google Search grounding) | `@google/genai` |

### Provider Selection

Set `LLM_PROVIDER` environment variable:

```bash
LLM_PROVIDER=openai   # Use OpenAI (default)
LLM_PROVIDER=gemini   # Use Google Gemini
```

### Adding a New Provider

1. Create a new file `src/bot/llm/my-provider.ts`
2. Implement the `LLMProvider` interface
3. Add to the factory in `src/bot/llm/index.ts`

```typescript
import { LLMProvider, LLMResponse, Tool, InputItem } from "./types.js";

export class MyProvider implements LLMProvider {
  readonly name = "my-provider";

  async complete(input: InputItem[], tools: Tool[]): Promise<LLMResponse> {
    // Convert input/tools to provider format
    // Make API call
    // Parse response into LLMResponse format
  }

  buildNextInput(currentInput, response, toolResults): InputItem[] {
    // Build input for next iteration after tool calls
  }
}
```

## Agent Types

### 1. Main Conversational Agent

**Location:** `src/bot/llm.ts` → `decideAndAct()`

The primary agent that handles all incoming messages. It receives user input along with conversation context and decides how to respond.

**Capabilities:**
- Natural language understanding
- Tool selection and invocation
- Multi-turn conversation handling
- Context-aware responses

**Flow:**
```
User Message → Build Context → LLM Decision → Tool Calls (loop) → Response
```

### 2. Scheduled Task Agent

**Location:** `src/bot/scheduler.ts` → `executeScheduledPrompt()`

A lightweight agent that executes scheduled prompts at specified times. It has a reduced toolset focused on Telegram interactions and web search.

**Capabilities:**
- Execute pre-defined prompts
- Send messages to chats
- Web search for dynamic content

## Tool Architecture

Tools are defined in `src/bot/tools.ts` and fall into three categories:

### MCP Tools (External)
Tools provided by the Telegram MCP server for interacting with Telegram's API.

```typescript
{
  type: "mcp",
  server_label: "telegram-mcp",
  server_url: MCP_URL,
  require_approval: "never",
  defer_loading: true,
}
```

The MCP server is **deferred**: its ~162 method definitions are not sent up front. The `tool_search` tool lets the model load the ones it needs on demand (reactions, polls, photos, pinning, etc.). Plain text replies go through the first-class `send_message` function tool instead, so the common path never needs a search.

### Built-in Tools (OpenAI)
Native tools provided by the OpenAI API.

```typescript
{ type: "web_search" }
{ type: "tool_search" } // loads deferred MCP tools on demand
```

### Function Tools (Custom)
Custom tools implemented locally with handlers in `handleToolCall()`.

| Tool | Purpose | Parameters |
|------|---------|------------|
| `send_message` | Send a text reply (first-class, not deferred) | `chat_id`, `text`, `reply_to_message_id?` |
| `schedule_task` | Create scheduled tasks | `prompt`, `schedule`, `recurring` |
| `list_tasks` | List scheduled tasks | - |
| `cancel_task` | Cancel a task | `task_id` |
| `add_note` | Add item to keyed notes | `key`, `content` |
| `list_notes` | List notes | `key?` |
| `remove_note` | Remove a note | `note_id` |
| `clear_notes` | Clear notes | `key?` |
| `get_config` | Get chat configuration | - |
| `set_config` | Update configuration | `custom_prompt?`, `language?`, `personality?` |
| `reset_config` | Reset to defaults | - |

### Ops Tools (Admin Only)
Defined in `src/bot/ops.ts`. Only added to the tool list when `isOpsEnabled(ctx)`: the sender is in `ADMIN_USER_IDS` **and** the chat is private. `handleOpsToolCall()` re-checks this and logs every call with `[ops]`.

| Tool | Purpose | Requires |
|------|---------|----------|
| `get_recent_logs` | Read the in-memory log buffer (`src/bot/logbuffer.ts`) | - |
| `get_infra_status` | Fly Machines API: state, checks, recent events | `FLY_API_TOKEN` |
| `github` (MCP, deferred) | Read-only access to the repo via `api.githubcopilot.com/mcp/` | `GITHUB_MCP_TOKEN` |

The log buffer captures console output from the main process and the MCP child (whose stdout/stderr are piped through the parent) and redacts secrets. It must be the first import in `src/index.ts`.

## Agent Loop

The main agent uses an iterative loop pattern:

```typescript
while (true) {
  const resp = await openai.responses.create({
    model: "gpt-6-luna",
    input: currentInput,
    tools,
  });

  // Check for function calls
  const functionCalls = resp.output.filter(
    (item) => item.type === "function_call"
  );

  if (functionCalls.length > 0) {
    // Execute tools and add results to context
    for (const call of functionCalls) {
      const result = await handleToolCall(...);
      currentInput.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: result,
      });
    }
    continue; // Let model process results
  }

  break; // No more tool calls needed
}
```

This allows the agent to:
1. Make multiple tool calls in sequence
2. Use results from one tool to inform the next
3. Decide when to stop and finalize response

## Context Building

### System Prompt Components

The system prompt is dynamically built from multiple sources:

1. **Base Instructions** - Core behavior guidelines
2. **Chat Configuration** - Custom prompts, language, personality
3. **Notes Context** - Saved notes organized by key
4. **Current Date** - For time-aware responses

```typescript
function buildSystemPrompt(ctx: MyContext): string {
  const parts: string[] = [BASE_SYSTEM_PROMPT];
  
  // Add per-chat config
  const configPrompt = formatConfigForPrompt(config);
  if (configPrompt) parts.push(configPrompt);
  
  // Add notes context
  if (notesKeys.length > 0) {
    parts.push(`Saved notes:\n${notesContext}`);
  }
  
  // Add current date
  parts.push(`Current date: ${new Date().toISOString()}`);
  
  return parts.join("");
}
```

### Conversation History

`buildHistoryTurns()` in `src/bot/session.ts` sends history as real `user`/`assistant` turns between the system prompt and the current message. It takes the newest entries up to `HISTORY_MAX_MESSAGES` / `HISTORY_CHAR_BUDGET`, trims long messages (head + tail) to `HISTORY_MESSAGE_MAX_CHARS`, and merges consecutive same-side entries into one turn. The system prompt only carries the date (not the time) so the prefix stays cacheable.

### Rolling Summary

`src/bot/summary.ts`. `maybeCompactHistory()` runs after the reply has been sent (not awaited) and folds messages into a summary with one extra LLM call when either:
- a new conversation has started after a pause longer than `CONVERSATION_GAP_MS` (6h), in which case the whole previous conversation is folded; or
- the messages not yet summarized outgrow the history budget, in which case everything except the newest `HISTORY_KEEP_RECENT` is folded.

The call uses `SUMMARY_MODEL`, which defaults to the main model. The new summary is rewritten from the old one plus the folded messages, capped at `SUMMARY_MAX_CHARS`.

The summary is stored under its own Redis key, `summary:<chatId>` → `{ text, coveredUpTo }`, not in the Grammy session. Background writes therefore can't race the session middleware, which writes the whole session back at the end of each update. The summary goes into the system prompt, and history only includes messages newer than `coveredUpTo`. It is cleared when the bot joins or leaves a chat. The summary has two sections. ABOUT THE CHAT holds lasting facts (people, preferences, running jokes). RECENT EVENTS holds dated bullets, which the summarizer marks as past once their date has gone by and compresses after about two weeks.

Time cues for the main agent: pauses longer than `GAP_MARKER_MS` (3h) get a `— 2 days later —` marker in the history. The current message notes a long silence before it, and the summary header in the prompt says how far the summary reaches.

### User Input Components

Each user message is enriched with metadata:

```typescript
function buildUserInput(ctx): string {
  return [
    `chat_id=${chat.id} chat_type=${chat.type}`,
    `from=${user.name} (@${user.username})`,
    `message_id=${msg.message_id}`,
    `text=${msg.text}`,
    `was_mentioned=${wasMentioned(ctx)}`,
    `is_reply_to_bot=${isReplyToBot(ctx)}`,
  ].join("\n");
}
```

## State Management

### Session State (Persistent)
Managed via Grammy's free storage, persists across restarts:
- `messages[]` - Conversation history (last 60 entries): chat messages plus `isAction` records of tool calls the bot made (`⚙ tool(args) → result`), so follow-ups can refer to what it did
- `config{}` - Chat configuration
- `notes{}` - Keyed notes store

Separately in Redis: `summary:<chatId>` - rolling summary of older conversation (see Rolling Summary)

### Runtime State (In-Memory)
Lost on restart:
- `scheduledTasks` - Active scheduled jobs

## Behavioral Guidelines

The agent is instructed to:

1. **Be concise** - Keep responses short
2. **Be contextual** - Only respond when mentioned or replied to in groups
3. **Be accurate** - Use web search to verify information
4. **Be non-intrusive** - Never spam or respond to unrelated conversation
5. **Use tools** - Always call `send_message` to actually send responses

## Extension Points

### Adding New Tools

1. Add tool definition to `tools` array in `tools.ts`:
```typescript
{
  type: "function",
  name: "my_new_tool",
  description: "What this tool does",
  parameters: {
    type: "object",
    properties: { /* ... */ },
    required: ["param1"],
  },
}
```

2. Add handler case in `handleToolCall()`:
```typescript
case "my_new_tool": {
  const { param1 } = args as { param1: string };
  // Implementation
  return JSON.stringify({ success: true, result: "..." });
}
```

3. Update system prompt if needed to inform the agent about the new capability.

### Adding New Agent Types

To create a specialized agent (e.g., for a specific task type):

1. Create a new function similar to `decideAndAct()`
2. Define a focused system prompt
3. Select appropriate subset of tools
4. Implement the agent loop with task-specific logic

## Model Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| Model | `gpt-6-luna` | Balance of capability and cost |
| Temperature | Default | Not explicitly set |
| Max Tokens | Default | Not explicitly set |

## Error Handling

- Tool errors return JSON with `success: false` and `error` message
- Agent can retry or inform user based on error type
- Unhandled errors in message handler fall back to generic error message (DMs only)
