import { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import { InputFile } from "grammy";
import {
  MCP_URL,
  MCP_API_KEY,
  ELEVENLABS_API_KEY,
  ELEVENLABS_DEFAULT_VOICE_ID,
} from "./config.js";
import {
  createScheduledTask,
  listScheduledTasks,
  cancelScheduledTask,
  cancelAllTasksForChat,
} from "./scheduler.js";
import { textToSpeech, generateMusic, findVoiceForLanguage } from "./elevenlabs.js";
import { ChatConfig, MyContext, NoteItem } from "./types.js";

// Tool definitions exposed to the LLM
export const tools: ResponseCreateParamsNonStreaming["tools"] = [
  { type: "web_search" },
  {
    type: "function",
    name: "schedule_task",
    description:
      "Schedule a task to run at a specific time or on a recurring schedule. The prompt will be executed by the AI at the scheduled time and the response sent to the chat.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "The prompt to execute at the scheduled time. This will be sent to a LLM so it's fine to include logic or be a bit generative - don't be too prescriptive.",
        },
        schedule: {
          type: "string",
          description:
            "For recurring tasks: a cron expression (e.g., '0 9 * * *' for every day at 9 AM, '0 9 * * 1' for every Monday at 9 AM). For one-time tasks: an ISO 8601 date string (e.g., '2024-12-25T10:00:00Z').",
        },
        recurring: {
          type: "boolean",
          description:
            "Whether this is a recurring task (true) or a one-time task (false).",
        },
      },
      required: ["prompt", "schedule", "recurring"],
    },
  },
  {
    type: "function",
    name: "list_tasks",
    description:
      "List all scheduled tasks for the current chat, including their IDs, prompts, schedules, and next run times.",
    strict: false,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "cancel_task",
    description: "Cancel a scheduled task by its ID.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The ID of the task to cancel.",
        },
      },
      required: ["task_id"],
    },
  },
  {
    type: "function",
    name: "get_config",
    description:
      "Get the current configuration for the chat including custom prompt, language preference, and personality settings.",
    strict: false,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "set_config",
    description:
      "Update the chat configuration. You can set a custom prompt (additional instructions), preferred language, and/or personality. Pass null to clear a specific setting.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        custom_prompt: {
          type: ["string", "null"],
          description:
            "Custom instructions to add to the system prompt for this chat. This will be included in every response. Use this for things like 'Always respond with emojis' or 'You are a cooking assistant'. Pass null to clear.",
        },
        language: {
          type: ["string", "null"],
          description:
            "Preferred language and locale for responses (e.g., 'Portuguese', 'Spanish', 'French'). Pass null to clear and use default.",
        },
        personality: {
          type: ["string", "null"],
          description:
            "Personality traits for the bot (e.g., 'formal and professional', 'casual and friendly', 'sarcastic and witty', 'pirate speak'). Pass null to clear.",
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "reset_config",
    description:
      "Reset all chat configuration to defaults, clearing custom prompt, language, and personality settings.",
    strict: false,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "add_note",
    description:
      "Add an item to a keyed notes list. Use this to store to-do items, shopping lists, reminders, or any categorized information. Examples: 'add eggs to shopping list', 'remember that John's birthday is March 5th under birthdays'.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "The key/category for the note (e.g., 'shopping list', 'todos', 'birthdays', 'reminders', 'general'). Use lowercase and keep it simple.",
        },
        content: {
          type: "string",
          description: "The content of the note item to add to the list.",
        },
      },
      required: ["key", "content"],
    },
  },
  {
    type: "function",
    name: "list_notes",
    description:
      "List saved notes. Can list all notes across all keys, or notes under a specific key.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Optional: specific key/category to list. If omitted, lists all notes across all keys.",
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "remove_note",
    description:
      "Remove a specific note item by its ID. Use this when a to-do item is completed or a note is no longer needed.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        note_id: {
          type: "string",
          description: "The ID of the note item to remove.",
        },
      },
      required: ["note_id"],
    },
  },
  {
    type: "function",
    name: "clear_notes",
    description:
      "Clear notes. Can clear all notes or just notes under a specific key.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Optional: specific key/category to clear. If omitted, clears ALL notes.",
        },
      },
      required: [],
    },
  },
  ...(ELEVENLABS_API_KEY
    ? [
        {
          type: "function" as const,
          name: "send_voice_reply",
          description:
            "Convert text to speech using ElevenLabs and send it as a Telegram voice message. Use this when the user asks for a voice reply or audio message.",
          strict: false,
          parameters: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description:
                  "The text to convert to speech. Write naturally and conversationally — avoid markdown or formatting.",
              },
              chat_id: {
                type: "number",
                description: "The Telegram chat ID to send the voice message to.",
              },
              reply_to_message_id: {
                type: "number",
                description:
                  "Optional message ID to reply to.",
              },
              voice_id: {
                type: "string",
                description: `Optional ElevenLabs voice ID. Overrides automatic voice selection. Defaults to ${ELEVENLABS_DEFAULT_VOICE_ID}.`,
              },
              language: {
                type: "string",
                description:
                  "Language for voice selection (e.g. 'Portuguese', 'Spanish', 'Japanese', 'French'). When provided, searches the ElevenLabs voice library for a native voice trained on this language.",
              },
              accent: {
                type: "string",
                description:
                  "Optional accent to narrow voice selection (e.g. 'European' for European Portuguese, 'Brazilian' for Brazilian Portuguese, 'Castilian' for Castilian Spanish). Only used together with language.",
              },
              language_code: {
                type: "string",
                description:
                  "Optional ISO 639-1 language code (e.g. 'pt', 'es', 'ja') passed to the TTS API for correct pronunciation. Inferred automatically if language is provided.",
              },
            },
            required: ["text", "chat_id"],
          },
        },
        {
          type: "function" as const,
          name: "generate_music",
          description:
            "Generate music from a text description using ElevenLabs and send it as a Telegram audio file. Use this when the user asks you to generate, compose, or create music or a song.",
          strict: false,
          parameters: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description:
                  "A text description of the music to generate (e.g., 'chill lo-fi beat with soft piano and rain sounds').",
              },
              chat_id: {
                type: "number",
                description: "The Telegram chat ID to send the audio to.",
              },
              reply_to_message_id: {
                type: "number",
                description: "Optional message ID to reply to.",
              },
              duration_seconds: {
                type: "number",
                description:
                  "Duration of the generated music in seconds. Default 30, max 60.",
              },
              instrumental: {
                type: "boolean",
                description:
                  "Whether to force instrumental music (no vocals). Default false.",
              },
            },
            required: ["prompt", "chat_id"],
          },
        },
      ]
    : []),
  {
    type: "mcp",
    server_label: "telegram-mcp",
    server_description: "A Telegram MCP server exposing telegram functionality",
    server_url: MCP_URL,
    require_approval: "never",
    ...(MCP_API_KEY && {
      headers: {
        Authorization: `Bearer ${MCP_API_KEY}`,
      },
    }),
  },
];

// Helper to get config from session
export function getChatConfig(ctx: MyContext): ChatConfig {
  return ctx.session.config;
}

// Helper to format config for system prompt
export function formatConfigForPrompt(config: ChatConfig): string {
  const parts: string[] = [];

  if (config.customPrompt) {
    parts.push(`Custom instructions for this chat: ${config.customPrompt}`);
  }

  if (config.language) {
    parts.push(`Respond in ${config.language}.`);
  }

  if (config.personality) {
    parts.push(`Personality: ${config.personality}.`);
  }

  return parts.join("\n\n");
}

// Handle function tool calls from the LLM
export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: MyContext,
  userName: string,
): Promise<string> {
  const chatId = ctx.chat!.id;
  console.log(`Handling tool call: ${toolName} - ${JSON.stringify(args)}`);

  switch (toolName) {
    case "schedule_task": {
      const {
        prompt,
        schedule: scheduleExpr,
        recurring,
      } = args as {
        prompt: string;
        schedule: string;
        recurring: boolean;
      };
      const result = createScheduledTask(
        chatId,
        prompt,
        scheduleExpr,
        recurring,
        userName,
      );
      if (result.success) {
        return JSON.stringify({
          success: true,
          message: "Task scheduled successfully.",
          taskId: result.taskId,
        });
      } else {
        return JSON.stringify({ success: false, error: result.error });
      }
    }

    case "list_tasks": {
      const tasks = listScheduledTasks(chatId);
      return JSON.stringify({ tasks });
    }

    case "cancel_task": {
      const { task_id } = args as { task_id: string };
      const result = cancelScheduledTask(task_id, chatId);
      return JSON.stringify(result);
    }

    case "cancel_all_tasks": {
      cancelAllTasksForChat(chatId);
      return JSON.stringify({ success: true, message: "All tasks canceled." });
    }

    case "get_config": {
      const config = ctx.session.config;
      return JSON.stringify({ config });
    }

    case "set_config": {
      const { custom_prompt, language, personality } = args as {
        custom_prompt?: string | null;
        language?: string | null;
        personality?: string | null;
      };

      const currentConfig = ctx.session.config;
      ctx.session.config = {
        customPrompt:
          custom_prompt !== undefined
            ? custom_prompt
            : currentConfig.customPrompt,
        language: language !== undefined ? language : currentConfig.language,
        personality:
          personality !== undefined ? personality : currentConfig.personality,
      };

      return JSON.stringify({
        success: true,
        message: "Configuration updated.",
        config: ctx.session.config,
      });
    }

    case "reset_config": {
      ctx.session.config = {
        customPrompt: null,
        language: null,
        personality: null,
      };
      return JSON.stringify({
        success: true,
        message: "Configuration reset to defaults.",
        config: ctx.session.config,
      });
    }

    case "add_note": {
      const { key, content } = args as { key: string; content: string };
      const normalizedKey = key.toLowerCase().trim();
      const note: NoteItem = {
        id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        content,
        createdAt: Date.now(),
        createdBy: userName,
      };

      // Initialize the key if it doesn't exist
      if (!ctx.session.notes[normalizedKey]) {
        ctx.session.notes[normalizedKey] = [];
      }
      ctx.session.notes[normalizedKey].push(note);

      return JSON.stringify({
        success: true,
        message: `Note added to "${normalizedKey}".`,
        key: normalizedKey,
        note: {
          id: note.id,
          content: note.content,
          createdAt: new Date(note.createdAt).toISOString(),
          createdBy: note.createdBy,
        },
      });
    }

    case "list_notes": {
      const { key } = args as { key?: string };
      const notes = ctx.session.notes;

      if (key) {
        const normalizedKey = key.toLowerCase().trim();
        const keyNotes = notes[normalizedKey] ?? [];
        return JSON.stringify({
          key: normalizedKey,
          notes: keyNotes.map((n) => ({
            id: n.id,
            content: n.content,
            createdAt: new Date(n.createdAt).toISOString(),
            createdBy: n.createdBy,
          })),
          count: keyNotes.length,
        });
      }

      // List all notes across all keys
      const allNotes: Record<
        string,
        { id: string; content: string; createdAt: string; createdBy: string }[]
      > = {};
      let totalCount = 0;

      for (const [k, items] of Object.entries(notes)) {
        allNotes[k] = items.map((n) => ({
          id: n.id,
          content: n.content,
          createdAt: new Date(n.createdAt).toISOString(),
          createdBy: n.createdBy,
        }));
        totalCount += items.length;
      }

      return JSON.stringify({
        notes: allNotes,
        keys: Object.keys(notes),
        totalCount,
      });
    }

    case "remove_note": {
      const { note_id } = args as { note_id: string };

      // Search across all keys for the note
      for (const [key, items] of Object.entries(ctx.session.notes)) {
        const index = items.findIndex((n) => n.id === note_id);
        if (index !== -1) {
          items.splice(index, 1);
          // Clean up empty keys
          if (items.length === 0) {
            delete ctx.session.notes[key];
          }
          return JSON.stringify({
            success: true,
            message: `Note removed from "${key}".`,
            key,
          });
        }
      }

      return JSON.stringify({ success: false, error: "Note not found." });
    }

    case "clear_notes": {
      const { key } = args as { key?: string };

      if (key) {
        const normalizedKey = key.toLowerCase().trim();
        if (ctx.session.notes[normalizedKey]) {
          delete ctx.session.notes[normalizedKey];
          return JSON.stringify({
            success: true,
            message: `All notes under "${normalizedKey}" cleared.`,
            key: normalizedKey,
          });
        }
        return JSON.stringify({
          success: false,
          error: `No notes found under "${normalizedKey}".`,
        });
      }

      ctx.session.notes = {};
      return JSON.stringify({
        success: true,
        message: "All notes cleared.",
      });
    }

    case "generate_music": {
      const {
        prompt,
        chat_id,
        reply_to_message_id,
        duration_seconds,
        instrumental,
      } = args as {
        prompt: string;
        chat_id: number;
        reply_to_message_id?: number;
        duration_seconds?: number;
        instrumental?: boolean;
      };
      try {
        const durationSec = Math.min(duration_seconds ?? 30, 60);
        const buffer = await generateMusic(
          prompt,
          durationSec * 1000,
          instrumental ?? false,
        );
        await ctx.api.sendAudio(
          chat_id,
          new InputFile(buffer, "music.mp3"),
          {
            title: prompt.slice(0, 64),
            ...(reply_to_message_id && {
              reply_parameters: { message_id: reply_to_message_id },
            }),
          },
        );
        return JSON.stringify({ success: true, message: "Music sent." });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("generate_music error:", errorMessage);
        return JSON.stringify({ success: false, error: errorMessage });
      }
    }

    case "send_voice_reply": {
      const { text, chat_id, reply_to_message_id, voice_id, language, accent, language_code } = args as {
        text: string;
        chat_id: number;
        reply_to_message_id?: number;
        voice_id?: string;
        language?: string;
        accent?: string;
        language_code?: string;
      };
      try {
        // If language is specified and no explicit voice_id, find a native voice
        let resolvedVoiceId = voice_id;
        if (!resolvedVoiceId && language) {
          resolvedVoiceId = (await findVoiceForLanguage(language, accent)) ?? undefined;
        }
        const audioBuffer = await textToSpeech(text, resolvedVoiceId, undefined, language_code);
        await ctx.api.sendVoice(
          chat_id,
          new InputFile(audioBuffer, "voice.ogg"),
          {
            ...(reply_to_message_id && {
              reply_parameters: { message_id: reply_to_message_id },
            }),
          },
        );
        return JSON.stringify({ success: true, message: "Voice message sent." });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("send_voice_reply error:", errorMessage);
        return JSON.stringify({ success: false, error: errorMessage });
      }
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}
