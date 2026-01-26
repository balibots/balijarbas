/**
 * Google Gemini LLM Provider Implementation
 *
 * Uses the @google/genai SDK which supports:
 * - Function calling
 * - Google Search grounding
 * - MCP server tool use
 */

import { GoogleGenAI, Type } from "@google/genai";
import type {
  Content,
  FunctionCall,
  GenerateContentConfig,
  GenerateContentResponse,
  Part,
  Tool as GeminiTool,
} from "@google/genai";

import {
  LLMProvider,
  LLMResponse,
  Tool,
  InputItem,
  ToolCall,
  CompletionOptions,
  GeminiProviderConfig,
  FunctionTool,
} from "./types.js";

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private client: GoogleGenAI;
  private defaultModel: string;

  constructor(config: GeminiProviderConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.defaultModel = config.defaultModel ?? "gemini-2.5-flash";
  }

  async complete(
    input: InputItem[],
    tools: Tool[],
    options?: CompletionOptions,
  ): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;

    // Convert tools to Gemini format
    const geminiTools = this.convertTools(tools);

    // Convert input to Gemini format
    const { systemInstruction, contents } = this.convertInput(input);

    // Build config
    const config: GenerateContentConfig = {
      ...(systemInstruction && { systemInstruction }),
      ...(geminiTools.length > 0 && { tools: geminiTools }),
      ...(options?.temperature !== undefined && {
        temperature: options.temperature,
      }),
      ...(options?.maxTokens !== undefined && {
        maxOutputTokens: options.maxTokens,
      }),
    };

    const response = await this.client.models.generateContent({
      model,
      contents,
      config,
    });

    return this.parseResponse(response);
  }

  buildNextInput(
    currentInput: InputItem[],
    response: LLMResponse,
    toolResults: Array<{ callId: string; result: string }>,
  ): InputItem[] {
    // Get the current converted format
    const { systemInstruction, contents } = this.convertInput(currentInput);

    // Add the model's function calls as a model turn
    if (response.toolCalls.length > 0) {
      const functionCallParts: Part[] = [];

      for (const tc of response.toolCalls) {
        if (tc.type === "function_call") {
          functionCallParts.push({
            functionCall: {
              name: tc.name,
              args: JSON.parse(tc.arguments),
            },
          });
        } else if (tc.type === "mcp_call") {
          // MCP calls are handled by the SDK automatically
          // but we track them for our response parsing
        }
      }

      if (functionCallParts.length > 0) {
        contents.push({
          role: "model",
          parts: functionCallParts,
        });
      }
    }

    // Add function responses as a user turn (Gemini expects this for function results)
    const functionResponseParts: Part[] = [];

    for (const { callId, result } of toolResults) {
      // Find the original function call to get the name
      const originalCall = response.toolCalls.find((tc) => tc.id === callId);
      if (originalCall && originalCall.type === "function_call") {
        let parsedResult: Record<string, unknown>;
        try {
          parsedResult = JSON.parse(result);
        } catch {
          parsedResult = { result };
        }

        functionResponseParts.push({
          functionResponse: {
            name: originalCall.name,
            response: parsedResult,
          },
        });
      }
    }

    if (functionResponseParts.length > 0) {
      contents.push({
        role: "user",
        parts: functionResponseParts,
      });
    }

    // Return a special format that we can detect in convertInput
    // We encode the Gemini-native contents in a way that can be round-tripped
    return [
      {
        role: "system",
        content: systemInstruction ?? "",
      },
      {
        role: "user",
        content: JSON.stringify({ __gemini_contents: contents }),
      },
    ] as InputItem[];
  }

  private convertTools(tools: Tool[]): GeminiTool[] {
    const geminiTools: GeminiTool[] = [];

    for (const tool of tools) {
      if (tool.type === "function") {
        const funcTool = tool as FunctionTool;

        // Convert JSON Schema parameters to Gemini schema format
        const parameters = this.convertJsonSchemaToGemini(funcTool.parameters);

        geminiTools.push({
          functionDeclarations: [
            {
              name: funcTool.name,
              description: funcTool.description,
              parameters,
            },
          ],
        });
      } else if (tool.type === "web_search") {
        // Gemini supports Google Search as a built-in tool
        geminiTools.push({
          googleSearch: {},
        });
      } else if (tool.type === "mcp") {
        // Gemini SDK supports MCP servers directly
        // Note: This requires the model to support MCP (gemini-2.0+)
        // The SDK will handle the MCP protocol automatically
        // For now, we'll skip MCP tools as they require special handling
        // and may not be available in all regions/models
        console.warn(
          `MCP tool "${tool.server_label}" - MCP support in Gemini requires additional setup`,
        );
      }
    }

    return geminiTools;
  }

  private convertJsonSchemaToGemini(
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    // Convert JSON Schema to Gemini's schema format
    // Gemini uses a subset of JSON Schema with some differences
    const converted: Record<string, unknown> = {};

    if (schema.type) {
      // Map JSON Schema types to Gemini types
      const typeMap: Record<string, string> = {
        string: Type.STRING,
        number: Type.NUMBER,
        integer: Type.INTEGER,
        boolean: Type.BOOLEAN,
        array: Type.ARRAY,
        object: Type.OBJECT,
      };

      const schemaType = Array.isArray(schema.type)
        ? schema.type[0]
        : schema.type;
      converted.type = typeMap[schemaType as string] ?? Type.STRING;
    }

    if (schema.description) {
      converted.description = schema.description;
    }

    if (schema.properties) {
      converted.properties = {};
      for (const [key, value] of Object.entries(
        schema.properties as Record<string, unknown>,
      )) {
        (converted.properties as Record<string, unknown>)[key] =
          this.convertJsonSchemaToGemini(value as Record<string, unknown>);
      }
    }

    if (schema.required) {
      converted.required = schema.required;
    }

    if (schema.items) {
      converted.items = this.convertJsonSchemaToGemini(
        schema.items as Record<string, unknown>,
      );
    }

    if (schema.enum) {
      converted.enum = schema.enum;
    }

    return converted;
  }

  private convertInput(input: InputItem[]): {
    systemInstruction?: string;
    contents: Content[];
  } {
    let systemInstruction: string | undefined;
    const contents: Content[] = [];

    // Check if this is already Gemini-formatted content (from buildNextInput)
    if (input.length === 2 && "role" in input[1] && input[1].role === "user") {
      const userMsg = input[1] as { role: "user"; content: string };
      try {
        const parsed = JSON.parse(userMsg.content);
        if (parsed.__gemini_contents) {
          // Extract system instruction from the first item
          const sysMsg = input[0] as { role: "system"; content: string };
          if ("content" in sysMsg && sysMsg.content) {
            systemInstruction = sysMsg.content;
          }
          return {
            systemInstruction,
            contents: parsed.__gemini_contents as Content[],
          };
        }
      } catch {
        // Not Gemini format, continue with normal conversion
      }
    }

    for (const item of input) {
      if ("role" in item) {
        if (item.role === "system") {
          // Gemini uses systemInstruction for system messages
          systemInstruction = item.content;
        } else if (item.role === "user") {
          // Handle multimodal content (text + images)
          let parts: Part[];
          if (typeof item.content === "string") {
            parts = [{ text: item.content }];
          } else {
            // Array of input_text and input_image parts
            parts = item.content.map((part) => {
              if (part.type === "input_text") {
                return { text: part.text };
              } else {
                // input_image - Gemini expects inlineData or fileData
                // For URLs, we use fileData with the URL
                return {
                  fileData: {
                    mimeType: "image/jpeg", // Default, Gemini will detect actual type
                    fileUri: part.image_url,
                  },
                };
              }
            });
          }
          contents.push({
            role: "user",
            parts,
          });
        } else if (item.role === "assistant") {
          contents.push({
            role: "model",
            parts: [{ text: item.content }],
          });
        }
      }
      // FunctionCallOutput is handled in buildNextInput
    }

    return { systemInstruction, contents };
  }

  private parseResponse(response: GenerateContentResponse): LLMResponse {
    const toolCalls: ToolCall[] = [];
    let textContent: string | undefined;

    // Use the SDK's helper methods when available
    if (response.text) {
      textContent = response.text;
    }

    // Check for function calls
    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const fc of response.functionCalls) {
        const callId = `gemini_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        toolCalls.push({
          type: "function_call",
          id: callId,
          name: fc.name ?? "",
          arguments: JSON.stringify(fc.args ?? {}),
        });
      }
    }

    // Also check the raw response for any parts we might have missed
    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      const parts = candidates[0].content?.parts ?? [];

      for (const part of parts) {
        // Handle text parts if not already captured
        if ("text" in part && part.text && !textContent) {
          textContent = part.text;
        }

        // Handle function calls if not already captured via helper
        if (
          "functionCall" in part &&
          part.functionCall &&
          toolCalls.length === 0
        ) {
          const fc = part.functionCall as FunctionCall;
          const callId = `gemini_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          toolCalls.push({
            type: "function_call",
            id: callId,
            name: fc.name ?? "",
            arguments: JSON.stringify(fc.args ?? {}),
          });
        }
      }
    }

    return {
      toolCalls,
      textContent,
      rawOutput: candidates,
    };
  }
}
