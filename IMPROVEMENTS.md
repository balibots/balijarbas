# Suggested Improvements

A prioritized list of potential enhancements for Balijarbas.

## 1. Persistent Scheduled Tasks

**Priority:** High  
**Complexity:** Medium

Currently, scheduled tasks are stored in memory and lost when the bot restarts. This should be persisted using Grammy's free storage (like notes/config) or a lightweight database.

**Implementation:**
- Store task definitions in session storage
- Recreate `node-schedule` jobs on startup
- Handle timezone considerations for recurring tasks

---

## 2. Multi-modal Message Support

**Priority:** High  
**Complexity:** Medium

Add support for processing images, voice messages, and documents. Both OpenAI and Gemini have vision and audio capabilities.

**Features:**
- Image analysis and description
- Voice message transcription (Whisper API)
- Document/PDF summarization
- Image generation responses

---

## 3. Streaming Responses

**Priority:** Medium  
**Complexity:** Medium

For longer responses, stream the output to Telegram instead of waiting for full completion. This improves perceived latency.

**Implementation:**
- Use streaming APIs from both providers
- Edit Telegram message progressively
- Handle rate limits on message edits (Telegram limits ~30/minute)

---

## 4. Conversation Summarization

**Priority:** Medium  
**Complexity:** Medium

Instead of simply truncating old messages when the context limit is reached, summarize the conversation history to preserve important context.

**Implementation:**
- Detect when approaching context limit
- Use LLM to generate a summary of older messages
- Store summary as a special "context" message
- Include summary in system prompt

---

## 5. Webhook Mode for Production

**Priority:** Medium  
**Complexity:** Low

Currently uses long polling. Webhook mode is more efficient and scalable for production deployments.

**Implementation:**
- Add webhook handler to MCP server's HTTP endpoint
- Configure Grammy to use webhooks
- Add SSL/TLS support (required for Telegram webhooks)
- Environment variable to toggle polling vs webhook mode

---

## 6. Enhanced Group Chat Features

**Priority:** Medium  
**Complexity:** Medium

Better handling of group chat dynamics with per-user context.

**Features:**
- Per-user notes within group chats
- Remember user preferences/names
- Configurable mention requirements
- Thread/reply awareness
- Admin-only configuration commands

---

## 7. Rate Limiting & Abuse Prevention

**Priority:** Medium  
**Complexity:** Low

Add rate limiting to prevent abuse, especially important when exposed publicly.

**Implementation:**
- Per-user request rate limits
- Per-chat daily limits
- Scheduled task limits per chat
- Configurable limits via environment variables
- Graceful limit exceeded messages

---

## 8. Observability & Monitoring

**Priority:** Medium  
**Complexity:** Medium

Add structured logging, metrics, and health monitoring for production deployments.

**Features:**
- Structured JSON logging with correlation IDs
- Prometheus metrics endpoint (request counts, latencies, errors)
- OpenTelemetry tracing support
- Dashboard-ready metrics (Grafana compatible)
- Alerting hooks for critical errors

---

## 9. Testing Suite

**Priority:** Low  
**Complexity:** Medium

Add comprehensive tests to ensure reliability and enable confident refactoring.

**Tests to add:**
- Unit tests for tool handlers
- Unit tests for LLM provider adapters
- Integration tests with mocked LLM responses
- End-to-end tests with Grammy's test utilities
- CI/CD pipeline with GitHub Actions

---

## 10. Plugin Architecture

**Priority:** Low  
**Complexity:** High

Make it easier to extend the bot with new capabilities via a plugin system.

**Features:**
- Plugin interface for adding new tools
- Dynamic plugin loading
- Plugin configuration via environment/files
- Built-in plugins: reminders, polls, games
- Plugin marketplace/registry (future)

---

## Quick Wins (Bonus)

These are smaller improvements that could be done quickly:

- [ ] Add `/help` command showing available features
- [ ] Add `/status` command showing bot uptime and stats
- [ ] Configurable response length (concise vs detailed)
- [ ] Support for message reactions as acknowledgment
- [ ] Auto-delete bot messages after configurable time
- [ ] Markdown/HTML formatting toggle per chat
- [ ] Export notes to file (JSON/Markdown)

---

## Contributing

If you'd like to work on any of these improvements, please:

1. Open an issue to discuss the approach
2. Reference this document in your PR
3. Update documentation as needed
4. Add tests for new functionality