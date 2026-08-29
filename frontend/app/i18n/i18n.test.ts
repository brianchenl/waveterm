// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLocale, translate } from "./i18n";

describe("i18n", () => {
    it("uses an explicitly configured language", () => {
        expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN");
        expect(resolveLocale("en-US", "zh-CN")).toBe("en-US");
    });

    it("follows the system language in automatic mode", () => {
        expect(resolveLocale("auto", "zh-Hans-CN")).toBe("zh-CN");
        expect(resolveLocale("auto", "en-GB")).toBe("en-US");
    });

    it("defaults new and unconfigured installations to Simplified Chinese", () => {
        expect(resolveLocale(undefined, "en-GB")).toBe("zh-CN");
        const defaultSettings = JSON.parse(
            fs.readFileSync(path.join(process.cwd(), "pkg/wconfig/defaultconfig/settings.json"), "utf8")
        );
        expect(defaultSettings["app:language"]).toBe("zh-CN");
    });

    it("falls back to the English source when a translation is missing", () => {
        expect(translate("zh-CN", "Untranslated string")).toBe("Untranslated string");
    });

    it("interpolates translated values", () => {
        expect(translate("zh-CN", "Save ({{shortcut}})", { shortcut: "Ctrl+S" })).toBe("保存（Ctrl+S）");
    });
});
