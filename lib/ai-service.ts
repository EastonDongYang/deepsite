// lib/ai-service.ts

/**
 * 定义通用的消息结构，与OpenAI的格式兼容。
 */
export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
  // 未来可为多模态扩展，例如:
  // imageUrls?: string[];
  // tool_calls?: any[]; // 用于Function Calling/Tool Usage
  // tool_call_id?: string;
}

/**
 * 定义聊天补全的通用选项。
 */
export interface ChatCompletionOptions {
  model: string; // 模型名称/ID
  messages: AIMessage[];
  provider?: string; // AI提供商标识，例如 "openai", "huggingface", "gemini" 等
  apiKey?: string; // API密钥
  baseUrl?: string; // API的基础URL，用于兼容自建或代理服务
  stream?: boolean; // 是否启用流式响应
  max_tokens?: number; // 生成内容的最大token数
  temperature?: number; // 控制生成内容的随机性，0表示更确定性，1表示更随机
  // 可以根据需要添加更多OpenAI兼容的参数，例如 top_p, presence_penalty, frequency_penalty等
  // billTo?: string; // 特定于Hugging Face的参数，如果需要保留，可以在适配器层面处理
}

/**
 * 定义流式聊天补全的单个数据块结构。
 */
export interface ChatCompletionChunk {
  id?: string;
  model?: string;
  choices: Array<{
    delta: {
      content?: string | null;
      role?: "system" | "user" | "assistant";
      // tool_calls?: any[];
    };
    finish_reason?: string | null;
    index?: number;
  }>;
  // usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * 定义AI服务的通用接口。
 */
export interface AIService {
  /**
   * 获取聊天补全。
   * 如果 options.stream 为 true，则返回一个 ReadableStream。
   * 否则，返回一个包含完整响应的 Promise。
   * @param options - 聊天补全的选项。
   * @returns 根据是否流式返回 ReadableStream 或 Promise<string> (完整内容) 或 Promise<AIMessage> (完整消息对象)
   */
  getChatCompletion(
    options: ChatCompletionOptions
  ): Promise<ReadableStream<Uint8Array> | AIMessage>; // 流式返回 Uint8Array 以便 TextEncoder 处理

  // 未来可以扩展支持其他功能，例如：
  // getImageGeneration?(options: ImageGenerationOptions): Promise<ImageGenerationResponse>;
  // getEmbeddings?(options: EmbeddingsOptions): Promise<EmbeddingsResponse>;
}

/**
 * 定义用于创建特定AI服务适配器的工厂函数的签名。
 */
export type AIServiceFactory = (config?: any) => AIService;

/**
 * 用于管理不同AI服务提供商的注册表。
 * 这是一个简化的示例，实际应用中可能会更复杂。
 */
const aiServiceRegistry: Map<string, AIServiceFactory> = new Map();

export function registerAIService(name: string, factory: AIServiceFactory): void {
  if (aiServiceRegistry.has(name)) {
    console.warn(`AI Service "${name}" is already registered. Overwriting.`);
  }
  aiServiceRegistry.set(name, factory);
}

export function getAIService(name: string, config?: any): AIService | undefined {
  const factory = aiServiceRegistry.get(name);
  if (!factory) {
    console.error(`No AI Service registered for "${name}"`);
    return undefined;
  }
  try {
    return factory(config);
  } catch (error) {
    console.error(`Error creating AI Service "${name}":`, error);
    return undefined;
  }
}

// 初始时没有服务被注册，它们将在各自的适配器文件中被注册。
// 例如，在 openai-adapter.ts 中:
// import { registerAIService, AIService, ChatCompletionOptions, AIMessage } from './ai-service';
// class OpenAIService implements AIService { /* ... */ }
// registerAIService('openai', (config) => new OpenAIService(config));
