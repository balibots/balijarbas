# Balijarbas

A smart Telegram bot powered by OpenAI that can manage tasks, remember context, and interact naturally in conversations. It can also access a Telegram MCP server... how useful that is is still not clear.

## Features

### 🤖 Natural Conversation
- Responds intelligently to mentions and direct messages
- Maintains conversation history for context-aware responses
- Works in both private chats and groups (responds when mentioned or replied to)

### ⏰ Task Scheduling
- Schedule one-time tasks using ISO 8601 dates
- Set up recurring tasks with cron expressions
- Tasks execute AI prompts automatically at scheduled times

### 📝 Keyed Notes / Memory
- Store notes, to-do lists, and context organized by categories
- Examples: "shopping list", "birthdays", "reminders", "todos"
- Persistent storage that survives bot restarts

### ⚙️ Per-Chat Configuration
- Custom system prompts per chat
- Language preferences
- Personality customization (formal, casual, sarcastic, etc.)

### 🔍 Web Search
- Can search the web to provide accurate, up-to-date information

### Access to Telegram MCP server
- Can do anything it has access to on Telegram in theory

## Prerequisites

- Node.js 18+
- pnpm
- A Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- An OpenAI API Key
- A running [Telegram MCP Server](https://github.com/ruiramos/telegram-mcp) instance

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/balijarbas.git
cd balijarbas

# Install dependencies
pnpm install
```

## Configuration

Create a `.env` file in the root directory:

```env
BOT_TOKEN=your_telegram_bot_token
OPENAI_API_KEY=your_openai_api_key
TELEGRAM_MCP_HOST=http://localhost:3000
TELEGRAM_MCP_API_KEY=your_mcp_api_key  # optional, if your MCP server requires it
```

## Running the Bot

```bash
# Development (with hot reload)
pnpm tsx src/index.ts

# Or compile and run
pnpm tsc
node dist/index.js
```

## Usage Examples

### Notes & Lists
- "Add eggs to my shopping list"
- "What's on my shopping list?"
- "Clear my shopping list"
- "Show me all my notes"

### Scheduling
- "Remind me to call mom tomorrow at 3pm"
- "Send me a daily motivation quote every morning at 9am"
- "What tasks do I have scheduled?"
- "Cancel task [task-id]"

### Configuration
- "Always respond in Portuguese"
- "Be more casual and use emojis"
- "Add a custom instruction to always include a joke"
- "Reset your settings"

## Architecture

```
src/
├── index.ts              # Entry point
├── bot/
│   ├── config.ts         # Environment configuration
│   ├── handlers.ts       # Grammy message handlers & session setup
│   ├── helpers.ts        # Utility functions
│   ├── llm.ts            # OpenAI integration & prompt building
│   ├── scheduler.ts      # Task scheduling system
│   ├── session.ts        # Session management
│   ├── tools.ts          # Tool definitions & handlers
│   └── types.ts          # TypeScript type definitions
└── mcp-server/           # MCP server integration (if self-hosted)
```

## Tech Stack

- **[Grammy](https://grammy.dev/)** - Telegram Bot Framework
- **[@grammyjs/storage-free](https://grammy.dev/plugins/session#free-storage)** - Free persistent session storage
- **[OpenAI API](https://platform.openai.com/)** - LLM for natural language understanding
- **[node-schedule](https://github.com/node-schedule/node-schedule)** - Cron-based task scheduling
- **[MCP (Model Context Protocol)](https://modelcontextprotocol.io/)** - Tool integration for Telegram actions

## Tools Available to the Bot

| Tool | Description |
|------|-------------|
| `telegram-mcp` | Supports all Telegram functions accessible to bots I suppose |
| `web_search` | Search the web for information |
| `schedule_task` | Schedule a one-time or recurring task |
| `list_tasks` | List all scheduled tasks |
| `cancel_task` | Cancel a scheduled task |
| `add_note` | Add an item to a keyed notes list |
| `list_notes` | List notes (all or by key) |
| `remove_note` | Remove a specific note by ID |
| `clear_notes` | Clear notes (all or by key) |
| `get_config` | Get current chat configuration |
| `set_config` | Update chat configuration |
| `reset_config` | Reset configuration to defaults |

## Session Persistence

The bot uses Grammy's free storage service for session persistence. This means:
- ✅ Notes, config, and conversation history persist across restarts
- ✅ No database setup required
- ✅ Automatic authentication via bot token
- ⚠️ 16 KiB limit per session
- ⚠️ 50,000 sessions max per bot

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC
