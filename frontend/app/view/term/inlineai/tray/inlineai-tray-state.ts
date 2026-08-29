// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { InlineAIShellCodeCandidate, InlineAITrayStatus } from "./inlineai-tray-types";

export type InlineAIKeySource = "composer" | "tray";

export interface InlineAIKeyEvent {
    key: string;
    code?: string;
    shiftKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    isComposing?: boolean;
    keyCode?: number;
    source: InlineAIKeySource;
    preventDefault: () => void;
    stopPropagation: () => void;
}

export interface InlineAIKeyActions {
    close: () => void;
    focusTerminal: () => void;
    submit?: () => void;
}

export type InlineAIKeyResult = "close" | "native" | "submit" | "contained";

export interface InlineAITrayViewState {
    canCancel: boolean;
    canSubmit: boolean;
    latestShellCodeCanFill: boolean;
}

const UnsafeCommandCharacterRegex = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

export function isFillableShellCode(code: string): boolean {
    return code.trim().length > 0 && !UnsafeCommandCharacterRegex.test(code);
}

export function deriveInlineAITrayViewState(
    input: string,
    status: InlineAITrayStatus,
    latestCompletedShellCode?: InlineAIShellCodeCandidate | null
): InlineAITrayViewState {
    return {
        canCancel: status === "streaming" || status === "submitted",
        canSubmit: (status === "ready" || status === "error") && input.trim().length > 0,
        latestShellCodeCanFill: latestCompletedShellCode != null && isFillableShellCode(latestCompletedShellCode.code),
    };
}

export function handleInlineAITrayKeyDown(event: InlineAIKeyEvent, actions: InlineAIKeyActions): InlineAIKeyResult {
    // Terminal key handlers must never see keystrokes that belong to the tray.
    event.stopPropagation();

    const isComposing = event.isComposing || event.keyCode === 229;
    if (isComposing) {
        return "native";
    }

    const normalizedKey = event.key.toLowerCase();
    const isDigitZero = event.code === "Digit0" || normalizedKey === "0";
    const hasMeta = event.metaKey === true;
    const hasControl = event.ctrlKey === true;
    const hasShift = event.shiftKey === true;
    const hasAlt = event.altKey === true;
    const isPrimaryToggle = normalizedKey === "a" && hasShift && !hasAlt && hasMeta !== hasControl;
    const isWindowsToggle = isDigitZero && hasAlt && !hasMeta && !hasControl && !hasShift;
    const isLinuxToggle = isDigitZero && hasControl && hasShift && !hasMeta && !hasAlt;

    if (event.key === "Escape" || isPrimaryToggle || isWindowsToggle || isLinuxToggle) {
        event.preventDefault();
        actions.close();
        actions.focusTerminal();
        return "close";
    }

    if (event.key === "Tab") {
        return "native";
    }

    if (event.source !== "composer" || event.key !== "Enter") {
        return "contained";
    }

    if (event.shiftKey) {
        return "native";
    }

    event.preventDefault();
    if (actions.submit == null) {
        return "contained";
    }
    actions.submit();
    return "submit";
}
