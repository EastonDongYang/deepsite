// lib/adapters/huggingface-adapter.ts

import { InferenceClient, type ChatCompletionStreamParams, type ChatCompletionParams } from "@huggingface/inference";
import type { AIService, ChatCompletionOptions, AIMessage, ChatCompletionChunk } from "../ai-service";
import { registerAIService } from "../ai-service";
import { MODELS, PROVIDERS } from "../providers"; // 假设这些仍然用于获取默认或特定HF模型的配置

const DEFAULT_HF_PROVIDER = "novita"; // 或者从配置中读取

class HuggingFaceService implements AIService {
  private client: InferenceClient;
  private hfToken?: string;

  constructor(config?: { apiKey?: string }) {
    this.hfToken = config?.apiKey || process.env.HF_TOKEN || process.env.DEFAULT_HF_TOKEN;
    if (!this.hfToken) {
      // 在严格模式下，如果没有token，可能应该抛出错误
      // 但为了保持与原逻辑类似的灵活性（例如允许后端IP限流下的匿名使用），这里仅警告
      console.warn("HuggingFaceService: API key (HF_TOKEN or DEFAULT_HF_TOKEN) is not configured.");
      // 即使没有token，InferenceClient也可能允许某些操作或有其内部处理方式
    }
    this.client = new InferenceClient(this.hfToken);
  }

  async getChatCompletion(
    options: ChatCompletionOptions
  ): Promise<ReadableStream<Uint8Array> | AIMessage> {
    const { model, messages, stream, max_tokens, temperature } = options;

    // 从原始的 MODELS 和 PROVIDERS 查找模型和provider的特定配置
    // 这部分逻辑可能需要根据通用化程度进行调整
    const selectedModelConfig = MODELS.find(m => m.value === model || m.label === model);
    if (!selectedModelConfig) {
      throw new Error(`HuggingFaceService: Model configuration not found for ${model}`);
    }

    // Provider选择逻辑: 如果options.provider是HF特定的，则使用它，否则用模型的autoProvider或默认
    let hfProviderId = DEFAULT_HF_PROVIDER;
    if (options.provider && PROVIDERS[options.provider as keyof typeof PROVIDERS]) {
        hfProviderId = PROVIDERS[options.provider as keyof typeof PROVIDERS].id;
    } else if (selectedModelConfig.providers.includes(selectedModelConfig.autoProvider)) {
        hfProviderId = PROVIDERS[selectedModelConfig.autoProvider as keyof typeof PROVIDERS].id;
    } else if (selectedModelConfig.providers.length > 0 && PROVIDERS[selectedModelConfig.providers[0] as keyof typeof PROVIDERS]) {
        // Fallback to the first provider listed for the model if autoProvider is not suitable
        hfProviderId = PROVIDERS[selectedModelConfig.providers[0] as keyof typeof PROVIDERS].id;
    }

    const selectedProviderConfig = PROVIDERS[hfProviderId as keyof typeof PROVIDERS];
    if (!selectedProviderConfig) {
        throw new Error(`HuggingFaceService: Provider configuration not found for provider ID ${hfProviderId}`);
    }


    // 将通用的AIMessage转换为HuggingFace需要的格式 (通常是兼容的)
    const hfMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const params: Partial<ChatCompletionStreamParams | ChatCompletionParams> = {
      model: selectedModelConfig.value, // 使用value作为HF模型ID
      messages: hfMessages,
      max_tokens: max_tokens ?? selectedProviderConfig.max_tokens,
      // temperature 参数在HuggingFace的InferenceClient中不直接作为顶级参数
      // 可能需要通过 `parameters` 嵌套对象传递，或者某些模型/provider不支持
      // HF client的 chatCompletion/chatCompletionStream 的 `temperature` 通常在 `parameters` 内，但这里顶级API似乎没有直接暴露
      // 为了简化，暂时忽略 temperature，或者需要更复杂的参数映射
    };

    // HuggingFace InferenceClient的 `provider` 参数是特定于其平台的，
    // 不是所有模型都需要或支持它，或者它的含义可能与通用接口中的 provider 不同。
    // 此处我们使用已解析的 hfProviderId 作为HF specific provider.
    // @ts-ignore // HF client的类型定义可能不包含 provider，但实际API可能接受
    params.provider = hfProviderId;


    // 特定于Hugging Face的 billTo 参数处理
    let billTo: string | null = null;
    if (!options.apiKey && !this.hfToken && process.env.DEFAULT_HF_TOKEN) {
        // 模拟原逻辑：如果没有用户提供的key，且使用的是默认的全局key，则可能需要billTo
        // 这部分逻辑比较脆弱，高度依赖环境变量的设置方式
         if (this.hfToken === process.env.DEFAULT_HF_TOKEN) {
            billTo = "huggingface"; // 与原代码一致的硬编码
         }
    }
    const hfClientOptions = billTo ? { billTo } : {};


    if (stream) {
      const streamIterator = this.client.chatCompletionStream(
        params as ChatCompletionStreamParams, // 断言为流参数类型
        hfClientOptions
      );
      const encoder = new TextEncoder();
      const readableStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for await (const chunk of streamIterator) {
            // 将HuggingFace的流块转换为通用ChatCompletionChunk格式的JSON字符串
            // 然后编码为Uint8Array
            const hfChunk = chunk as any; // HF的原始块类型
            const commonChunk: ChatCompletionChunk = {
              choices: [{
                delta: { content: hfChunk.choices?.[0]?.delta?.content ?? "" },
                index: 0, // HF 流似乎不提供多choice的index或finish_reason
                finish_reason: hfChunk.choices?.[0]?.finish_reason ?? null,
              }],
              // HF 流块中可能不包含 id 或 model 字段，按需填充
              id: hfChunk.id,
              model: hfChunk.model,
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(commonChunk)}\n\n`));
          }
          controller.close();
        },
      });
      return readableStream;
    } else {
      const response = await this.client.chatCompletion(
        params as ChatCompletionParams, // 断言为非流参数类型
        hfClientOptions
      );
      // 将HuggingFace的完整响应转换为通用AIMessage格式
      const assistantMessage: AIMessage = {
        role: "assistant",
        content: response.choices[0]?.message?.content ?? "",
      };
      return assistantMessage;
    }
  }
}

// 注册HuggingFace服务
registerAIService('huggingface', (config) => new HuggingFaceService(config));
