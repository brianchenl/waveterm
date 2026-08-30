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
    it("explains in-place command-line enhancement without automatic execution", () => {
        const markup = renderToStaticMarkup(<WaveAIPage onNext={vi.fn()} onSkip={vi.fn()} />);

        expect(markup).toContain(
            "Type your intent at the command line, then press the shortcut to enhance it in place."
        );
        expect(markup).toContain("Nothing runs automatically.");
        expect(markup).not.toContain("AI mode");
        expect(markup).not.toContain("AI button");
    });
});
