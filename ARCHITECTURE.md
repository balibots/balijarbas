# Balijarbas - Architecture Reference

## Tech Stack
- **Runtime:** Node.js 20+ (TypeScript)
- **Bot Framework:** Grammy (Telegram Bot API, polling mode)
- **Package Manager:** pnpm
- **Build:** tsc + esbuild

## Key Dependencies
- `grammy` v1.39.2 - Telegram bot framework
- `@google/genai` v1.37.0 - Google Gemini LLM
- `openai` v6.16.0 - OpenAI API (function calling)
- `node-schedule` v2.1.1 - Cron-based scheduling
- `@grammyjs/storage-free` v2.5.1 - Persistent session storage

## Project Structure
```
src/
├── index.ts                    # Entry point - forks MCP server, starts Grammy bot
├── bot/
│   ├── config.ts               # Environment variables & validation
│   ├── handlers.ts             # Grammy message handlers (text, photo, voice, inline queries)
│   ├── helpers.ts              # Utility functions (getUserName, downloadImage, etc.)
│   ├── llm.ts                  # Decision loop & LLM integration
│   ├── llm/
│   │   ├── index.ts            # Provider factory pattern
│   │   ├── types.ts            # Common LLM abstraction types
│   │   ├── openai-provider.ts  # OpenAI implementation
│   │   └── gemini-provider.ts  # Google Gemini implementation
│   ├── scheduler.ts            # Scheduled task execution
│   ├── session.ts              # Session management & conversation history
│   ├── tools.ts                # Tool definitions (12+ tools) & handlers
│   ├── types.ts                # TypeScript type definitions
│   └── elevenlabs.ts           # Text-to-speech & music generation (ElevenLabs)
└── mcp-server/telegram-mcp/    # Integrated Telegram MCP server
    ├── src/
    │   ├── index-http.ts       # HTTP transport (MCP 2025-03-26 spec)
    │   ├── telegram-api.ts     # Telegram API wrapper
    │   └── tools/              # 162 Telegram methods split into 16 categories
    └── build/                  # Compiled MCP server
```

## Process Architecture
```
┌─────────────────────────────────────────────┐
│           Main Process (index.ts)            │
│  • Grammy bot (Telegram polling)             │
│  • Session management                        │
│  • LLM agent loop (decideAndAct)             │
│  • Task scheduler (node-schedule)            │
└──────────┬──────────────────┬───────────────┘
           │ fork()           │ spawn() (local dev only)
           ▼                  ▼
┌─────────────────────┐ ┌─────────────────────────┐
│  Telegram MCP Server│ │  Playwright MCP Server   │
│  • Port 3001        │ │  • Port 8931 (optional)  │
│  • 162 Telegram APIs│ │  • Browser automation    │
│  • HTTP transport   │ │  • Headless Chromium     │
└─────────────────────┘ └─────────────────────────┘
```

- MCP servers auto-restart on crash (except SIGTERM)
- Graceful shutdown of all processes on SIGINT/SIGTERM
- Playwright MCP is optional — disabled when `PLAYWRIGHT_MCP_HOST` is unset

## LLM Provider Abstraction

Factory pattern via `createProviderFromEnv()`, selected by `LLM_PROVIDER` env var.

| Provider | Default Model | MCP Support | Web Search | SDK |
|----------|---------------|-------------|------------|-----|
| OpenAI | gpt-4.1-mini | Yes | Yes (native) | `openai` |
| Gemini | gemini-3-flash | Limited | Yes (Google Search grounding) | `@google/genai` |

Both implement `LLMProvider` interface returning `LLMResponse` with `toolCalls[]`, `textContent`, `rawOutput`.

## Message Flow
1. Grammy handler receives message (text/photo/voice)
2. Validates: Is bot? Is group? Was mentioned/replied-to?
3. Stores in Grammy session (max 5 messages, 16 KiB limit)
4. Calls `decideAndAct()` -> LLM processes with tools
5. Tool call loop (max 8 iterations per message)
6. Response sent via MCP's `sendMessage` tool

## Built-in Tools

| Category | Tools |
|----------|-------|
| Scheduling | schedule_task, list_tasks, cancel_task |
| Configuration | get_config, set_config, reset_config |
| Memory/Notes | add_note, list_notes, remove_note, clear_notes |
| Voice | send_voice_reply, generate_music (ElevenLabs, optional) |
| Search | web_search (provider native) |
| Browser | playwright-browser (Playwright MCP, optional) |
| Telegram API | telegram-mcp (162 methods via MCP) |

## Deployment

### Docker
- Node.js 20 Alpine, multi-stage build, non-root user (`botuser:nodejs`)
- Port 3001 exposed (MCP HTTP server)
- Health check on `/health`

### Fly.io
- Region: London (lhr)
- VM: shared CPU, 256MB RAM
- Auto-scaling: min 1 machine, auto-start enabled

### State
- **Persistent:** Grammy's free storage service (session data, config, notes)
- **In-memory only:** Scheduled tasks (lost on restart)
- **No database required**

## Key Design Decisions
- Group chats: only respond if mentioned or replied-to
- DMs: always respond
- Errors: notify in DMs, silent in groups
- System prompt: base + per-chat config + notes context + current date
- Images: downloaded, passed to LLM as URL (not stored in session)
- Voice: transcribed via ElevenLabs STT, processed as text
- Inline queries: simplified prompt, web_search only, single-turn

## Environment Variables
```
# Required
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_MCP_HOST=http://localhost:3001
LLM_PROVIDER=openai|gemini

# Provider-specific (one required)
OPENAI_API_KEY=xxx
OPENAI_MODEL=gpt-4.1-mini          # optional
GEMINI_API_KEY=xxx
GEMINI_MODEL=gemini-3-flash         # optional

# Optional
TELEGRAM_MCP_API_KEY=xxx            # MCP auth
ELEVENLABS_API_KEY=xxx              # Voice features
MCP_HTTP_PORT=3001                  # MCP server port
PLAYWRIGHT_MCP_HOST=https://...             # Playwright browser (optional)
PLAYWRIGHT_MCP_API_KEY=xxx                 # Playwright MCP auth (optional)
PLAYWRIGHT_MCP_SPAWN=true                  # Spawn Playwright MCP locally (optional)
PLAYWRIGHT_MCP_PORT=8931                   # Local spawn port (optional, default 8931)
```
