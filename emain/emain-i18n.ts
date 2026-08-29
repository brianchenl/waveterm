// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AppLanguage, resolveLocale, translate, TranslationValues } from "@/app/i18n/i18n";

let mainProcessLanguage: AppLanguage = "zh-CN";

export function setMainProcessLanguage(language?: string | null) {
    if (language === "auto" || language === "en-US" || language === "zh-CN") {
        mainProcessLanguage = language;
        return;
    }
    mainProcessLanguage = "zh-CN";
}

export function tMain(message: string, values?: TranslationValues): string {
    return translate(resolveLocale(mainProcessLanguage), message, values);
}
