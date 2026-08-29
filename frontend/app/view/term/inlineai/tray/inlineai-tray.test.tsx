// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveUIMessage } from "@/app/aipanel/aitypes";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/i18n/current-i18n", () => ({
    tCurrent: (message: string, values?: Record<string, string>) =>
        message.replace(/{{(\w+)}}/g, (_match, key) => values?.[key] ?? ""),
}));

import { InlineAITray } from "./inlineai-tray";
import {
    deriveInlineAITrayViewState,
    handleInlineAITrayKeyDown,
    isFillableShellCode,
    type InlineAIKeyEvent,
} from "./inlineai-tray-state";
import type { InlineAITrayProps } from "./inlineai-tray-types";

function makeKeyEvent(overrides: Partial<InlineAIKeyEvent> = {}) {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const event: InlineAIKeyEvent = {
        key: "x",
        source: "tray",
        preventDefault,
        stopPropagation,
        ...overrides,
    };
    return { event, preventDefault, stopPropagation };
}

const CompletedMessage: WaveUIMessage = {
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text: "Use this command." }],
};

function renderTray(overrides: Partial<InlineAITrayProps> = {}) {
    const props: InlineAITrayProps = {
        blockId: "block-42",
        context: {
            included: true,
            snapshot: { cwd: "/work/wave" },
            view: { label: "Terminal context", detail: "Current working directory", preview: "/work/wave" },
        },
        messages: [CompletedMessage],
        status: "ready",
        latestCompletedShellCode: {
            messageId: "assistant-1",
            language: "bash",
            code: "git status --short",
        },
        autoFocus: false,
        renderMessage: ({ message, commandAction }) => (
            <div>
                {message.parts
                    ?.filter((part) => part.type === "text")
                    .map((part) => (part.type === "text" ? part.text : ""))
                    .join("")}
                {commandAction}
            </div>
        ),
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
        onRetry: vi.fn(),
        onToggleContext: vi.fn(),
        onInsertCommand: vi.fn(),
        onClose: vi.fn(),
        onRequestTerminalFocus: vi.fn(),
        ...overrides,
    };
    return renderToStaticMarkup(<InlineAITray {...props} />);
}

describe("InlineAITray keyboard interface", () => {
    it("submits Enter from the composer and contains the keystroke", () => {
        const submit = vi.fn();
        const { event, preventDefault, stopPropagation } = makeKeyEvent({ key: "Enter", source: "composer" });

        expect(
            handleInlineAITrayKeyDown(event, {
                close: vi.fn(),
                focusTerminal: vi.fn(),
                submit,
            })
        ).toBe("submit");
        expect(submit).toHaveBeenCalledOnce();
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(stopPropagation).toHaveBeenCalledOnce();
    });

    it("leaves Shift+Enter to the textarea for a newline without leaking it", () => {
        const submit = vi.fn();
        const { event, preventDefault, stopPropagation } = makeKeyEvent({
            key: "Enter",
            shiftKey: true,
            source: "composer",
        });

        expect(
            handleInlineAITrayKeyDown(event, {
                close: vi.fn(),
                focusTerminal: vi.fn(),
                submit,
            })
        ).toBe("native");
        expect(submit).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
        expect(stopPropagation).toHaveBeenCalledOnce();
    });

    it("closes before requesting terminal focus on Escape", () => {
        const calls: string[] = [];
        const { event, preventDefault, stopPropagation } = makeKeyEvent({ key: "Escape" });

        expect(
            handleInlineAITrayKeyDown(event, {
                close: () => calls.push("close"),
                focusTerminal: () => calls.push("focus"),
            })
        ).toBe("close");
        expect(calls).toEqual(["close", "focus"]);
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(stopPropagation).toHaveBeenCalledOnce();
    });

    it("keeps IME Escape inside the composer without closing or discarding the draft", () => {
        const close = vi.fn();
        const focusTerminal = vi.fn();
        const { event, preventDefault, stopPropagation } = makeKeyEvent({
            key: "Escape",
            isComposing: true,
            source: "composer",
        });

        expect(handleInlineAITrayKeyDown(event, { close, focusTerminal })).toBe("native");
        expect(close).not.toHaveBeenCalled();
        expect(focusTerminal).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
        expect(stopPropagation).toHaveBeenCalledOnce();
    });

    it("preserves native Tab navigation while containing the event", () => {
        const { event, preventDefault, stopPropagation } = makeKeyEvent({ key: "Tab" });

        expect(
            handleInlineAITrayKeyDown(event, {
                close: vi.fn(),
                focusTerminal: vi.fn(),
                submit: vi.fn(),
            })
        ).toBe("native");
        expect(preventDefault).not.toHaveBeenCalled();
        expect(stopPropagation).toHaveBeenCalledOnce();
    });

    it("closes locally when the AI toggle shortcut is pressed inside the composer", () => {
        const calls: string[] = [];
        const { event, preventDefault, stopPropagation } = makeKeyEvent({
            key: "a",
            shiftKey: true,
            metaKey: true,
            source: "composer",
        });

        expect(
            handleInlineAITrayKeyDown(event, {
                close: () => calls.push("close"),
                focusTerminal: () => calls.push("focus"),
            })
        ).toBe("close");
        expect(calls).toEqual(["close", "focus"]);
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(stopPropagation).toHaveBeenCalledOnce();
    });

    it("contains a near-miss AI shortcut without closing the tray", () => {
        const close = vi.fn();
        const focusTerminal = vi.fn();
        const { event, preventDefault, stopPropagation } = makeKeyEvent({
            key: "a",
            shiftKey: true,
            metaKey: true,
            altKey: true,
            source: "composer",
        });

        expect(handleInlineAITrayKeyDown(event, { close, focusTerminal })).toBe("contained");
        expect(close).not.toHaveBeenCalled();
        expect(focusTerminal).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
        expect(stopPropagation).toHaveBeenCalledOnce();
    });

    it("recognizes Linux Ctrl+Shift+Digit0 when the produced key is a closing parenthesis", () => {
        const calls: string[] = [];
        const { event } = makeKeyEvent({
            key: ")",
            code: "Digit0",
            shiftKey: true,
            ctrlKey: true,
            source: "composer",
        });

        expect(
            handleInlineAITrayKeyDown(event, {
                close: () => calls.push("close"),
                focusTerminal: () => calls.push("focus"),
            })
        ).toBe("close");
        expect(calls).toEqual(["close", "focus"]);
    });
});

describe("InlineAITray command safety", () => {
    it("allows only non-empty, single-line shell code without control characters", () => {
        expect(isFillableShellCode("git status --short")).toBe(true);
        expect(isFillableShellCode("printf 'one'\nprintf 'two'")).toBe(false);
        expect(isFillableShellCode("printf\t'one'")).toBe(false);
        expect(isFillableShellCode("printf '\u001b[31m'")).toBe(false);
        expect(isFillableShellCode("   ")).toBe(false);
    });

    it("derives Fill availability from the integration-provided completed shell candidate", () => {
        const state = deriveInlineAITrayViewState("prompt", "ready", {
            messageId: "assistant-1",
            code: "git status --short",
        });
        expect(state.canSubmit).toBe(true);
        expect(state.latestShellCodeCanFill).toBe(true);
    });

    it("allows a corrected prompt after an AI request error", () => {
        expect(deriveInlineAITrayViewState("try again", "error").canSubmit).toBe(true);
    });
});

describe("InlineAITray rendered interface", () => {
    it("exposes the terminal marker, block identity, context, messages, and focusable Fill action", () => {
        const markup = renderTray();

        expect(markup).toContain('data-terminal-ai="true"');
        expect(markup).toContain('data-block-id="block-42"');
        expect(markup).toContain("AI mode");
        expect(markup).toContain("Terminal context");
        expect(markup).toContain("Use this command.");
        expect(markup).toContain('aria-label="Fill terminal with command"');
        expect(markup).not.toContain('tabindex="-1"');
    });

    it("leaves unsafe shell code without a Fill action", () => {
        const markup = renderTray({
            latestCompletedShellCode: {
                messageId: "assistant-1",
                language: "bash",
                code: "echo one\necho two",
            },
        });

        expect(markup).toContain("Use this command.");
        expect(markup).not.toContain('aria-label="Fill terminal with command"');
    });

    it("can start with the prop-driven response tray collapsed", () => {
        const markup = renderTray({ defaultResponsesExpanded: false });

        expect(markup).toContain('aria-expanded="false"');
        expect(markup).not.toContain("Use this command.");
    });

    it("shows a retry action in the error state", () => {
        expect(renderTray({ status: "error" })).toContain("Retry");
    });
});
