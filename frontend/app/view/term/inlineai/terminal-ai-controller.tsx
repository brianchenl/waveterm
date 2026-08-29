// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIConversationHost, useAIConversationSnapshot } from "@/app/ai/conversation-host";
import { useTranslation } from "@/app/i18n/use-i18n";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { TermViewModel } from "@/app/view/term/term-model";
import * as React from "react";
import { capture, type TerminalAIContextSnapshot } from "./context";
import {
    createTerminalAIConversation,
    formatTerminalAIRequest,
    getLatestShellCommandCandidate,
} from "./terminal-ai-conversation";
import { terminalAIRegistry, type TerminalAISeed } from "./terminal-ai-registry";
import { InlineAITray, isFillableShellCode, type InlineAITrayHandle } from "./tray";

export function getSafeTerminalCommand(value: string): string | null {
    const command = value.trim();
    return isFillableShellCode(command) ? command : null;
}

export interface TerminalAIControllerProps {
    blockId: string;
    model: TermViewModel;
    initialSeed?: TerminalAISeed;
}

interface PendingSeed {
    id: number;
    value?: TerminalAISeed;
}

function TerminalAIContent({
    blockId,
    model,
    conversation,
    pendingSeed,
    contextIncluded,
    getContextIncluded,
    onContextIncludedChange,
    onClose,
}: TerminalAIControllerProps & {
    conversation: ReturnType<typeof createTerminalAIConversation>;
    pendingSeed: PendingSeed;
    contextIncluded: boolean;
    getContextIncluded: () => boolean;
    onContextIncludedChange: (included: boolean) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const snapshot = useAIConversationSnapshot(conversation);
    const trayRef = React.useRef<InlineAITrayHandle>(null);
    const [terminalContext, setTerminalContext] = React.useState<TerminalAIContextSnapshot | null>(null);
    const [notice, setNotice] = React.useState<string | null>(null);

    const sendPrompt = React.useCallback(
        async (prompt: string, files?: File[]) => {
            setNotice(null);
            const requestText =
                getContextIncluded() && terminalContext ? formatTerminalAIRequest(prompt, terminalContext) : prompt;
            return (await conversation.send({ text: prompt, requestText, files })) !== "ignored";
        },
        [conversation, getContextIncluded, terminalContext]
    );

    React.useEffect(() => {
        let cancelled = false;
        const abortController = new AbortController();
        const completion = pendingSeed.value?.completion;
        const applySeed = async () => {
            const seed = pendingSeed.value;
            setNotice(t("Capturing terminal context…"));
            const selection = seed?.selection ?? model.termRef.current?.terminal.getSelection() ?? undefined;
            const nextContext = await capture({ blockId, selection });
            if (cancelled) {
                return;
            }
            setTerminalContext(nextContext);
            setNotice(null);
            if (seed?.newChat) {
                await conversation.act({ type: "new-chat" });
                if (cancelled) {
                    return;
                }
            }
            const text = seed?.text ?? "";
            if (seed?.submit && (text.trim() || seed.files?.length)) {
                const result = await conversation.send({
                    text,
                    requestText: getContextIncluded() ? formatTerminalAIRequest(text, nextContext) : text,
                    files: seed.files,
                    signal: abortController.signal,
                });
                if (result === "ignored") {
                    throw new Error(t("AI request was not accepted"));
                }
            } else {
                if (text) {
                    trayRef.current?.setInput(text);
                }
                if (seed?.files?.length) {
                    const existingFileIds = new Set(conversation.getSnapshot().files.map((file) => file.id));
                    await conversation.act({ type: "attach-files", files: seed.files });
                    if (cancelled) {
                        const addedFiles = conversation
                            .getSnapshot()
                            .files.filter((file) => !existingFileIds.has(file.id));
                        for (const file of addedFiles) {
                            await conversation.act({ type: "remove-file", fileId: file.id });
                        }
                        return;
                    }
                }
                trayRef.current?.focusComposer();
            }
            if (!cancelled) {
                completion?.resolve();
            }
        };
        void applySeed().catch((error) => {
            if (!cancelled) {
                setNotice(error instanceof Error ? error.message : t("Unable to prepare AI mode"));
                completion?.reject(error);
            }
        });
        return () => {
            cancelled = true;
            abortController.abort();
        };
    }, [getContextIncluded, pendingSeed.id]);

    const insertCommand = React.useCallback(
        async (value: string) => {
            const command = getSafeTerminalCommand(value);
            if (!command) {
                setNotice(t("Only a safe, single-line command can be filled"));
                return;
            }
            try {
                const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                });
                if (rtInfo?.["shell:inputempty"] !== true) {
                    setNotice(t("Clear the command line before filling an AI suggestion"));
                    return;
                }
                await model.sendDataToController(command);
                onClose();
                model.giveFocus();
            } catch (error) {
                setNotice(error instanceof Error ? error.message : t("Unable to fill the command"));
            }
        },
        [blockId, model, onClose, t]
    );

    const latestCommand = React.useMemo(
        () => getLatestShellCommandCandidate(snapshot.messages, snapshot.status),
        [snapshot.messages, snapshot.status]
    );
    const sourceLabel = terminalContext
        ? {
              selection: t("Selected terminal text"),
              "last-command": t("Last command and output"),
              "recent-output": t("Recent terminal output"),
          }[terminalContext.output.source]
        : t("Terminal context");

    return (
        <InlineAITray
            ref={trayRef}
            blockId={blockId}
            context={{
                included: contextIncluded,
                snapshot: terminalContext,
                view: {
                    label: sourceLabel,
                    detail: terminalContext?.terminal.cwd,
                    preview: terminalContext?.output.text.slice(0, 240),
                },
            }}
            messages={snapshot.messages}
            status={snapshot.status}
            latestCompletedShellCode={latestCommand}
            statusText={
                notice ?? (snapshot.isLoadingHistory ? t("Loading conversation…") : snapshot.error) ?? undefined
            }
            onSubmit={({ prompt }) => sendPrompt(prompt)}
            onCancel={() => void conversation.act({ type: "stop" })}
            onRetry={() => void conversation.act({ type: "retry" })}
            onToggleContext={({ included }) => onContextIncludedChange(included)}
            onInsertCommand={({ command }) => void insertCommand(command)}
            onClose={onClose}
            onRequestTerminalFocus={() => model.giveFocus()}
        />
    );
}

export function TerminalAIController({ blockId, model, initialSeed }: TerminalAIControllerProps) {
    const contextIncludedRef = React.useRef(true);
    const conversation = React.useMemo(
        () => createTerminalAIConversation(blockId, { getWidgetAccess: () => contextIncludedRef.current }),
        [blockId]
    );
    const [visible, setVisible] = React.useState(true);
    const [contextIncluded, setContextIncluded] = React.useState(true);
    const [pendingSeed, setPendingSeed] = React.useState<PendingSeed>({ id: 1, value: initialSeed });
    const pendingSeedRef = React.useRef(pendingSeed);
    pendingSeedRef.current = pendingSeed;

    React.useEffect(
        () => () => {
            pendingSeedRef.current.value?.completion?.reject(
                new Error("Terminal closed before the AI request was processed")
            );
        },
        []
    );

    const open = React.useCallback(
        (seed?: TerminalAISeed) =>
            new Promise<void>((resolve, reject) => {
                setPendingSeed((current) => {
                    current.value?.completion?.reject(new Error("AI request was superseded"));
                    return {
                        id: current.id + 1,
                        value: { ...seed, completion: { resolve, reject } },
                    };
                });
                setVisible(true);
            }),
        []
    );
    const close = React.useCallback(() => {
        setPendingSeed((current) => {
            current.value?.completion?.reject(new Error("AI mode was closed before the request was processed"));
            return { id: current.id + 1 };
        });
        setVisible(false);
    }, []);
    const updateContextIncluded = React.useCallback((included: boolean) => {
        contextIncludedRef.current = included;
        setContextIncluded(included);
    }, []);
    const getContextIncluded = React.useCallback(() => contextIncludedRef.current, []);

    React.useEffect(
        () =>
            terminalAIRegistry.register(blockId, {
                open,
                close,
                toggle: () => {
                    if (visible) {
                        close();
                    } else {
                        void open().catch(() => {});
                    }
                },
                focus: () => {
                    if (visible) {
                        document
                            .querySelector<HTMLTextAreaElement>(
                                `[data-terminal-ai][data-block-id="${CSS.escape(blockId)}"] textarea`
                            )
                            ?.focus();
                    } else {
                        void open().catch(() => {});
                    }
                },
            }),
        [blockId, close, open, visible]
    );

    React.useEffect(() => {
        terminalAIRegistry.setOpen(blockId, visible);
        return () => terminalAIRegistry.setOpen(blockId, false);
    }, [blockId, visible]);

    return (
        <AIConversationHost conversation={conversation}>
            {visible && (
                <TerminalAIContent
                    blockId={blockId}
                    model={model}
                    conversation={conversation}
                    pendingSeed={pendingSeed}
                    contextIncluded={contextIncluded}
                    getContextIncluded={getContextIncluded}
                    onContextIncludedChange={updateContextIncluded}
                    onClose={close}
                />
            )}
        </AIConversationHost>
    );
}
