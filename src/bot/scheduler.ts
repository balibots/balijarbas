/**
 * Task Scheduler Module
 *
 * Handles scheduling one-time and recurring tasks that execute LLM prompts
 */

import * as schedule from "node-schedule";
import { randomUUID } from "crypto";
import { Bot } from "grammy";
import { ScheduledTask, MyContext } from "./types.js";
import { MCP_URL, MCP_API_KEY } from "./config.js";
import {
  LLMProvider,
  Tool,
  InputItem,
  createProviderFromEnv,
} from "./llm/index.js";

// Create provider for scheduled tasks
let provider: LLMProvider;

function getSchedulerProvider(): LLMProvider {
  if (!provider) {
    provider = createProviderFromEnv();
  }
  return provider;
}

// Store scheduled tasks in memory
export const scheduledTasks = new Map<string, ScheduledTask>();

// Bot instance will be set via init function
let botInstance: Bot<MyContext>;

export function initScheduler(bot: Bot<MyContext>): void {
  botInstance = bot;
}

// Tools available for scheduled tasks (subset of main tools)
function getSchedulerTools(): Tool[] {
  return [
    {
      type: "mcp",
      server_label: "telegram-mcp",
      server_description:
        "A Telegram MCP server exposing telegram functionality",
      server_url: MCP_URL,
      require_approval: "never" as const,
      ...(MCP_API_KEY && {
        headers: {
          Authorization: `Bearer ${MCP_API_KEY}`,
        },
      }),
    },
    {
      type: "web_search",
    },
  ];
}

async function executeScheduledPrompt(task: ScheduledTask): Promise<void> {
  console.log(`Executing scheduled task ${task.id}: ${task.prompt}`);

  const systemPrompt = [
    "You are a Telegram bot executing a scheduled task.",
    "The user scheduled this prompt to run at this time.",
    "Execute the prompt and provide a helpful response.",
    "Keep your response concise.",
    "Use the Telegram MCP server tool to send messages - use sendMessage to send the response to the chat.",
    "If using Telegram MCP sendMessage, don't provide a parse_mode",
  ].join(" ");

  const input: InputItem[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Scheduled prompt for chat ${task.chatId}: ${task.prompt}`,
    },
  ];

  const tools = getSchedulerTools();
  const llmProvider = getSchedulerProvider();

  try {
    // Simple single-turn execution for scheduled tasks
    const response = await llmProvider.complete(input, tools);

    // Log what happened
    if (response.toolCalls.length > 0) {
      console.log(
        `Scheduled task ${task.id} made ${response.toolCalls.length} tool calls`,
      );
    }
    if (response.textContent) {
      console.log(
        `Scheduled task ${task.id} response: ${response.textContent}`,
      );
    }
  } catch (e) {
    console.error(`Error executing scheduled task ${task.id}:`, e);
  }

  // Remove one-time tasks after execution
  if (!task.recurring) {
    scheduledTasks.delete(task.id);
    console.log(`One-time task ${task.id} completed and removed.`);
  }
}

export function createScheduledTask(
  chatId: number,
  prompt: string,
  scheduleExpr: string,
  recurring: boolean,
  createdBy: string,
): { success: boolean; taskId?: string; error?: string } {
  const taskId = randomUUID();

  try {
    let job: schedule.Job;

    if (recurring) {
      // Cron expression for recurring tasks
      job = schedule.scheduleJob(scheduleExpr, () => {
        const task = scheduledTasks.get(taskId);
        if (task) executeScheduledPrompt(task);
      });
    } else {
      // ISO date string for one-time tasks
      const runDate = new Date(scheduleExpr);
      if (isNaN(runDate.getTime())) {
        return {
          success: false,
          error: "Invalid date format for one-time task. Use ISO 8601 format.",
        };
      }
      if (runDate <= new Date()) {
        return {
          success: false,
          error: "Scheduled time must be in the future.",
        };
      }
      job = schedule.scheduleJob(runDate, () => {
        const task = scheduledTasks.get(taskId);
        if (task) executeScheduledPrompt(task);
      });
    }

    if (!job) {
      return {
        success: false,
        error:
          "Failed to create schedule. Check the cron expression or date format.",
      };
    }

    const task: ScheduledTask = {
      id: taskId,
      chatId,
      prompt,
      schedule: scheduleExpr,
      recurring,
      createdAt: Date.now(),
      createdBy,
      job,
    };

    scheduledTasks.set(taskId, task);
    console.log(
      `Created scheduled task ${taskId}: "${prompt}" (${recurring ? "recurring" : "one-time"})`,
    );

    return { success: true, taskId };
  } catch (e) {
    return { success: false, error: `Failed to create task: ${e}` };
  }
}

export interface TaskInfo {
  id: string;
  prompt: string;
  schedule: string;
  recurring: boolean;
  createdBy: string;
  nextRun: string | null;
}

export function listScheduledTasks(chatId: number): TaskInfo[] {
  const tasks: TaskInfo[] = [];

  for (const task of scheduledTasks.values()) {
    if (task.chatId === chatId) {
      tasks.push({
        id: task.id,
        prompt: task.prompt,
        schedule: task.schedule,
        recurring: task.recurring,
        createdBy: task.createdBy,
        nextRun: task.job.nextInvocation()?.toISOString() ?? null,
      });
    }
  }

  return tasks;
}

export function cancelScheduledTask(
  taskId: string,
  chatId: number,
): { success: boolean; error?: string } {
  const task = scheduledTasks.get(taskId);

  if (!task) {
    return { success: false, error: "Task not found." };
  }

  if (task.chatId !== chatId) {
    return { success: false, error: "Task does not belong to this chat." };
  }

  task.job.cancel();
  scheduledTasks.delete(taskId);
  console.log(`Cancelled scheduled task ${taskId}`);

  return { success: true };
}

export function cancelAllTasksForChat(chatId: number): void {
  for (const [taskId, task] of scheduledTasks.entries()) {
    if (task.chatId === chatId) {
      task.job.cancel();
      scheduledTasks.delete(taskId);
      console.log(`Cancelled task ${taskId} due to bot leaving chat.`);
    }
  }
}
