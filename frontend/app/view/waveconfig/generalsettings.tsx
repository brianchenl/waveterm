// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AppLanguage, languageDisplayName } from "@/app/i18n/i18n";
import { useTranslation } from "@/app/i18n/use-i18n";
import { getSettingsKeyAtom } from "@/app/store/global";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useAtomValue } from "jotai";
import { useId, useState } from "react";

const LanguageOptions: AppLanguage[] = ["auto", "zh-CN", "en-US"];

export function GeneralSettingsContent({ model }: { model: WaveConfigViewModel }) {
    const { locale, t } = useTranslation();
    const configuredLanguage = useAtomValue(getSettingsKeyAtom("app:language")) as AppLanguage | undefined;
    const language = configuredLanguage ?? "auto";
    const [isSaving, setIsSaving] = useState(false);
    const [status, setStatus] = useState("");
    const selectId = useId();

    const updateLanguage = async (nextLanguage: AppLanguage) => {
        setIsSaving(true);
        setStatus("");
        try {
            await model.env.rpc.SetConfigCommand(TabRpcClient, { "app:language": nextLanguage });
            setStatus(t("Language saved"));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatus(t("Unable to save language: {{error}}", { error: message }));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="h-full overflow-y-auto p-5 @w700:p-8">
            <section className="max-w-2xl" aria-labelledby={`${selectId}-heading`}>
                <h2 id={`${selectId}-heading`} className="text-lg font-semibold text-primary mb-1">
                    {t("Language")}
                </h2>
                <p className="text-sm text-muted-foreground mb-5 max-w-xl">
                    {t(
                        "Choose the language used by Wave. Terminal output, file contents, and AI responses are never translated automatically."
                    )}
                </p>
                <div className="rounded-lg border border-border bg-secondary/10 p-4">
                    <label htmlFor={selectId} className="block text-sm font-medium text-primary mb-2">
                        {t("Interface language")}
                    </label>
                    <select
                        id={selectId}
                        value={language}
                        disabled={isSaving}
                        onChange={(event) => updateLanguage(event.target.value as AppLanguage)}
                        className="w-full max-w-sm min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm text-primary outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
                    >
                        {LanguageOptions.map((option) => (
                            <option key={option} value={option}>
                                {languageDisplayName(option, locale)}
                            </option>
                        ))}
                    </select>
                    <div className="min-h-5 pt-2 text-xs text-muted-foreground" aria-live="polite">
                        {status}
                    </div>
                </div>
            </section>
        </div>
    );
}
