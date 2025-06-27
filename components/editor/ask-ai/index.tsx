"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useMemo } from "react";
import classNames from "classnames";
import { toast } from "sonner";
import { useLocalStorage, useUpdateEffect } from "react-use";
import { ArrowUp, ChevronDown, Crosshair } from "lucide-react"; // SettingsIcon is imported in Settings.tsx
import { FaStopCircle } from "react-icons/fa";

import ProModal from "@/components/pro-modal";
import { Button } from "@/components/ui/button";
import { MODELS as HF_MODELS } from "@/lib/providers"; // Keep for potential HF specific logic or default
import { HtmlHistory } from "@/types";
import { InviteFriends } from "@/components/invite-friends";
import { Settings } from "@/components/editor/ask-ai/settings";
import { LoginModal } from "@/components/login-modal";
import { ReImagine } from "@/components/editor/ask-ai/re-imagine";
import Loading from "@/components/loading";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { TooltipContent } from "@radix-ui/react-tooltip";
import { SelectedHtmlElement } from "./selected-html-element";
import { FollowUpTooltip } from "./follow-up-tooltip";
import { isTheSameHtml } from "@/lib/compare-html-diff";

// Default provider and model for the new generic system
const DEFAULT_GENERIC_PROVIDER = "openai"; // Or "huggingface" if preferred as default
const DEFAULT_MODEL_FOR_PROVIDER: Record<string, string> = {
  openai: "gpt-3.5-turbo",
  huggingface: HF_MODELS[0]?.value || "", // Fallback to first HF model
  gemini: "gemini-pro",
  deepseek: "deepseek-chat",
  claude: "claude-2.1", // Example, use a valid default
  doubao: "Doubao-pro-32k", // Example
};


export function AskAI({
  html,
  setHtml,
  onScrollToBottom,
  isAiWorking,
  setisAiWorking,
  isEditableModeEnabled = false,
  selectedElement,
  setSelectedElement,
  setIsEditableModeEnabled,
  onNewPrompt,
  onSuccess,
}: {
  html: string;
  setHtml: (html: string) => void;
  onScrollToBottom: () => void;
  isAiWorking: boolean;
  onNewPrompt: (prompt: string) => void;
  htmlHistory?: HtmlHistory[];
  setisAiWorking: React.Dispatch<React.SetStateAction<boolean>>;
  onSuccess: (h: string, p: string, n?: number[][]) => void;
  isEditableModeEnabled: boolean;
  setIsEditableModeEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  selectedElement?: HTMLElement | null;
  setSelectedElement: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
}) {
  const refThink = useRef<HTMLDivElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const [loginModalOpen, setLoginModalOpen] = useState(false); // Renamed 'open' for clarity
  const [prompt, setPrompt] = useState("");
  const [hasAsked, setHasAsked] = useState(false);
  const [previousPrompt, setPreviousPrompt] = useState("");

  // AI Provider Settings States
  const [provider, setProvider] = useLocalStorage<string>("ai_provider", DEFAULT_GENERIC_PROVIDER);
  const [model, setModel] = useLocalStorage<string>("ai_model", DEFAULT_MODEL_FOR_PROVIDER[provider] || HF_MODELS[0]?.value || "");
  const [apiKey, setApiKey] = useLocalStorage<string>("ai_apiKey", "");
  const [baseUrl, setBaseUrl] = useLocalStorage<string>("ai_baseUrl", "");

  // const [openProviderPopover, setOpenProviderPopover] = useState(false); // Managed by Settings component internally
  const [providerError, setProviderError] = useState(""); // For general errors shown in settings
  const [openProModal, setOpenProModal] = useState(false);
  const [think, setThink] = useState<string | undefined>(undefined);
  const [openThink, setOpenThink] = useState(false);
  const [isThinking, setIsThinking] = useState(true); // True initially when AI is called
  const [controller, setController] = useState<AbortController | null>(null);
  const [isFollowUp, setIsFollowUp] = useState(true);

  // Update default model when provider changes
  useUpdateEffect(() => {
    setModel(DEFAULT_MODEL_FOR_PROVIDER[provider] || (provider === "huggingface" ? HF_MODELS[0]?.value : "") || "");
  }, [provider]);


  const callAi = async (redesignMarkdown?: string) => {
    if (isAiWorking) return;
    if (!redesignMarkdown && !prompt.trim()) return;
    setisAiWorking(true);
    setProviderError(""); // Clear previous errors
    setThink("");
    setOpenThink(false);
    setIsThinking(true);

    let contentResponse = "";
    // let thinkResponse = ""; // 'think' state is used directly
    let lastRenderTime = 0;

    const abortController = new AbortController();
    setController(abortController);

    const requestBodyBase = {
      prompt,
      provider,
      model,
      apiKey: provider === "huggingface" ? "" : apiKey, // HF might use env token, don't send user key
      baseUrl: provider === "huggingface" ? "" : baseUrl, // HF base URL is fixed by client
      // TODO: Add max_tokens, temperature from user settings if available
    };

    try {
      onNewPrompt(prompt); // Record the new prompt
      let request;

      if (isFollowUp && !redesignMarkdown && !isSameHtml) {
        const selectedElementHtml = selectedElement ? selectedElement.outerHTML : "";
        request = await fetch("/api/ask-ai", {
          method: "PUT",
          body: JSON.stringify({
            ...requestBodyBase,
            previousPrompt,
            html,
            selectedElementHtml,
          }),
          headers: { "Content-Type": "application/json" },
          signal: abortController.signal,
        });

        if (request && request.body) {
          const res = await request.json();
          if (!request.ok) {
            if (res.openLogin) setLoginModalOpen(true);
            else if (res.openSettings || res.error?.includes("API key") || res.error?.includes("provider")) {
              // setOpenProviderPopover(true); // Popover is internal to Settings
              setProviderError(res.error || "Configuration error. Please check your settings.");
              toast.error(res.error || "Configuration error.");
            } else if (res.openProModal) setOpenProModal(true);
            else toast.error(res.error || "An unknown error occurred.");
            setisAiWorking(false);
            return;
          }
          setHtml(res.html);
          toast.success("AI responded successfully");
          setPreviousPrompt(prompt);
          setPrompt("");
          onSuccess(res.html, prompt, res.updatedLines);
          if (audio.current) audio.current.play();
        }
      } else { // POST request (initial generation or not a follow-up)
        request = await fetch("/api/ask-ai", {
          method: "POST",
          body: JSON.stringify({
            ...requestBodyBase,
            html: isSameHtml ? "" : html, // Provide current HTML as context if not default
            redesignMarkdown,
          }),
          headers: { "Content-Type": "application/json" },
          signal: abortController.signal,
        });

        if (request && request.body) {
          const reader = request.body.getReader();
          const decoder = new TextDecoder("utf-8");
          // const currentSelectedModelConfig = (provider === "huggingface" ? HF_MODELS.find(m => m.value === model) : null);

          const readStream = async () => {
            const { done, value } = await reader.read();
            if (done) {
              // Check if contentResponse is a JSON error from the stream
              try {
                const potentialJsonError = JSON.parse(contentResponse);
                if (potentialJsonError && !potentialJsonError.ok) {
                   if (potentialJsonError.openLogin) setLoginModalOpen(true);
                   else if (potentialJsonError.openSettings) {
                        // setOpenProviderPopover(true);
                        setProviderError(potentialJsonError.message);
                        toast.error(potentialJsonError.message);
                   } else if (potentialJsonError.openProModal) setOpenProModal(true);
                   else toast.error(potentialJsonError.message || "Stream error.");
                   setisAiWorking(false);
                   return;
                }
              } catch(e) { /* Not a JSON error, proceed */ }

              toast.success("AI stream finished");
              setPreviousPrompt(prompt);
              setPrompt("");
              setHasAsked(true);
              // setModel(DEFAULT_MODEL_FOR_PROVIDER[provider] || (provider === "huggingface" ? HF_MODELS[0]?.value : "") || ""); // Reset model or keep?
              if (audio.current) audio.current.play();

              // Ensure final HTML is set from accumulated stream
              const finalHtmlFromStream = contentResponse.match(/<!DOCTYPE html>[\s\S]*<\/html>/is)?.[0];
              if (finalHtmlFromStream) {
                setHtml(finalHtmlFromStream);
                 onSuccess(finalHtmlFromStream, prompt);
              } else {
                // If no full HTML doc, use the raw content (might be partial or just text)
                // This path should ideally not happen if AI behaves per INITIAL_SYSTEM_PROMPT
                onSuccess(contentResponse, prompt);
              }
              setisAiWorking(false);
              return;
            }

            const chunkText = decoder.decode(value, { stream: true });
            // Assuming stream sends data: JSON\n\n chunks
            const lines = chunkText.split("\n\n");
            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const jsonStr = line.substring("data: ".length).trim();
                    if (jsonStr === "[DONE]") { // Handle OpenAI's [DONE] marker if present
                        // This might be handled by the main 'done' above already
                        continue;
                    }
                    try {
                        const parsedChunk = JSON.parse(jsonStr);
                        const deltaContent = parsedChunk.choices?.[0]?.delta?.content;

                        if (deltaContent) {
                            contentResponse += deltaContent;
                            // Logic for handling <think> tags if the chosen model/provider supports it
                            // This is more complex with generic providers, as <think> was HF specific.
                            // For now, we'll assume non-HF providers don't use <think> in this way.
                            // If a generic "thinking" protocol is established, it can be handled here.
                            // if (provider === "huggingface" && currentSelectedModelConfig?.isThinker) { ... }
                        }
                    } catch (e) {
                        console.warn("Failed to parse stream JSON chunk:", jsonStr, e);
                        // Append raw chunk if not parsable as our expected JSON. Could be an error message.
                        contentResponse += chunkText;
                    }
                } else if (line.trim()) {
                     contentResponse += line; // Append non-SSE data as is (e.g. plain error text)
                }
            }

            // Update HTML preview (throttled)
            const now = Date.now();
            if (now - lastRenderTime > 300) { // Throttle DOM updates
                const currentHtmlOutput = contentResponse.match(/<!DOCTYPE html>[\s\S]*/is)?.[0];
                if (currentHtmlOutput) {
                    setIsThinking(false); // Assume coding once HTML starts appearing
                    // Basic completion for preview rendering
                    let previewDoc = currentHtmlOutput;
                    if (previewDoc.includes("<head>") && !previewDoc.includes("</head>")) previewDoc += "\n</head>";
                    if (previewDoc.includes("<body") && !previewDoc.includes("</body>")) previewDoc += "\n</body>";
                    if (!previewDoc.includes("</html>")) previewDoc += "\n</html>";
                    setHtml(previewDoc);
                }
                lastRenderTime = now;
            }
            if (contentResponse.length > 200 && !isThinking) { // Scroll if content is substantial and not just "thinking"
              onScrollToBottom();
            }
            readStream(); // Continue reading
          };
          readStream();
        }
      }
    } catch (error: any) {
      setisAiWorking(false);
      toast.error(error.message || "An unexpected error occurred.");
      if (error.openLogin) setLoginModalOpen(true);
      // Handle other specific errors if necessary
    } finally {
      if (!isAiWorking && controller?.signal.aborted) { // Ensure AI working is false if aborted
         setisAiWorking(false);
      }
    }
  };

  const stopController = () => {
    if (controller) {
      controller.abort();
      setController(null); // Clear the controller
      setisAiWorking(false);
      setThink("");
      setOpenThink(false);
      setIsThinking(false); // Explicitly set thinking to false
      toast.info("AI generation stopped.");
    }
  };

  useUpdateEffect(() => {
    if (refThink.current) {
      refThink.current.scrollTop = refThink.current.scrollHeight;
    }
  }, [think]);

  useUpdateEffect(() => {
    if (!isThinking) {
      setOpenThink(false);
    }
  }, [isThinking]);

  const isSameHtml = useMemo(() => {
    return isTheSameHtml(html);
  }, [html]);

  return (
    <div className="px-3">
      <div className="relative bg-neutral-800 border border-neutral-700 rounded-2xl ring-[4px] focus-within:ring-neutral-500/30 focus-within:border-neutral-600 ring-transparent z-10 w-full group">
        {think && ( // 'think' state might be less relevant or handled differently with generic providers
          <div className="w-full border-b border-neutral-700 relative overflow-hidden">
            <header
              className="flex items-center justify-between px-5 py-2.5 group hover:bg-neutral-600/20 transition-colors duration-200 cursor-pointer"
              onClick={() => setOpenThink(!openThink)}
            >
              <p className="text-sm font-medium text-neutral-300 group-hover:text-neutral-200 transition-colors duration-200">
                {isThinking ? "AI is thinking..." : "AI's plan/notes"}
              </p>
              <ChevronDown
                className={classNames(
                  "size-4 text-neutral-400 group-hover:text-neutral-300 transition-all duration-200",
                  { "rotate-180": openThink }
                )}
              />
            </header>
            <main
              ref={refThink}
              className={classNames(
                "overflow-y-auto transition-all duration-200 ease-in-out",
                {
                  "max-h-[0px]": !openThink,
                  "min-h-[250px] max-h-[250px] border-t border-neutral-700": openThink,
                }
              )}
            >
              <p className="text-[13px] text-neutral-400 whitespace-pre-line px-5 pb-4 pt-3">
                {think}
              </p>
            </main>
          </div>
        )}
        {selectedElement && (
          <div className="px-4 pt-3">
            <SelectedHtmlElement
              element={selectedElement}
              isAiWorking={isAiWorking}
              onDelete={() => setSelectedElement(null)}
            />
          </div>
        )}
        <div className="w-full relative flex items-center justify-between">
          {isAiWorking && (
            <div className="absolute bg-neutral-800 rounded-lg bottom-0 left-4 w-[calc(100%-30px)] h-full z-1 flex items-center justify-between max-lg:text-sm">
              <div className="flex items-center justify-start gap-2">
                <Loading overlay={false} className="!size-4" />
                <p className="text-neutral-400 text-sm">
                  AI is {isThinking ? "thinking" : "coding"}...{" "}
                </p>
              </div>
              <div
                className="text-xs text-neutral-400 px-1 py-0.5 rounded-md border border-neutral-600 flex items-center justify-center gap-1.5 bg-neutral-800 hover:brightness-110 transition-all duration-200 cursor-pointer"
                onClick={stopController}
              >
                <FaStopCircle />
                Stop generation
              </div>
            </div>
          )}
          <input
            type="text"
            disabled={isAiWorking}
            className={classNames(
              "w-full bg-transparent text-sm outline-none text-white placeholder:text-neutral-400 p-4",
              { "!pt-2.5": selectedElement && !isAiWorking }
            )}
            placeholder={
              selectedElement
                ? `Ask AI about ${selectedElement.tagName.toLowerCase()}...`
                : hasAsked
                ? "Ask AI for edits"
                : "Ask AI anything..."
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                callAi();
              }
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-4 pb-3">
          <div className="flex-1 flex items-center justify-start gap-1.5">
            <ReImagine onRedesign={(md) => callAi(md)} />
            {!isSameHtml && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="xs"
                    variant={isEditableModeEnabled ? "default" : "outline"}
                    onClick={() => setIsEditableModeEnabled?.(!isEditableModeEnabled)}
                    className={classNames("h-[28px]", {
                      "!text-neutral-400 hover:!text-neutral-200 !border-neutral-600 !hover:!border-neutral-500": !isEditableModeEnabled,
                    })}
                  >
                    <Crosshair className="size-4" />
                    Edit
                  </Button>
                </TooltipTrigger>
                <TooltipContent align="start" className="bg-neutral-950 text-xs text-neutral-200 py-1 px-2 rounded-md -translate-y-0.5">
                  Select an element on the page to ask AI to edit it directly.
                </TooltipContent>
              </Tooltip>
            )}
            <InviteFriends />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Settings
              provider={provider}
              model={model}
              apiKey={apiKey}
              baseUrl={baseUrl}
              onProviderChange={setProvider}
              onModelChange={setModel}
              onApiKeyChange={setApiKey}
              onBaseUrlChange={setBaseUrl}
              error={providerError}
              isFollowUp={!isSameHtml && isFollowUp}
            />
            <Button
              size="iconXs"
              disabled={isAiWorking || !prompt.trim()}
              onClick={() => callAi()}
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>
        <LoginModal open={loginModalOpen} onClose={() => setLoginModalOpen(false)} html={html} />
        <ProModal html={html} open={openProModal} onClose={() => setOpenProModal(false)} />
        {!isSameHtml && (
          <div className="absolute top-0 right-0 -translate-y-[calc(100%+8px)] select-none text-xs text-neutral-400 flex items-center justify-center gap-2 bg-neutral-800 border border-neutral-700 rounded-md p-1 pr-2.5">
            <label htmlFor="diff-patch-checkbox" className="flex items-center gap-1.5 cursor-pointer">
              <Checkbox
                id="diff-patch-checkbox"
                checked={isFollowUp}
                onCheckedChange={(e) => {
                  // If switching to diff-patch and current provider is HF, ensure a non-thinker model is selected if possible
                  if (e === true && !isSameHtml && provider === "huggingface") {
                     const currentHfModel = HF_MODELS.find(m => m.value === model);
                     if (currentHfModel?.isThinker) {
                        const nonThinkerHfModel = HF_MODELS.find(m => !m.isThinker && m.providers.includes(currentHfModel.autoProvider || "novita"));
                        if (nonThinkerHfModel) setModel(nonThinkerHfModel.value);
                        else setModel(HF_MODELS[0].value); // fallback
                     }
                  } else if (e === true && !isSameHtml) {
                    // For other providers, just ensure a model is set (usually default for provider)
                    setModel(DEFAULT_MODEL_FOR_PROVIDER[provider] || "");
                  }
                  setIsFollowUp(e === true);
                }}
              />
              Diff-Patch Update
            </label>
            <FollowUpTooltip />
          </div>
        )}
      </div>
      <audio ref={audio} id="audio" className="hidden">
        <source src="/success.mp3" type="audio/mpeg" />
        Your browser does not support the audio element.
      </audio>
    </div>
  );
}
