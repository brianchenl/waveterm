import { describe, expect, it } from "vitest";
import {
    buildAIMode,
    getAIProviderDefaults,
    kimiModelSupportsReasoningEffort,
    makeAIModeKey,
    mergeAIModeConfig,
} from "./windowssetup-ai";

describe("Windows AI setup", () => {
    it("builds an Ollama mode without storing a real secret", () => {
        const mode = buildAIMode("ollama", "qwen2.5-coder:7b", "high");
        expect(mode["ai:endpoint"]).toBe("http://127.0.0.1:11434/v1/chat/completions");
        expect(mode["ai:apitoken"]).toBe("ollama");
        expect(mode["ai:thinkinglevel"]).toBe("medium");
    });

    it("builds DeepSeek and Kimi Code modes with model-specific thinking", () => {
        expect(buildAIMode("deepseek", "deepseek-v4-pro", "max", "http://127.0.0.1:7890")).toMatchObject({
            "ai:provider": "deepseek",
            "ai:thinking": { type: "enabled" },
            "ai:reasoningeffort": "max",
            "ai:proxyurl": "http://127.0.0.1:7890",
        });
        expect(buildAIMode("kimi", "k3", "low")).toMatchObject({
            "ai:provider": "kimi",
            "ai:capabilities": ["tools", "images"],
            "ai:thinking": { type: "enabled", keep: "all" },
            "ai:reasoningeffort": "low",
        });
        const codingMode = buildAIMode("kimi", "kimi-for-coding", "max");
        expect(codingMode).toMatchObject({
            "ai:provider": "kimi",
            "ai:thinking": { type: "enabled", keep: "all" },
        });
        expect(codingMode["ai:reasoningeffort"]).toBeUndefined();
    });

    it("uses Kimi Code Plan defaults", () => {
        expect(getAIProviderDefaults("kimi")).toEqual({
            model: "kimi-for-coding",
            displayName: "Kimi Code Plan",
            secretName: "KIMI_CODE_KEY",
        });
        expect(kimiModelSupportsReasoningEffort("k3-256k")).toBe(true);
        expect(kimiModelSupportsReasoningEffort("kimi-for-coding-highspeed")).toBe(false);
    });

    it("creates safe mode keys and preserves existing modes", () => {
        const key = makeAIModeKey("ollama", "Qwen 2.5 / Coder");
        const existing = { old: { "display:name": "Old" } };
        const merged = mergeAIModeConfig(existing, key, { "display:name": "New" });
        expect(key).toBe("ollama-qwen-2.5-coder");
        expect(merged.old["display:name"]).toBe("Old");
        expect(merged[key]["display:name"]).toBe("New");
    });
});
