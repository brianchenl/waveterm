// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { AppLanguage, resolveLocale, translate, TranslationValues } from "./i18n";

export function currentLocale() {
    const language = globalStore.get(getSettingsKeyAtom("app:language")) as AppLanguage | undefined;
    return resolveLocale(language);
}

export function tCurrent(message: string, values?: TranslationValues): string {
    return translate(currentLocale(), message, values);
}
