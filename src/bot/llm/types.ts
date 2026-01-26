/**
 * Common types for LLM provider abstraction
 */

// Tool types that can be passed to LLM providers
export interface FunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export interface McpTool {
  type: "mcp";
  server_label: string;
  server_description: string;
  server_url: string;
  require_approval: "always" | "never";
  headers?: Record<string, string>;
}

export interface WebSearchTool {
  type: "web_search";
}

export type Tool = FunctionTool | McpTool | WebSearchTool;

// Message types for conversation
export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: string;
}

export interface FunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export type Message = SystemMessage | UserMessage | AssistantMessage;
export type InputItem = Message | FunctionCallOutput;

// Tool call from LLM response
export interface FunctionCall {
  type: "function_call";
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface McpCall {
  type: "mcp_call";
  id: string;
  name: string;
  arguments: string; // JSON string
}

export type ToolCall = FunctionCall | McpCall;

// LLM response
export interface LLMResponse {
  // Tool calls the model wants to make
  toolCalls: ToolCall[];
  // Text content (if any)
  textContent?: string;
  // Raw output items for providers that need them passed back
  rawOutput?: unknown[];
}

// Options for LLM completion
export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// LLM Provider interface
export interface LLMProvider {
  /**
   * Provider name for logging/debugging
   */
  readonly name: string;

  /**
   * Run a completion with the given input and tools
   */
  complete(
    input: InputItem[],
    tools: Tool[],
    options?: CompletionOptions,
  ): Promise<LLMResponse>;

  /**
   * Build the input for the next iteration after tool calls
   * Some providers need the raw output passed back
   */
  buildNextInput(
    currentInput: InputItem[],
    response: LLMResponse,
    toolResults: Array<{ callId: string; result: string }>,
  ): InputItem[];
}

// Provider configuration
export interface OpenAIProviderConfig {
  apiKey: string;
  defaultModel?: string;
}

export interface GeminiProviderConfig {
  apiKey: string;
  defaultModel?: string;
}

export type ProviderConfig = OpenAIProviderConfig | GeminiProviderConfig;
