import { Context, SessionFlavor } from "grammy";
import * as schedule from "node-schedule";

// Session message structure
export interface ChatMessage {
  role: "user" | "assistant";
  name: string;
  content: string;
  timestamp: number;
}

// Per-chat configuration
export interface ChatConfig {
  customPrompt: string | null; // Custom system prompt addition for this chat
  language: string | null; // Preferred response language
  personality: string | null; // Bot personality traits (e.g., "formal", "casual", "sarcastic")
}

// Note item structure (individual item within a keyed list)
export interface NoteItem {
  id: string;
  content: string;
  createdAt: number;
  createdBy: string;
}

// Notes store - keyed by category/list name
export type NotesStore = Record<string, NoteItem[]>;

// Session data structure
export interface SessionData {
  messages: ChatMessage[];
  config: ChatConfig;
  notes: NotesStore;
}

// Scheduled task structure
export interface ScheduledTask {
  id: string;
  chatId: number;
  prompt: string;
  schedule: string; // cron expression or ISO date string
  recurring: boolean;
  createdAt: number;
  createdBy: string;
  job: schedule.Job;
}

// Grammy context with session
export type MyContext = Context & SessionFlavor<SessionData>;
