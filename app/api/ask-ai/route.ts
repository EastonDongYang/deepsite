/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
// import { InferenceClient } from "@huggingface/inference"; // No longer directly used here

// import { MODELS, PROVIDERS } from "@/lib/providers"; // May still be used for HF specific fallbacks or UI population
import { getAIService, type AIMessage, type ChatCompletionOptions } from "@/lib/ai-service";
import {
  DIVIDER,
  FOLLOW_UP_SYSTEM_PROMPT,
  INITIAL_SYSTEM_PROMPT,
  // CHINESE_INITIAL_SYSTEM_PROMPT, // Example for Chinese prompts
  // CHINESE_FOLLOW_UP_SYSTEM_PROMPT, // Example for Chinese prompts
  MAX_REQUESTS_PER_IP,
  REPLACE_END,
  SEARCH_START,
} from "@/lib/prompts";
import MY_TOKEN_KEY from "@/lib/get-cookie-name";

const ipRateLimit = new Map();

// Helper function to get system prompts based on language (future enhancement)
// For now, we can assume a lang parameter or default to English
function getSystemPrompt(type: "initial" | "follow-up", lang: string = "en"): string {
  if (lang === "zh") {
    // return type === "initial" ? CHINESE_INITIAL_SYSTEM_PROMPT : CHINESE_FOLLOW_UP_SYSTEM_PROMPT;
    // For now, returning English version until Chinese prompts are added
    return type === "initial" ? INITIAL_SYSTEM_PROMPT : FOLLOW_UP_SYSTEM_PROMPT;
  }
  return type === "initial" ? INITIAL_SYSTEM_PROMPT : FOLLOW_UP_SYSTEM_PROMPT;
}


export async function POST(request: NextRequest) {
  const authHeaders = headers();
  const userSessionToken = request.cookies.get(MY_TOKEN_KEY())?.value;

  const body = await request.json();
  const {
    prompt,
    // provider is now the generic service name e.g., "openai", "huggingface"
    // model is the specific model ID e.g., "gpt-3.5-turbo" or "deepseek-ai/DeepSeek-V3-0324"
    provider,
    model,
    redesignMarkdown,
    html,
    apiKey, // User-provided API key
    baseUrl, // User-provided Base URL for the AI service
    max_tokens,
    temperature,
    // lang, // Optional: language for prompts, defaults to "en"
  } = body;

  // Validate required fields
  if (!provider || !model || (!prompt && !redesignMarkdown)) {
    return NextResponse.json(
      { ok: false, error: "Missing required fields: provider, model, and prompt or redesignMarkdown" },
      { status: 400 }
    );
  }

  // Rate limiting for anonymous users (simplified)
  const ip = authHeaders.get("x-forwarded-for")?.split(",")[0].trim() || request.ip || "unknown-ip";
  if (!userSessionToken) { // Only apply rate limit if no user token
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour
    const maxRequests = MAX_REQUESTS_PER_IP;

    if (!ipRateLimit.has(ip)) {
      ipRateLimit.set(ip, []);
    }

    const timestamps = ipRateLimit.get(ip);
    timestamps.push(now);
    // Remove timestamps older than the window
    while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
      timestamps.shift();
    }

    if (timestamps.length > maxRequests) {
      return NextResponse.json(
        {
          ok: false,
          openLogin: true, // Signal to frontend to open login modal
          message: "Too many requests. Please log in to continue or try again later.",
        },
        { status: 429 }
      );
    }
  }

  // Determine which AI service to use
  // The 'provider' field from the request body now indicates the AI service (e.g., "openai", "huggingface")
  const aiService = getAIService(provider, { apiKey, baseUrl });

  if (!aiService) {
    return NextResponse.json(
      { ok: false, error: `AI service provider "${provider}" is not supported or configured.` },
      { status: 400 }
    );
  }

  // Construct messages for the AI
  const systemPromptContent = getSystemPrompt("initial", body.lang);
  const userMessageContent = redesignMarkdown
    ? `Here is my current design as a markdown:\n\n${redesignMarkdown}\n\nNow, please create a new design based on this markdown.`
    : html
    ? `Here is my current HTML code:\n\n\`\`\`html\n${html}\n\`\`\`\n\nNow, please create a new design based on this HTML.`
    : prompt;

  const messages: AIMessage[] = [
    { role: "system", content: systemPromptContent },
    { role: "user", content: userMessageContent },
  ];

  const chatOptions: ChatCompletionOptions = {
    model,
    messages,
    stream: true, // Always stream for POST requests for initial generation
    provider, // Pass provider for context, though adapter might not directly use it if baseUrl is set
    apiKey,   // Pass apiKey for the adapter
    baseUrl,  // Pass baseUrl for the adapter
    max_tokens,
    temperature,
  };

  try {
    const aiResponseStream = await aiService.getChatCompletion(chatOptions);

    if (!(aiResponseStream instanceof ReadableStream)) {
      // Should be a stream as we set stream: true
      console.error("AI service did not return a ReadableStream as expected for a streaming POST request.");
      return NextResponse.json({ ok: false, error: "AI service failed to provide a stream." }, { status: 500 });
    }

    // Return the stream directly to the client
    return new NextResponse(aiResponseStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8", // SSE content type
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });

  } catch (error: any) {
    console.error(`Error calling AI service provider "${provider}" for model "${model}":`, error);
    // Check for specific error messages that might trigger frontend actions
    if (error.message?.includes("exceeded your monthly included credits") || error.message?.includes("insufficient_quota")) {
      return NextResponse.json({ ok: false, openProModal: true, message: error.message }, { status: 402 });
    }
    if (error.message?.includes("authentication_error") || error.message?.includes("API key")) {
         return NextResponse.json({ ok: false, error: `Authentication error with AI provider: ${error.message}`, openSettings: true }, { status: 401 });
    }
    return NextResponse.json(
      {
        ok: false,
        // openSelectProvider: true, // This might need to change to a more generic error or settings modal
        error: `Failed to process AI request: ${error.message || "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const authHeaders = headers();
  const userSessionToken = request.cookies.get(MY_TOKEN_KEY())?.value;

  const body = await request.json();
  const {
    prompt,
    html,
    previousPrompt,
    // provider and model are now generic
    provider,
    model,
    selectedElementHtml,
    apiKey,
    baseUrl,
    max_tokens,
    temperature,
    // lang, // Optional: language for prompts
  } = body;

  if (!provider || !model || !prompt || !html) {
    return NextResponse.json(
      { ok: false, error: "Missing required fields: provider, model, prompt, and html" },
      { status: 400 }
    );
  }

  // Rate limiting (simplified, similar to POST)
  const ip = authHeaders.get("x-forwarded-for")?.split(",")[0].trim() || request.ip || "unknown-ip";
  if (!userSessionToken) { // Only apply rate limit if no user token
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour
    const maxRequests = MAX_REQUESTS_PER_IP; // Assuming a shared limit for POST/PUT for simplicity

    if (!ipRateLimit.has(ip)) {
      ipRateLimit.set(ip, []);
    }
    const timestamps = ipRateLimit.get(ip);
    timestamps.push(now);
    while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
      timestamps.shift();
    }
    if (timestamps.length > maxRequests) {
      return NextResponse.json(
        { ok: false, openLogin: true, message: "Too many requests. Please log in or try again later." },
        { status: 429 }
      );
    }
  }

  const aiService = getAIService(provider, { apiKey, baseUrl });
  if (!aiService) {
    return NextResponse.json(
      { ok: false, error: `AI service provider "${provider}" is not supported or configured.` },
      { status: 400 }
    );
  }

  const systemPromptContent = getSystemPrompt("follow-up", body.lang);
  const messages: AIMessage[] = [
    { role: "system", content: systemPromptContent },
    {
      role: "user",
      content: previousPrompt || "You are modifying the HTML file based on the user's request.",
    },
    {
      role: "assistant",
      content: `The current code is: \n\`\`\`html\n${html}\n\`\`\` ${
        selectedElementHtml
          ? `\n\nYou have to update ONLY the following element, NOTHING ELSE: \n\n\`\`\`html\n${selectedElementHtml}\n\`\`\``
          : ""
      }`,
    },
    { role: "user", content: prompt },
  ];

  const chatOptions: ChatCompletionOptions = {
    model,
    messages,
    stream: false, // PUT requests for modifications are typically not streamed for SEARCH/REPLACE
    provider,
    apiKey,
    baseUrl,
    max_tokens,
    temperature,
  };

  try {
    const aiResponse = await aiService.getChatCompletion(chatOptions);

    if (aiResponse instanceof ReadableStream) {
      // Should not be a stream as we set stream: false
      console.error("AI service returned a ReadableStream unexpectedly for a non-streaming PUT request.");
      // Attempt to read the stream to get content if possible, or fail.
      const reader = aiResponse.getReader();
      const decoder = new TextDecoder();
      let content = "";
      while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        content += decoder.decode(value);
      }
      // This crude stream reading might not correctly parse SSE for AIMessage
      // For now, let's assume this path indicates an error or misconfiguration.
      return NextResponse.json({ ok: false, error: "AI service stream error in non-stream request." }, { status: 500 });
    }

    const assistantMessage = aiResponse as AIMessage; // Cast because stream is false
    const chunk = assistantMessage.content;

    if (!chunk) {
      return NextResponse.json(
        { ok: false, message: "No content returned from the model" },
        { status: 400 } // Or 204 No Content if appropriate
      );
    }

    // Parse SEARCH/REPLACE blocks (this logic remains the same)
    const updatedLines: number[][] = [];
    let newHtml = html; // Start with the original HTML
    let currentPosition = 0;
    let moreBlocks = true;

    while (moreBlocks) {
      const searchStartIndex = chunk.indexOf(SEARCH_START, currentPosition);
      if (searchStartIndex === -1) {
        moreBlocks = false;
        continue;
      }

      const dividerIndex = chunk.indexOf(DIVIDER, searchStartIndex + SEARCH_START.length);
      if (dividerIndex === -1) {
        moreBlocks = false;
        continue;
      }

      const replaceEndIndex = chunk.indexOf(REPLACE_END, dividerIndex + DIVIDER.length);
      if (replaceEndIndex === -1) {
        moreBlocks = false;
        continue;
      }

      const searchBlock = chunk.substring(
        searchStartIndex + SEARCH_START.length,
        dividerIndex
      ).trim(); // Trim to handle potential leading/trailing newlines in AI output

      const replaceBlock = chunk.substring(
        dividerIndex + DIVIDER.length,
        replaceEndIndex
      ).trimEnd(); // Trim end for replace block, start might be intentional whitespace

      if (searchBlock.trim() === "") { // AI wants to insert at the beginning
        newHtml = `${replaceBlock}\n${newHtml}`; // Prepend
        updatedLines.push([1, replaceBlock.split("\n").length]);
      } else {
        // Need to handle newlines in searchBlock carefully for accurate replacement
        // Original logic might be too simple if searchBlock has many newlines.
        // For now, keeping original replacement logic.
        const blockPosition = newHtml.indexOf(searchBlock);
        if (blockPosition !== -1) {
          const beforeText = newHtml.substring(0, blockPosition);
          const startLineNumber = beforeText.split("\n").length;
          const replaceLinesCount = replaceBlock.split("\n").length;

          newHtml = newHtml.substring(0, blockPosition) + replaceBlock + newHtml.substring(blockPosition + searchBlock.length);
          updatedLines.push([startLineNumber, startLineNumber + replaceLinesCount -1]);
        } else {
            console.warn(`AI Follow-up: SEARCH block not found in HTML. Block:\n${searchBlock}`);
            // Optionally, could append the replaceBlock if search fails, or ignore.
            // For now, if a block isn't found, it's skipped.
        }
      }
      currentPosition = replaceEndIndex + REPLACE_END.length;
    }

    return NextResponse.json({
      ok: true,
      html: newHtml,
      updatedLines,
    });

  } catch (error: any) {
    console.error(`Error calling AI service provider "${provider}" for model "${model}" (PUT):`, error);
    if (error.message?.includes("exceeded your monthly included credits") || error.message?.includes("insufficient_quota")) {
      return NextResponse.json({ ok: false, openProModal: true, message: error.message }, { status: 402 });
    }
    if (error.message?.includes("authentication_error") || error.message?.includes("API key")) {
         return NextResponse.json({ ok: false, error: `Authentication error with AI provider: ${error.message}`, openSettings: true }, { status: 401 });
    }
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to process AI modification request: ${error.message || "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
