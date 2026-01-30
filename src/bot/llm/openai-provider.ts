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

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: OpenAIProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.defaultModel = config.defaultModel ?? "gpt-5-mini";
  }

  async complete(
    input: InputItem[],
    tools: Tool[],
    options?: CompletionOptions,
  ): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;

    // Convert our tool format to OpenAI format
    const openaiTools = this.convertTools(tools);

    // Convert our input format to OpenAI format
    const openaiInput = this.convertInput(input);

    const params = {
      model,
      input: openaiInput,
      tools: openaiTools,
      ...(options?.temperature !== undefined && {
        temperature: options.temperature,
      }),
      ...(options?.maxTokens !== undefined && {
        max_output_tokens: options.maxTokens,
      }),
    };

    const response = await this.client.responses.create(params);

    return this.parseResponse(response);
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
          ...(tool.headers && { headers: tool.headers }),
        };
      } else if (tool.type === "web_search") {
        return { type: "web_search" as const };
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
        });
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
      rawOutput: response.output,
    };
  }
}
