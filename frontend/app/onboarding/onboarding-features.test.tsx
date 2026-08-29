// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/i18n/use-i18n", () => ({
    useTranslation: () => ({
        t: (message: string, values?: Record<string, string>) =>
            message.replace(/{{(\w+)}}/g, (_match, key) => values?.[key] ?? ""),
    }),
}));
vi.mock("@/app/i18n/current-i18n", () => ({
    tCurrent: (message: string) => message,
}));

import { WaveAIPage } from "./onboarding-features";

describe("Wave AI onboarding", () => {
    it("introduces terminal AI mode instead of the retired global AI panel", () => {
        const markup = renderToStaticMarkup(<WaveAIPage onNext={vi.fn()} onSkip={vi.fn()} />);

        expect(markup).toContain("AI mode inside your terminal");
        expect(markup).toContain("current terminal output");
        expect(markup).not.toContain("Wave AI panel");
        expect(markup).not.toContain("AI button in the header (top left)");
    });
});
