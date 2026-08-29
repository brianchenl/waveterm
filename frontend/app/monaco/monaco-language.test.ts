// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getMonacoLanguageFeature } from "./monaco-language";

describe("getMonacoLanguageFeature", () => {
    it.each([
        ["json", "json"],
        ["JSONC", "json"],
        ["scss", "css"],
        ["go", "go"],
        ["handlebars", "html"],
        ["javascriptreact", "typescript"],
        ["yml", "yaml"],
        ["sh", "shell"],
    ])("maps %s to its optional language feature", (language, expected) => {
        expect(getMonacoLanguageFeature(language)).toBe(expected);
    });

    it.each(["plaintext", "rust", "", null, {}])("keeps %s on the core editor only", (language) => {
        expect(getMonacoLanguageFeature(language)).toBeNull();
    });
});
