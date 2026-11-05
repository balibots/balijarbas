/**
 * OpenAI LLM Provider Implementation
 */

import OpenAI from "openai";
import {
  LLMProvider,
  LLMResponse,
  Tool,
  InputItem,
  ToolCall,
  CompletionOptions,
  OpenAIProviderConfig,
} from "./types.js";

// OpenAI fails the whole request when it can't list a remote MCP server's tools
const MCP_LIST_ERROR = /Error retrieving tool list from MCP server: '([^']+)'/;
// How long to leave out a server that failed before trying it again
const MCP_COOLDOWN_MS = 5 * 60 * 1000;

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private client: OpenAI;
  private defaultModel: string;
  // server_label -> time it may be retried
  private unavailableMcp = new Map<string, number>();

  constructor(config: OpenAIProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.defaultModel = config.defaultModel ?? "gpt-6-luna";
  }

  async complete(
    input: InputItem[],
    tools: Tool[],
    options?: CompletionOptions,
  ): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;

    // Convert our input format to OpenAI format
    const openaiInput = this.convertInput(input);

    // A broken MCP server must not take the bot down: drop it and retry
    // without it, once per server
    while (true) {
      const dropped = this.droppedMcpLabels(tools);
      const available = tools.filter(
        (t) => t.type !== "mcp" || !dropped.includes(t.server_label),
      );

      const params = {
        model,
        input:
          dropped.length > 0
            ? [
                ...openaiInput,
                {
                  role: "system" as const,
                  content: `These tool servers are temporarily unavailable: ${dropped.join(", ")}. Tell the user if they ask for something that needs them.`,
                },
              ]
            : openaiInput,
        tools: this.convertTools(available),
        ...(options?.temperature !== undefined && {
          temperature: options.temperature,
        }),
        ...(options?.maxTokens !== undefined && {
          max_output_tokens: options.maxTokens,
        }),
      };

      try {
        const response = await this.client.responses.create(params);
        return this.parseResponse(response);
      } catch (error) {
        const label = this.failedMcpLabel(error, available);
        if (!label) throw error;

        console.error(
          `MCP server '${label}' unavailable, retrying without it for ${MCP_COOLDOWN_MS / 60000}m: ${(error as Error).message}`,
        );
        this.unavailableMcp.set(label, Date.now() + MCP_COOLDOWN_MS);
      }
    }
  }

  /** Labels of MCP servers in `tools` that are still cooling down */
  private droppedMcpLabels(tools: Tool[]): string[] {
    const now = Date.now();
    return tools.flatMap((t) => {
      if (t.type !== "mcp") return [];
      const until = this.unavailableMcp.get(t.server_label);
      if (until === undefined) return [];
      if (until <= now) {
        this.unavailableMcp.delete(t.server_label);
        return [];
      }
      return [t.server_label];
    });
  }

  /** The MCP server an API error blames, if it's one we sent */
  private failedMcpLabel(error: unknown, tools: Tool[]): string | undefined {
    if (!(error instanceof OpenAI.APIError)) return undefined;
    const label = error.message.match(MCP_LIST_ERROR)?.[1];
    if (!label) return undefined;
    return tools.some((t) => t.type === "mcp" && t.server_label === label)
      ? label
      : undefined;
  }

  buildNextInput(
    currentInput: InputItem[],
    response: LLMResponse,
    toolResults: Array<{ callId: string; result: string }>,
  ): InputItem[] {
    // OpenAI needs the raw output items passed back
    const newInput: unknown[] = [
      ...this.convertInput(currentInput),
      ...(response.rawOutput ?? []),
    ];

    // Add tool results
    for (const { callId, result } of toolResults) {
      newInput.push({
        type: "function_call_output",
        call_id: callId,
        output: result,
      });
    }

    // Return as InputItem[] but it's actually OpenAI-specific format
    // This is a bit of a leaky abstraction but necessary for the loop
    return newInput as unknown as InputItem[];
  }

  private convertTools(
    tools: Tool[],
  ): OpenAI.Responses.ResponseCreateParamsNonStreaming["tools"] {
    return tools.map((tool) => {
      if (tool.type === "function") {
        return {
          type: "function" as const,
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict ?? false,
        };
      } else if (tool.type === "mcp") {
        return {
          type: "mcp" as const,
          server_label: tool.server_label,
          server_description: tool.server_description,
          server_url: tool.server_url,
          require_approval: tool.require_approval,
          ...(tool.defer_loading && { defer_loading: true }),
          ...(tool.headers && { headers: tool.headers }),
        };
      } else if (tool.type === "web_search") {
        return { type: "web_search" as const };
      } else if (tool.type === "tool_search") {
        return { type: "tool_search" as const };
      }
      throw new Error(`Unknown tool type: ${(tool as Tool).type}`);
    });
  }

  private convertInput(input: InputItem[]): OpenAI.Responses.ResponseInput {
    // For OpenAI, if we already have raw OpenAI format, return as-is
    // This happens when buildNextInput returns OpenAI-specific format
    if (
      input.length > 0 &&
      typeof input[0] === "object" &&
      "role" in input[0]
    ) {
      return input as unknown as OpenAI.Responses.ResponseInput;
    }
    return input as unknown as OpenAI.Responses.ResponseInput;
  }

  private parseResponse(response: OpenAI.Responses.Response): LLMResponse {
    const toolCalls: ToolCall[] = [];
    const webSearches: string[] = [];
    let textContent: string | undefined;

    for (const item of response.output) {
      if (item.type === "function_call") {
        toolCalls.push({
          type: "function_call",
          id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        });
      } else if (item.type === "mcp_call") {
        toolCalls.push({
          type: "mcp_call",
          id: item.id,
          name: item.name ?? "",
          arguments: "arguments" in item ? (item.arguments as string) : "{}",
          ...(item.output && { output: item.output }),
        });
      } else if (item.type === "web_search_call") {
        if (item.action?.type === "search" && item.action.query) {
          webSearches.push(item.action.query);
        }
      } else if (item.type === "message") {
        // Extract text content from message
        for (const content of item.content) {
          if (content.type === "output_text") {
            textContent = (textContent ?? "") + content.text;
          }
        }
      }
    }

    return {
      toolCalls,
      textContent,
      ...(webSearches.length > 0 && { webSearches }),
      rawOutput: response.output,
    };
  }
}
