// lib/adapters/openai-adapter.ts

import type { AIService, ChatCompletionOptions, AIMessage, ChatCompletionChunk } from "../ai-service";
import { registerAIService } from "../ai-service";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

class OpenAICompatibleService implements AIService {
  private apiKey: string;
  private baseUrl: string;

  constructor(config?: { apiKey?: string; baseUrl?: string }) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || ""; // 允许从环境变量获取
    this.baseUrl = config?.baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL;

    if (!this.apiKey) {
      // 对于OpenAI兼容服务，API Key通常是必需的
      // 但某些自建或特殊配置的兼容服务可能不需要，所以这里仅作警告
      console.warn("OpenAICompatibleService: API key is not configured. Calls may fail if the endpoint requires authentication.");
    }
  }

  async getChatCompletion(
    options: ChatCompletionOptions
  ): Promise<ReadableStream<Uint8Array> | AIMessage> {
    const { model, messages, stream, max_tokens, temperature } = options;

    const endpoint = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    // 构造与OpenAI API兼容的请求体
    const body: Record<string, any> = {
      model,
      messages: messages.map(msg => ({ role: msg.role, content: msg.content })),
      stream: !!stream, // 确保是布尔值
    };

    if (max_tokens !== undefined) {
      body.max_tokens = max_tokens;
    }
    if (temperature !== undefined) {
      body.temperature = temperature;
    }
    // 可以根据需要添加其他OpenAI支持的参数，如 top_p, presence_penalty 等
    // if (options.top_p !== undefined) body.top_p = options.top_p;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(
          `OpenAI API request failed with status ${response.status}: ${errorBody.error?.message || errorBody.message || "Unknown error"}`
        );
      }

      if (stream) {
        if (!response.body) {
          throw new Error("OpenAI API stream response body is null");
        }
        // 直接返回原始的SSE流，前端或调用方将负责解析
        // 如果需要统一块格式，可以在这里转换，但通常OpenAI兼容的流已经是 data: JSON\n\n 格式
        // 这里我们假设调用者能处理标准的SSE流，或者在更高层进行统一的SSE解析
        // 为了与HuggingFaceAdapter的流输出格式（data: JSON\n\n 且JSON是ChatCompletionChunk）保持一致，
        // 我们需要转换一下。
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        const transformStream = new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller) {
            const textChunk = decoder.decode(chunk, { stream: true });
            // OpenAI的流通常是 `data: {...}\n\n` 的形式，每行一个data: JSON
            // 我们需要确保我们的输出也是这种格式，并且JSON内容符合ChatCompletionChunk
            const lines = textChunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const jsonStr = line.substring('data: '.length).trim();
                if (jsonStr === '[DONE]') {
                  // OpenAI流结束标记
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  return;
                }
                try {
                  const openAIChatChunk = JSON.parse(jsonStr) as any; // OpenAI原始块
                  // 转换为通用的 ChatCompletionChunk
                  const commonChunk: ChatCompletionChunk = {
                    id: openAIChatChunk.id,
                    model: openAIChatChunk.model,
                    choices: openAIChatChunk.choices?.map((choice: any) => ({
                      delta: {
                        content: choice.delta?.content ?? "",
                        role: choice.delta?.role,
                        // tool_calls: choice.delta?.tool_calls // 如果支持工具调用
                      },
                      finish_reason: choice.finish_reason,
                      index: choice.index,
                    })) || [{ delta: { content: ""}, index: 0 }], // 确保choices存在
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(commonChunk)}\n\n`));
                } catch (e) {
                  console.warn("OpenAICompatibleService: Failed to parse stream chunk JSON:", jsonStr, e);
                  // 如果解析失败，可以选择透传原始数据或忽略
                  controller.enqueue(chunk); // 透传原始未解析的块
                }
              } else if (line.trim()) {
                // 非 data: 开头的非空行，可能是错误或其他信息，或者只是原始数据的一部分
                 controller.enqueue(chunk); // 透传
              }
            }
          }
        });
        return response.body.pipeThrough(transformStream);

      } else {
        const responseData = await response.json();
        // 将OpenAI的完整响应转换为通用AIMessage格式
        const assistantMessage: AIMessage = {
          role: "assistant",
          content: responseData.choices?.[0]?.message?.content ?? "",
          // tool_calls: responseData.choices?.[0]?.message?.tool_calls // 如果支持工具调用
        };
        return assistantMessage;
      }
    } catch (error) {
      console.error("OpenAICompatibleService Error:", error);
      if (error instanceof Error) {
         throw error;
      }
      throw new Error("An unknown error occurred in OpenAICompatibleService.");
    }
  }
}

// 注册OpenAI兼容服务
registerAIService('openai', (config) => new OpenAICompatibleService(config));
registerAIService('gemini', (config) => new OpenAICompatibleService(config)); // Gemini API也常设计为OpenAI兼容
registerAIService('deepseek', (config) => new OpenAICompatibleService(config));
registerAIService('claude', (config) => new OpenAICompatibleService(config)); // 部分Claude API也可能通过兼容层提供
registerAIService('doubao', (config) => new OpenAICompatibleService(config)); // 豆包/火山方舟也可能提供OpenAI兼容接口
// 注意: 上述注册假设这些服务都提供了与OpenAI Chat Completions API兼容的接口。
// 如果某个服务（如Claude原生API）有显著差异，它应该有自己的专属适配器。
// "openai" 作为通用兼容类型的名称。
// 用户在前端选择具体provider时，如"deepseek"，后端仍可使用此类，只需传入正确的apiKey和baseUrl。
