// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

let focusHandler: (() => void) | null = null;
let focusPending = false;

export function registerAIPanelFocusHandler(handler: () => void): () => void {
    focusHandler = handler;
    if (focusPending) {
        focusPending = false;
        handler();
    }
    return () => {
        if (focusHandler === handler) {
            focusHandler = null;
        }
    };
}

export function requestAIPanelFocus(): void {
    if (focusHandler != null) {
        focusHandler();
        return;
    }
    focusPending = true;
}

export function cancelAIPanelFocusRequest(): void {
    focusPending = false;
}
