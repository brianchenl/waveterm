// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIMessage } from "@/app/aipanel/aimessage";
import { tCurrent } from "@/app/i18n/current-i18n";
import * as React from "react";
import { deriveInlineAITrayViewState, handleInlineAITrayKeyDown } from "./inlineai-tray-state";
import type { InlineAITrayHandle, InlineAITrayProps, InlineAITrayStatus } from "./inlineai-tray-types";
import "./inlineai-tray.scss";

export const InlineAITray = React.memo(
    React.forwardRef<InlineAITrayHandle, InlineAITrayProps>(function InlineAITray(
        {
            blockId,
            context,
            messages,
            status,
            latestCompletedShellCode,
            statusText,
            autoFocus = true,
            defaultResponsesExpanded = true,
            placeholder = "Ask AI about this terminal…",
            renderMessage,
            onSubmit,
            onCancel,
            onRetry,
            onToggleContext,
            onInsertCommand,
            onClose,
            onRequestTerminalFocus,
        },
        ref
    ) {
        const t = tCurrent;
        const [input, setInput] = React.useState("");
        const [responsesExpanded, setResponsesExpanded] = React.useState(defaultResponsesExpanded);
        const [submitPending, setSubmitPending] = React.useState(false);
        const composerRef = React.useRef<HTMLTextAreaElement>(null);
        const messageListRef = React.useRef<HTMLDivElement>(null);
        const responsesId = React.useId();
        const contextId = React.useId();
        const viewState = React.useMemo(
            () => deriveInlineAITrayViewState(input, status, latestCompletedShellCode),
            [input, latestCompletedShellCode, status]
        );

        const focusComposer = React.useCallback(() => {
            composerRef.current?.focus();
        }, []);

        React.useImperativeHandle(
            ref,
            () => ({
                focus: focusComposer,
                focusComposer,
                setInput,
            }),
            [focusComposer]
        );

        const statusLabel: Record<InlineAITrayStatus, string> = {
            ready: t("Ready"),
            submitted: t("Thinking"),
            streaming: t("Responding"),
            error: t("Needs attention"),
        };

        React.useEffect(() => {
            if (!responsesExpanded) {
                return;
            }
            const frame = requestAnimationFrame(() => {
                const messageList = messageListRef.current;
                if (messageList) {
                    messageList.scrollTop = messageList.scrollHeight;
                }
            });
            return () => cancelAnimationFrame(frame);
        }, [messages, responsesExpanded, status]);

        const submit = React.useCallback(async () => {
            if (!viewState.canSubmit || submitPending) {
                return;
            }
            const prompt = input.trim();
            setSubmitPending(true);
            try {
                const accepted = await onSubmit({
                    blockId,
                    prompt,
                    contextSnapshot: context.included ? context.snapshot : null,
                });
                if (accepted) {
                    setInput("");
                }
            } finally {
                setSubmitPending(false);
            }
        }, [blockId, context.included, context.snapshot, input, onSubmit, submitPending, viewState.canSubmit]);

        const closeAndFocusTerminal = React.useCallback(() => {
            onClose(blockId);
            onRequestTerminalFocus(blockId);
        }, [blockId, onClose, onRequestTerminalFocus]);

        const handleKeyDown = React.useCallback(
            (event: React.KeyboardEvent<HTMLElement>) => {
                handleInlineAITrayKeyDown(
                    {
                        key: event.key,
                        code: event.code,
                        shiftKey: event.shiftKey,
                        metaKey: event.metaKey,
                        ctrlKey: event.ctrlKey,
                        altKey: event.altKey,
                        isComposing: event.nativeEvent.isComposing,
                        keyCode: event.keyCode,
                        source: event.target === composerRef.current ? "composer" : "tray",
                        preventDefault: () => event.preventDefault(),
                        stopPropagation: () => event.stopPropagation(),
                    },
                    {
                        close: () => onClose(blockId),
                        focusTerminal: () => onRequestTerminalFocus(blockId),
                        submit: viewState.canSubmit && !submitPending ? () => void submit() : undefined,
                    }
                );
            },
            [blockId, onClose, onRequestTerminalFocus, submit, submitPending, viewState.canSubmit]
        );

        const handleFormSubmit = React.useCallback(
            (event: React.FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                event.stopPropagation();
                void submit();
            },
            [submit]
        );

        const commandAction =
            viewState.latestShellCodeCanFill && latestCompletedShellCode != null ? (
                <button
                    type="button"
                    className="inline-ai-fill-command"
                    onClick={(event) => {
                        event.stopPropagation();
                        onInsertCommand({ blockId, command: latestCompletedShellCode.code });
                    }}
                    aria-label={t("Fill terminal with command")}
                >
                    {t("Fill latest command")}
                </button>
            ) : null;

        return (
            <section
                className="inline-ai-tray"
                data-terminal-ai="true"
                data-block-id={blockId}
                aria-label={t("AI mode for terminal {{blockId}}", { blockId })}
                onKeyDown={handleKeyDown}
                onKeyUp={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
            >
                <header className="inline-ai-tray-header">
                    <div className="inline-ai-mode-marker">
                        <span className="inline-ai-mode-dot" aria-hidden="true" />
                        <strong>{t("AI mode")}</strong>
                        <span className="inline-ai-status" role="status" aria-live="polite">
                            {statusText ?? statusLabel[status]}
                        </span>
                    </div>
                    <div className="inline-ai-header-actions">
                        <button
                            type="button"
                            className="inline-ai-context-toggle"
                            aria-pressed={context.included}
                            aria-controls={contextId}
                            onClick={() => onToggleContext({ blockId, included: !context.included })}
                        >
                            {context.included ? t("Context on") : t("Context off")}
                        </button>
                        <button
                            type="button"
                            className="inline-ai-close"
                            onClick={closeAndFocusTerminal}
                            aria-label={t("Close AI mode and return to terminal")}
                        >
                            <span aria-hidden="true">×</span>
                        </button>
                    </div>
                </header>

                <div id={contextId} className="inline-ai-context" aria-live="polite">
                    <span>{context.view.label}</span>
                    {context.view.detail && <span>{context.view.detail}</span>}
                    {context.included && context.view.preview && <code>{context.view.preview}</code>}
                </div>

                <div className="inline-ai-responses">
                    <button
                        type="button"
                        className="inline-ai-response-toggle"
                        aria-expanded={responsesExpanded}
                        aria-controls={responsesId}
                        onClick={() => setResponsesExpanded((expanded) => !expanded)}
                    >
                        <span aria-hidden="true">{responsesExpanded ? "▾" : "▸"}</span>
                        {t("Responses")}
                        <span className="inline-ai-response-count">{messages.length}</span>
                    </button>
                    {responsesExpanded && (
                        <div
                            ref={messageListRef}
                            id={responsesId}
                            className="inline-ai-message-list"
                            aria-live="polite"
                        >
                            {messages.length === 0 ? (
                                <p className="inline-ai-empty-response">{t("Responses will appear here.")}</p>
                            ) : (
                                messages.map((message, index) => {
                                    const isLastMessage = index === messages.length - 1;
                                    const isStreaming =
                                        status === "streaming" && isLastMessage && message.role === "assistant";
                                    const messageCommandAction =
                                        latestCompletedShellCode?.messageId === message.id ? commandAction : null;
                                    return (
                                        <div
                                            key={message.id}
                                            className="inline-ai-rendered-message"
                                            data-message-id={message.id}
                                        >
                                            {renderMessage ? (
                                                renderMessage({
                                                    message,
                                                    isStreaming,
                                                    commandAction: messageCommandAction,
                                                })
                                            ) : (
                                                <>
                                                    <AIMessage
                                                        message={message}
                                                        isStreaming={isStreaming}
                                                        showFeedback={false}
                                                        allowGlobalChatActions={false}
                                                    />
                                                    {messageCommandAction}
                                                </>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    )}
                </div>

                <form className="inline-ai-composer" onSubmit={handleFormSubmit}>
                    <label htmlFor={`${responsesId}-composer`}>{t("Ask AI")}</label>
                    <textarea
                        id={`${responsesId}-composer`}
                        ref={composerRef}
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        placeholder={t(placeholder)}
                        rows={2}
                        autoFocus={autoFocus}
                    />
                    <div className="inline-ai-composer-footer">
                        <span>{t("Enter to send · Shift+Enter for newline · Esc to close")}</span>
                        <div className="inline-ai-composer-actions">
                            {viewState.canCancel && (
                                <button type="button" onClick={() => onCancel(blockId)}>
                                    {t("Stop")}
                                </button>
                            )}
                            {status === "error" && (
                                <button type="button" onClick={() => onRetry(blockId)}>
                                    {t("Retry")}
                                </button>
                            )}
                            <button type="submit" disabled={!viewState.canSubmit || submitPending}>
                                {t("Send")}
                            </button>
                        </div>
                    </div>
                </form>
            </section>
        );
    })
);

InlineAITray.displayName = "InlineAITray";
