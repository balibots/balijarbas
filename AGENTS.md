# Agents Architecture

This document describes the AI agent architecture used in Balijarbas.

## Overview

Balijarbas uses a tool-calling agent pattern where an LLM (GPT-4.1-mini) acts as the central decision-maker, with access to various tools it can invoke to accomplish tasks. The agent operates in a loop, making tool calls until it determines the task is complete.

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
}
```

**Available Actions:**
- `sendMessage` - Send messages to chats
- Other Telegram API methods exposed by the MCP server

### Built-in Tools (OpenAI)
Native tools provided by the OpenAI API.

```typescript
{ type: "web_search" }
```

### Function Tools (Custom)
Custom tools implemented locally with handlers in `handleToolCall()`.

| Tool | Purpose | Parameters |
|------|---------|------------|
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

## Agent Loop

The main agent uses an iterative loop pattern:

```typescript
while (true) {
  const resp = await openai.responses.create({
    model: "gpt-5-mini",
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

### User Input Components

Each user message is enriched with metadata:

```typescript
function buildUserInput(ctx, conversationHistory): string {
  return [
    `chat_id=${chat.id} chat_type=${chat.type}`,
    `from=${user.name} (@${user.username})`,
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
```

## State Management

### Session State (Persistent)
Managed via Grammy's free storage, persists across restarts:
- `messages[]` - Conversation history (last 10 messages)
- `config{}` - Chat configuration
- `notes{}` - Keyed notes store

### Runtime State (In-Memory)
Lost on restart:
- `scheduledTasks` - Active scheduled jobs

## Behavioral Guidelines

The agent is instructed to:

1. **Be concise** - Keep responses short
2. **Be contextual** - Only respond when mentioned or replied to in groups
3. **Be accurate** - Use web search to verify information
4. **Be non-intrusive** - Never spam or respond to unrelated conversation
5. **Use tools** - Always call `sendMessage` to actually send responses

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
| Model | `gpt-5-mini` | Balance of capability and cost |
| Temperature | Default | Not explicitly set |
| Max Tokens | Default | Not explicitly set |

## Error Handling

- Tool errors return JSON with `success: false` and `error` message
- Agent can retry or inform user based on error type
- Unhandled errors in message handler fall back to generic error message (DMs only)
