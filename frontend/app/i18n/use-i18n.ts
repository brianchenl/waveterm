// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getSettingsKeyAtom } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { useCallback } from "react";
import { AppLanguage, AppLocale, resolveLocale, translate, TranslationValues } from "./i18n";

export function useAppLocale(): AppLocale {
    const language = useAtomValue(getSettingsKeyAtom("app:language")) as AppLanguage | undefined;
    return resolveLocale(language);
}

export function useTranslation() {
    const locale = useAppLocale();
    const t = useCallback(
        (message: string, values?: TranslationValues) => translate(locale, message, values),
        [locale]
    );
    return { locale, t };
}
