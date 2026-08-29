// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export { InlineAITray } from "./inlineai-tray";
export { deriveInlineAITrayViewState, handleInlineAITrayKeyDown, isFillableShellCode } from "./inlineai-tray-state";
export type {
    InlineAIContextData,
    InlineAIContextSnapshot,
    InlineAIContextToggleRequest,
    InlineAIContextView,
    InlineAIInsertCommandRequest,
    InlineAIMessageRenderProps,
    InlineAIShellCodeCandidate,
    InlineAISubmitRequest,
    InlineAITrayHandle,
    InlineAITrayProps,
    InlineAITrayStatus,
} from "./inlineai-tray-types";
