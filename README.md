# Balijarbas

A smart Telegram bot powered by OpenAI that can manage tasks, remember context, and interact naturally in conversations. Includes an integrated Telegram MCP server for full Telegram API access.

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

### 📱 Full Telegram API Access
- Integrated MCP server exposing 162 Telegram Bot API methods
- Send messages, manage chats, handle media, and more

## Prerequisites

- Node.js 18+
- pnpm
- A Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- An OpenAI API Key

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/balijarbas.git
cd balijarbas

# Install dependencies
pnpm install

# Install MCP server dependencies
cd src/mcp-server/telegram-mcp && npm install && cd ../../..

# Build the MCP server
pnpm build:mcp
```

## Configuration

Create a `.env` file in the root directory:

```env
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_MCP_HOST=http://localhost:3001

# LLM Provider (choose one: "openai" or "gemini")
LLM_PROVIDER=openai

# OpenAI Configuration (required if LLM_PROVIDER=openai)
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini             # Optional, defaults to gpt-4.1-mini

# Google Gemini Configuration (required if LLM_PROVIDER=gemini)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash         # Optional, defaults to gemini-2.5-flash

# Optional
MCP_HTTP_PORT=3001                    # Port for the MCP server (default: 3001)
MCP_API_KEY=your_mcp_api_key          # API key for MCP server authentication
CORS_ORIGIN=*                         # CORS allowed origins
```

### LLM Providers

The bot supports multiple LLM providers via the `@google/genai` and `openai` SDKs:

| Provider | Models | Function Tools | Google Search | MCP Tools |
|----------|--------|----------------|---------------|-----------|
| OpenAI | gpt-4.1-mini, gpt-4o, etc. | ✅ | ✅ (web_search) | ✅ |
| Gemini | gemini-2.5-flash, gemini-2.5-pro | ✅ | ✅ (grounding) | ⚠️ Limited |

**Notes:**
- Both providers support function calling for custom tools (scheduling, notes, config)
- OpenAI has full MCP support for Telegram API integration
- Gemini uses Google Search grounding for web searches
- Gemini MCP support requires additional setup and may not be available in all regions

## Running the Bot

### Local Development

```bash
# Development (runs both bot and MCP server with tsx)
pnpm dev

# Production
pnpm build        # Build both bot and MCP server
pnpm start        # Run compiled code

# Other commands
pnpm typecheck    # Run TypeScript type checking
pnpm build:mcp    # Build only the MCP server
```

The main process automatically:
- Forks the MCP server as a child process
- Restarts the MCP server if it crashes
- Handles graceful shutdown of both processes

### Docker

```bash
# Build and run with docker-compose (recommended)
docker-compose up -d

# Or build manually
docker build -t balijarbas .
docker run -d \
  --name balijarbas \
  -e BOT_TOKEN=your_bot_token \
  -e OPENAI_API_KEY=your_openai_key \
  -p 3001:3001 \
  balijarbas

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

The Docker image:
- Uses multi-stage build for smaller image size
- Runs as non-root user for security
- Includes health checks for the MCP server
- Auto-restarts on failure

## Usage Examples

### Notes & Lists
- "Add eggs to my shopping list"
- "Remember that John's birthday is March 5th"
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
├── index.ts                    # Entry point - starts bot & forks MCP server
├── bot/
│   ├── config.ts               # Environment configuration
│   ├── handlers.ts             # Grammy message handlers & session setup
│   ├── helpers.ts              # Utility functions
│   ├── llm.ts                  # OpenAI integration & prompt building
│   ├── scheduler.ts            # Task scheduling system
│   ├── session.ts              # Session management
│   ├── tools.ts                # Tool definitions & handlers
│   └── types.ts                # TypeScript type definitions
└── mcp-server/
    └── telegram-mcp/           # Integrated Telegram MCP server
        ├── src/
        │   ├── index-http.ts   # HTTP transport server
        │   ├── telegram-api.ts # Telegram API wrapper
        │   └── tools/          # Tool implementations by category
        └── build/              # Compiled MCP server
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
| `telegram-mcp` | Full Telegram Bot API (162 methods) |
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

## MCP Server

The integrated MCP server provides HTTP access to the Telegram Bot API:

- **Endpoint:** `http://localhost:3001/mcp`
- **Health check:** `http://localhost:3001/health`
- **Authentication:** Optional API key via `MCP_API_KEY`
- **Tools:** 162 Telegram Bot API methods

The server is automatically started as a child process when the bot runs.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC