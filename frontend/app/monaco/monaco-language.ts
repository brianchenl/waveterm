// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type MonacoLanguageFeature = "css" | "go" | "html" | "json" | "python" | "shell" | "typescript" | "yaml" | null;

const CssLanguages = new Set(["css", "scss", "less"]);
const HtmlLanguages = new Set(["html", "handlebars", "razor"]);
const TypeScriptLanguages = new Set(["typescript", "javascript", "typescriptreact", "javascriptreact"]);
const YamlLanguages = new Set(["yaml", "yml"]);

export function getMonacoLanguageFeature(language: unknown): MonacoLanguageFeature {
    if (typeof language !== "string") {
        return null;
    }
    const normalized = language.trim().toLowerCase();
    if (normalized === "json" || normalized === "jsonc") return "json";
    if (normalized === "go") return "go";
    if (normalized === "python") return "python";
    if (normalized === "shell" || normalized === "sh") return "shell";
    if (CssLanguages.has(normalized)) return "css";
    if (HtmlLanguages.has(normalized)) return "html";
    if (TypeScriptLanguages.has(normalized)) return "typescript";
    if (YamlLanguages.has(normalized)) return "yaml";
    return null;
}
