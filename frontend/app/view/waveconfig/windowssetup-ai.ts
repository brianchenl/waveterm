export type WindowsAIProvider = "ollama" | "deepseek" | "kimi";
export type ReasoningEffort = "low" | "high" | "max";

const ProviderDefaults: Record<WindowsAIProvider, { model: string; displayName: string; secretName?: string }> = {
    ollama: { model: "qwen2.5-coder:7b", displayName: "Ollama" },
    deepseek: { model: "deepseek-v4-pro", displayName: "DeepSeek", secretName: "DEEPSEEK_KEY" },
    kimi: { model: "kimi-for-coding", displayName: "Kimi Code Plan", secretName: "KIMI_CODE_KEY" },
};

export function getAIProviderDefaults(provider: WindowsAIProvider) {
    return ProviderDefaults[provider];
}

export function makeAIModeKey(provider: WindowsAIProvider, model: string): string {
    const normalizedModel = model
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return `${provider}-${normalizedModel || "model"}`;
}

export function kimiModelSupportsReasoningEffort(model: string): boolean {
    const normalizedModel = model.trim().toLowerCase();
    return normalizedModel === "k3" || normalizedModel === "k3-256k";
}

export function buildAIMode(
    provider: WindowsAIProvider,
    model: string,
    reasoningEffort: ReasoningEffort,
    proxyUrl = ""
): AIModeConfigType {
    const defaults = getAIProviderDefaults(provider);
    const base: AIModeConfigType = {
        "display:name": `${defaults.displayName} - ${model}`,
        "display:icon": provider === "kimi" ? "moon" : provider === "deepseek" ? "brain" : "microchip",
        "display:description":
            provider === "ollama" ? "Windows local model via Ollama" : `${defaults.displayName} cloud model`,
        "ai:model": model,
        "ai:capabilities": ["tools"],
    };
    if (provider === "ollama") {
        return {
            ...base,
            "ai:apitype": "openai-chat",
            "ai:endpoint": "http://127.0.0.1:11434/v1/chat/completions",
            "ai:apitoken": "ollama",
            "ai:thinkinglevel": reasoningEffort === "low" ? "low" : reasoningEffort === "high" ? "medium" : "high",
        };
    }
    if (provider === "deepseek") {
        return {
            ...base,
            "ai:provider": "deepseek",
            "ai:thinking": { type: "enabled" },
            "ai:reasoningeffort": reasoningEffort,
            ...(proxyUrl ? { "ai:proxyurl": proxyUrl } : {}),
        };
    }
    return {
        ...base,
        "ai:provider": "kimi",
        "ai:capabilities": ["tools", "images"],
        "ai:thinking": { type: "enabled", keep: "all" },
        ...(kimiModelSupportsReasoningEffort(model) ? { "ai:reasoningeffort": reasoningEffort } : {}),
        ...(proxyUrl ? { "ai:proxyurl": proxyUrl } : {}),
    };
}

export function mergeAIModeConfig(
    currentConfig: Record<string, AIModeConfigType>,
    modeKey: string,
    mode: AIModeConfigType
): Record<string, AIModeConfigType> {
    return { ...currentConfig, [modeKey]: mode };
}
