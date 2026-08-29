// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { lazyWithRetry } from "@/app/element/lazy-module";
import { tCurrent } from "@/app/i18n/current-i18n";
import type { TermViewModel } from "@/app/view/term/term-model";
import * as React from "react";
import { terminalAIRegistry, type TerminalAISeed } from "./terminal-ai-registry";
import "./tray/inlineai-tray.scss";

export interface TerminalAILoaderState {
    activated: boolean;
    initialSeed: TerminalAISeed | null;
}

export interface TerminalAILoadingKeyEvent {
    key: string;
    code?: string;
    shiftKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
}

export type TerminalAILoadingKeyResult = "close" | "contained";

export function handleTerminalAILoadingKeyDown(
    event: TerminalAILoadingKeyEvent,
    closeAndFocusTerminal: () => void
): TerminalAILoadingKeyResult {
    event.stopPropagation();

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
        closeAndFocusTerminal();
        return "close";
    }
    return "contained";
}

export function createTerminalAILoaderHandle(model: TermViewModel, setState: (state: TerminalAILoaderState) => void) {
    let activated = false;
    let pendingCompletion: TerminalAISeed["completion"] | null = null;
    const activate = (seed?: TerminalAISeed) => {
        model.termRef.current?.terminal?.blur();
        activated = true;
        let ownCompletion: NonNullable<TerminalAISeed["completion"]>;
        const processing = new Promise<void>((resolve, reject) => {
            ownCompletion = { resolve, reject };
            const completion = ownCompletion;
            pendingCompletion = completion;
            setState({ activated: true, initialSeed: { ...seed, completion } });
        });
        return processing.finally(() => {
            if (pendingCompletion === ownCompletion) {
                pendingCompletion = null;
            }
        });
    };
    const close = () => {
        pendingCompletion?.reject(new Error("AI mode was closed before the request was processed"));
        pendingCompletion = null;
        activated = false;
        setState({ activated: false, initialSeed: null });
        model.giveFocus();
    };
    const dispose = () => {
        pendingCompletion?.reject(new Error("Terminal closed before the AI request was processed"));
        pendingCompletion = null;
        activated = false;
    };
    return {
        open: activate,
        toggle: () => {
            if (activated) {
                close();
            } else {
                void activate().catch(() => {});
            }
        },
        close,
        dispose,
        focus: () => {
            if (!activated) {
                void activate().catch(() => {});
            }
        },
    };
}

const LazyTerminalAIController = lazyWithRetry(
    () =>
        import("./terminal-ai-controller").then((module) => ({
            default: module.TerminalAIController,
        })),
    "Terminal AI"
);

export function TerminalAILoadingPlaceholder({
    blockId,
    loadError,
    onClose,
    onRetry,
}: {
    blockId: string;
    loadError?: boolean;
    onClose: () => void;
    onRetry?: () => void;
}) {
    const placeholderRef = React.useRef<HTMLElement>(null);

    React.useEffect(() => {
        placeholderRef.current?.focus();
    }, []);

    return (
        <section
            ref={placeholderRef}
            className="inline-ai-tray"
            data-terminal-ai="true"
            data-terminal-ai-loading="true"
            data-block-id={blockId}
            tabIndex={0}
            role={loadError ? "alert" : "status"}
            aria-live="polite"
            aria-label={loadError ? tCurrent("Unable to load AI mode") : tCurrent("Loading AI mode")}
            onKeyDown={(event) =>
                handleTerminalAILoadingKeyDown(
                    {
                        key: event.key,
                        code: event.code,
                        shiftKey: event.shiftKey,
                        metaKey: event.metaKey,
                        ctrlKey: event.ctrlKey,
                        altKey: event.altKey,
                        preventDefault: () => event.preventDefault(),
                        stopPropagation: () => event.stopPropagation(),
                    },
                    onClose
                )
            }
            onKeyUp={(event) => event.stopPropagation()}
        >
            <header className="inline-ai-tray-header">
                <div className="inline-ai-mode-marker">
                    <span className="inline-ai-mode-dot" aria-hidden="true" />
                    <strong>{tCurrent("AI mode")}</strong>
                    <span className="inline-ai-status">
                        {loadError ? tCurrent("Unable to load") : tCurrent("Loading…")}
                    </span>
                </div>
                <div className="inline-ai-header-actions">
                    {loadError && onRetry && (
                        <button type="button" onClick={onRetry}>
                            {tCurrent("Try again")}
                        </button>
                    )}
                    <button
                        type="button"
                        className="inline-ai-close"
                        onClick={onClose}
                        aria-label={tCurrent("Close AI mode and return to terminal")}
                    >
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
            </header>
        </section>
    );
}

export function TerminalAIControllerLoader({ blockId, model }: { blockId: string; model: TermViewModel }) {
    const [state, setState] = React.useState<TerminalAILoaderState>({ activated: false, initialSeed: null });
    const [loadStatus, setLoadStatus] = React.useState<"loading" | "ready" | "error">("loading");
    const [loadAttempt, setLoadAttempt] = React.useState(0);
    const handle = React.useMemo(() => createTerminalAILoaderHandle(model, setState), [model]);

    React.useEffect(() => {
        const unregister = terminalAIRegistry.register(blockId, handle);
        return () => {
            handle.dispose();
            unregister();
        };
    }, [blockId, handle]);

    React.useEffect(() => {
        if (!state.activated) {
            return;
        }
        let current = true;
        setLoadStatus("loading");
        void LazyTerminalAIController.preload().then(
            () => {
                if (current) {
                    setLoadStatus("ready");
                }
            },
            (error) => {
                if (current) {
                    setLoadStatus("error");
                    state.initialSeed?.completion?.reject(error);
                    setState((loaderState) => ({ ...loaderState, initialSeed: null }));
                }
            }
        );
        return () => {
            current = false;
        };
    }, [loadAttempt, state.activated]);

    if (!state.activated) {
        return null;
    }
    if (loadStatus !== "ready") {
        return (
            <TerminalAILoadingPlaceholder
                blockId={blockId}
                loadError={loadStatus === "error"}
                onClose={handle.close}
                onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
            />
        );
    }
    return <LazyTerminalAIController blockId={blockId} model={model} initialSeed={state.initialSeed ?? undefined} />;
}
