import { useState, useMemo } from "react";
import classNames from "classnames";
// import { PiGearSixFill } from "react-icons/pi"; // Replaced with Lucide icon
// import { RiCheckboxCircleFill } from "react-icons/ri"; // Not used in new design
import { Settings as SettingsIcon, Info } from "lucide-react"; // Lucide icon for settings

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MODELS as HF_MODELS } from "@/lib/providers"; // Original HuggingFace models for HF provider
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup, // Keep SelectGroup if needed for structure
  SelectItem,
  SelectLabel, // Keep SelectLabel if needed
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
// import { useUpdateEffect } from "react-use"; // Not strictly needed for this new setup
// import Image from "next/image"; // Not used for generic provider logos for now

// List of generic providers
const GENERIC_PROVIDERS = [
  { id: "openai", name: "OpenAI Compatible" },
  { id: "huggingface", name: "HuggingFace Inference" },
  { id: "gemini", name: "Google Gemini" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "claude", name: "Anthropic Claude" },
  { id: "doubao", name: "Doubao (火山方舟)" },
];

// Example model suggestions - this should be more dynamic or configurable in a real app
const EXAMPLE_MODELS_BY_PROVIDER: Record<string, { value: string; label: string; isNew?: boolean; isThinker?: boolean }[]> = {
  openai: [
    { value: "gpt-4-turbo-preview", label: "GPT-4 Turbo Preview" },
    { value: "gpt-4", label: "GPT-4" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  huggingface: HF_MODELS.map(m => ({ ...m })), // Use existing HF_MODELS
  gemini: [
    { value: "gemini-1.5-pro-latest", label: "Gemini 1.5 Pro" },
    { value: "gemini-pro", label: "Gemini Pro" }
  ],
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek Chat" },
    { value: "deepseek-coder", label: "DeepSeek Coder" },
  ],
  claude: [
    { value: "claude-3-opus-20240229", label: "Claude 3 Opus" },
    { value: "claude-3-sonnet-20240229", label: "Claude 3 Sonnet" },
    { value: "claude-2.1", label: "Claude 2.1" },
  ],
  doubao: [
    { value: "Doubao-pro-32k", label: "Doubao Pro 32k" },
    { value: "Doubao-pro-128k", label: "Doubao Pro 128k" },
  ],
};


export function Settings({
  // open and onClose are managed internally by Popover now
  provider,
  model,
  apiKey,
  baseUrl,
  error,
  isFollowUp = false,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onBaseUrlChange,
}: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  error?: string;
  isFollowUp?: boolean;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onBaseUrlChange: (baseUrl: string) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  const currentProviderModels = useMemo(() => {
    return EXAMPLE_MODELS_BY_PROVIDER[provider] || [];
  }, [provider]);

  const handleProviderSelect = (selectedProviderId: string) => {
    onProviderChange(selectedProviderId);
    const newModels = EXAMPLE_MODELS_BY_PROVIDER[selectedProviderId] || [];
    if (newModels.length > 0) {
      // If the current model is not in the new provider's list, select the first one
      if (!newModels.some(m => m.value === model)) {
        onModelChange(newModels[0].value);
      }
    } else {
      onModelChange(""); // Clear model if no models for new provider
    }
  };

  // Determine if API key or Base URL fields should be shown
  // HuggingFace might use an environment token, so API key field could be optional or handled differently.
  const showApiKeyInput = provider !== "huggingface"; // Example: HF might not need direct key input here
  const showBaseUrlInput = provider !== "huggingface"; // Example: HF has a fixed base URL via client

  return (
    <div className="">
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="iconXs" className="h-[28px] w-[28px]"> {/* Changed to icon button */}
            <SettingsIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="!rounded-2xl p-4 !w-96 overflow-hidden !bg-neutral-900 space-y-4" // Added space-y-4
          align="end" // Align to end to better fit UI
        >
          <header className="flex items-center justify-center text-sm pb-3 border-b gap-2 bg-neutral-900 border-neutral-800 font-semibold text-neutral-200 sticky top-0 z-10 -mx-4 px-4 pt-1">
            AI Provider Settings
          </header>

          <main className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto pr-1"> {/* Added scroll for long content */}
            {error && ( // Simplified error display
              <p className="text-red-500 text-xs font-medium bg-red-500/10 p-2 rounded-md">
                {error}
              </p>
            )}

            <div>
              <Label htmlFor="ai-provider-select" className="text-neutral-300 text-sm mb-1.5 block">
                AI Provider
              </Label>
              <Select value={provider} onValueChange={handleProviderSelect}>
                <SelectTrigger id="ai-provider-select" className="w-full h-9">
                  <SelectValue placeholder="Select Provider" />
                </SelectTrigger>
                <SelectContent>
                  {GENERIC_PROVIDERS.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-sm">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="ai-model-select" className="text-neutral-300 text-sm mb-1.5 block">
                Model Name
              </Label>
              <Select
                value={model}
                onValueChange={onModelChange}
                disabled={isFollowUp && provider === "huggingface"} // HF 'isThinker' logic might apply
              >
                <SelectTrigger id="ai-model-select" className="w-full h-9">
                  <SelectValue placeholder="Select or enter model" />
                </SelectTrigger>
                <SelectContent>
                  {currentProviderModels.length > 0 ? (
                    currentProviderModels.map(({ value, label, isNew, isThinker }) => (
                      <SelectItem
                        key={value}
                        value={value}
                        className="text-sm"
                        disabled={isFollowUp && provider === "huggingface" && isThinker}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span>{label}</span>
                          <div className="flex items-center gap-1">
                            {isNew && (
                              <span className="text-[9px] bg-sky-500 text-white rounded-full px-1 py-0">New</span>
                            )}
                            {isThinker && provider === "huggingface" && (
                              <Tooltip delayDuration={100}>
                                <TooltipTrigger onClick={(e) => e.stopPropagation()}>
                                  <Info className="size-3 text-neutral-400" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs bg-neutral-950 text-neutral-200 text-xs p-2 rounded-md">
                                  This HuggingFace model may show its thinking process. Not recommended for follow-ups.
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-2 py-3 text-center text-xs text-neutral-400">
                      No pre-defined models for this provider. Please enter model name manually.
                    </div>
                  )}
                </SelectContent>
              </Select>
              <Input
                id="ai-model-manual-input"
                type="text"
                placeholder="Or type custom model name"
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                className="h-9 mt-2 text-sm w-full"
              />
            </div>

            {isFollowUp && provider === "huggingface" && HF_MODELS.find(m => m.value === model)?.isThinker && (
              <div className="bg-amber-500/10 border-amber-500/20 p-2 text-xs text-amber-400 border rounded-md">
                Note: Selected HuggingFace 'Thinker' model is not ideal for follow-ups. Consider changing.
              </div>
            )}

            {showApiKeyInput && (
              <div>
                <Label htmlFor="api-key-input" className="text-neutral-300 text-sm mb-1.5 block">
                  API Key <span className="text-neutral-500 text-xs">({GENERIC_PROVIDERS.find(p => p.id === provider)?.name})</span>
                </Label>
                <Input
                  id="api-key-input"
                  type="password"
                  placeholder="Enter your API Key"
                  value={apiKey}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  className="h-9 w-full text-sm"
                />
              </div>
            )}

            {showBaseUrlInput && (
              <div>
                <Label htmlFor="base-url-input" className="text-neutral-300 text-sm mb-1.5 block">
                  Base URL <span className="text-neutral-500 text-xs">(Optional)</span>
                </Label>
                <Input
                  id="base-url-input"
                  type="text"
                  placeholder="e.g., https://api.example.com/v1"
                  value={baseUrl}
                  onChange={(e) => onBaseUrlChange(e.target.value)}
                  className="h-9 w-full text-sm"
                />
              </div>
            )}
          </main>
          <footer className="px-4 py-3 border-t border-neutral-800 sticky bottom-0 bg-neutral-900 z-10 -mx-4">
             <Button onClick={() => setPopoverOpen(false)} className="w-full h-9">Done</Button>
          </footer>
        </PopoverContent>
      </Popover>
    </div>
  );
}
