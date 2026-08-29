// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveUIMessage } from "@/app/aipanel/aitypes";
import type { ReactNode } from "react";

export type InlineAITrayStatus = "ready" | "submitted" | "streaming" | "error";

export interface InlineAIContextSnapshot {
    readonly [key: string]: unknown;
}

export interface InlineAIContextView {
    label: string;
    detail?: string;
    preview?: string;
}

export interface InlineAIContextData {
    included: boolean;
    snapshot: InlineAIContextSnapshot | null;
    view: InlineAIContextView;
}

export interface InlineAIShellCodeCandidate {
    messageId: string;
    code: string;
    language?: string;
}

export interface InlineAIMessageRenderProps {
    message: WaveUIMessage;
    isStreaming: boolean;
    commandAction: ReactNode;
}

export interface InlineAISubmitRequest {
    blockId: string;
    prompt: string;
    contextSnapshot: InlineAIContextSnapshot | null;
}

export interface InlineAIContextToggleRequest {
    blockId: string;
    included: boolean;
}

export interface InlineAIInsertCommandRequest {
    blockId: string;
    command: string;
}

export interface InlineAITrayHandle {
    focus: () => void;
    focusComposer: () => void;
    setInput: (text: string) => void;
}

export interface InlineAITrayProps {
    blockId: string;
    context: InlineAIContextData;
    messages: readonly WaveUIMessage[];
    status: InlineAITrayStatus;
    latestCompletedShellCode?: InlineAIShellCodeCandidate | null;
    statusText?: string;
    autoFocus?: boolean;
    defaultResponsesExpanded?: boolean;
    placeholder?: string;
    renderMessage?: (props: InlineAIMessageRenderProps) => ReactNode;
    /** Returns true only when the composer contents were accepted by the conversation. */
    onSubmit: (request: InlineAISubmitRequest) => boolean | Promise<boolean>;
    onCancel: (blockId: string) => void;
    onRetry: (blockId: string) => void;
    onToggleContext: (request: InlineAIContextToggleRequest) => void;
    onInsertCommand: (request: InlineAIInsertCommandRequest) => void;
    onClose: (blockId: string) => void;
    onRequestTerminalFocus: (blockId: string) => void;
}
