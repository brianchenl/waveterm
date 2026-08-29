// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/i18n/current-i18n", () => ({
    tCurrent: (message: string) => message,
}));

import {
    createTerminalAILoaderHandle,
    handleTerminalAILoadingKeyDown,
    TerminalAILoadingPlaceholder,
    type TerminalAILoaderState,
    type TerminalAILoadingKeyEvent,
} from "./terminal-ai-controller-loader";

function makeKeyEvent(overrides: Partial<TerminalAILoadingKeyEvent> = {}) {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const event: TerminalAILoadingKeyEvent = {
        key: "x",
        preventDefault,
        stopPropagation,
        ...overrides,
    };
    return { event, preventDefault, stopPropagation };
}

describe("TerminalAIControllerLoader cold loading", () => {
    it("blurs xterm synchronously and lets a second toggle close while the module is loading", () => {
        const blur = vi.fn();
        const giveFocus = vi.fn();
        const states: TerminalAILoaderState[] = [];
        const model = { termRef: { current: { terminal: { blur } } }, giveFocus } as any;
        const handle = createTerminalAILoaderHandle(model, (state) => states.push(state));

        handle.toggle();
        handle.toggle();

        expect(blur).toHaveBeenCalledOnce();
        expect(giveFocus).toHaveBeenCalledOnce();
        expect(states).toHaveLength(2);
        expect(states[0]).toMatchObject({ activated: true });
        expect(states[0].initialSeed?.completion).toEqual({
            resolve: expect.any(Function),
            reject: expect.any(Function),
        });
        expect(states[1]).toEqual({ activated: false, initialSeed: null });
    });

    it("acknowledges an external open only after the lazy controller processes its seed", async () => {
        const states: TerminalAILoaderState[] = [];
        const model = {
            termRef: { current: { terminal: { blur: vi.fn() } } },
            giveFocus: vi.fn(),
        } as any;
        const handle = createTerminalAILoaderHandle(model, (state) => states.push(state));

        const opening = handle.open({ text: "explain this", submit: true });
        let settled = false;
        void Promise.resolve(opening).then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        states[0].initialSeed?.completion?.resolve();
        await expect(opening).resolves.toBeUndefined();
        expect(settled).toBe(true);
    });

    it("rejects a pending external open when its terminal loader unmounts", async () => {
        const model = {
            termRef: { current: { terminal: { blur: vi.fn() } } },
            giveFocus: vi.fn(),
        } as any;
        const handle = createTerminalAILoaderHandle(model, vi.fn());

        const opening = handle.open({ text: "pending" });
        handle.dispose();

        await expect(opening).rejects.toThrow("Terminal closed");
    });

    it("renders a focusable loading target that can close AI mode", () => {
        const markup = renderToStaticMarkup(<TerminalAILoadingPlaceholder blockId="block-1" onClose={vi.fn()} />);

        expect(markup).toContain('data-terminal-ai-loading="true"');
        expect(markup).toContain('tabindex="0"');
        expect(markup).toContain('aria-label="Close AI mode and return to terminal"');
    });

    it("contains every other keydown so it cannot reach the PTY or global block shortcuts", () => {
        const closeAndFocusTerminal = vi.fn();
        const { event, preventDefault, stopPropagation } = makeKeyEvent({ key: "k", ctrlKey: true });

        expect(handleTerminalAILoadingKeyDown(event, closeAndFocusTerminal)).toBe("contained");
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(preventDefault).not.toHaveBeenCalled();
        expect(closeAndFocusTerminal).not.toHaveBeenCalled();
    });

    it("closes and restores terminal focus on Escape without leaking the keydown", () => {
        const closeAndFocusTerminal = vi.fn();
        const { event, preventDefault, stopPropagation } = makeKeyEvent({ key: "Escape" });

        expect(handleTerminalAILoadingKeyDown(event, closeAndFocusTerminal)).toBe("close");
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(closeAndFocusTerminal).toHaveBeenCalledOnce();
    });

    it.each([
        { key: "a", shiftKey: true, metaKey: true },
        { key: "A", shiftKey: true, ctrlKey: true },
        { key: "0", altKey: true },
        { key: "0", shiftKey: true, ctrlKey: true },
        { key: ")", code: "Digit0", shiftKey: true, ctrlKey: true },
    ])("closes locally for an exact AI toggle shortcut: $key", (shortcut) => {
        const closeAndFocusTerminal = vi.fn();
        const { event, preventDefault, stopPropagation } = makeKeyEvent(shortcut);

        expect(handleTerminalAILoadingKeyDown(event, closeAndFocusTerminal)).toBe("close");
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(closeAndFocusTerminal).toHaveBeenCalledOnce();
    });

    it.each([
        { key: "a", shiftKey: true },
        { key: "a", shiftKey: true, metaKey: true, altKey: true },
        { key: "a", shiftKey: true, metaKey: true, ctrlKey: true },
        { key: "0", altKey: true, shiftKey: true },
        { key: "0", shiftKey: true, ctrlKey: true, altKey: true },
    ])("contains but does not close for a near-miss shortcut: $key", (shortcut) => {
        const closeAndFocusTerminal = vi.fn();
        const { event, preventDefault, stopPropagation } = makeKeyEvent(shortcut);

        expect(handleTerminalAILoadingKeyDown(event, closeAndFocusTerminal)).toBe("contained");
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(preventDefault).not.toHaveBeenCalled();
        expect(closeAndFocusTerminal).not.toHaveBeenCalled();
    });
});
