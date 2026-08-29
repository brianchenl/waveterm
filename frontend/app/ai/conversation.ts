// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DefaultChatTransport, type ChatStatus } from "ai";
import { createDataUrl, createImagePreview, normalizeMimeType, resizeImage } from "../aipanel/ai-utils";
import type { WaveUIMessage, WaveUIMessagePart } from "../aipanel/aitypes";

export interface AIConversationFile {
    id: string;
    file: File;
    name: string;
    type: string;
    size: number;
    previewUrl?: string;
}

export interface AIConversationFileAdapter {
    prepare(file: File): Promise<AIConversationFile>;
    encode(attachment: AIConversationFile): Promise<AIMessagePart>;
    release(attachment: AIConversationFile): void;
}

export interface AIConversationRuntimeSnapshot {
    messages: WaveUIMessage[];
    status: ChatStatus;
    error: Error | null;
}

export interface AIConversationRuntimeSend {
    uiParts: WaveUIMessagePart[];
    requestMessage: AIMessage;
}

/** Adapter implemented by the React useChat host, or by an in-memory test runtime. */
export interface AIConversationRuntime {
    getSnapshot(): AIConversationRuntimeSnapshot;
    subscribe(listener: () => void): () => void;
    setMessages(messages: WaveUIMessage[]): void;
    send(message: AIConversationRuntimeSend): Promise<void>;
    stop(): void;
    retry(messageId?: string): Promise<void>;
    clearError(): void;
}

export interface AIConversationConfig {
    /** Stable identity chosen by the owner, normally blockId/chatId or builderId/chatId. */
    key: string;
    endpoint: string;
    runtime?: AIConversationRuntime;
    fileAdapter?: AIConversationFileAdapter;
    stopReloadDelayMs?: number;
    loadHistory(): Promise<WaveUIMessage[]>;
    startNewChat(): Promise<void> | void;
    reloadHistory(): Promise<WaveUIMessage[]>;
    prepareRequestBody(requestMessage: AIMessage | null): Record<string, unknown>;
    approveTools(toolCallIds: string[], approval: string): Promise<void> | void;
}

export interface AIConversationSnapshot {
    key: string;
    messages: WaveUIMessage[];
    status: ChatStatus;
    error: string | null;
    files: AIConversationFile[];
    historyLoaded: boolean;
    isLoadingHistory: boolean;
    isEmpty: boolean;
}

export type AIConversationAction =
    | { type: "load-history" }
    | { type: "attach-files"; files: File[] }
    | { type: "remove-file"; fileId: string }
    | { type: "clear-files" }
    | { type: "stop" }
    | { type: "retry"; messageId?: string }
    | { type: "approve-tools"; toolCallIds: string[]; approval: string }
    | { type: "new-chat" }
    | { type: "report-error"; message: string }
    | { type: "dismiss-error" };

/**
 * Headless conversation Interface. Instances are owner-scoped; the Module keeps no global registry or layout state.
 */
export interface AIConversation {
    getSnapshot(): AIConversationSnapshot;
    subscribe(listener: () => void): () => void;
    send(input: {
        text?: string;
        requestText?: string;
        files?: File[];
        signal?: AbortSignal;
    }): Promise<"sent" | "cleared" | "ignored">;
    act(action: AIConversationAction): Promise<void>;
}

class AIConversationImplementation implements AIConversation {
    private snapshot: AIConversationSnapshot;
    private listeners = new Set<() => void>();
    private runtimeUnsubscribe: (() => void) | null = null;
    private readonly fileAdapter: AIConversationFileAdapter;
    private loadPromise: Promise<void> | null = null;
    private stopPromise: Promise<void> | null = null;
    private requestBodies = new Map<string, Record<string, unknown>>();
    private historyGeneration = 0;

    constructor(
        private readonly config: AIConversationConfig,
        private runtime: AIConversationRuntime | null
    ) {
        this.fileAdapter = config.fileAdapter ?? createBrowserFileAdapter();
        const runtimeSnapshot = runtime?.getSnapshot();
        this.snapshot = {
            key: config.key,
            messages: runtimeSnapshot?.messages ?? [],
            status: runtimeSnapshot?.status ?? "ready",
            error: runtimeSnapshot?.error?.message ?? null,
            files: [],
            historyLoaded: false,
            isLoadingHistory: false,
            isEmpty: (runtimeSnapshot?.messages.length ?? 0) === 0,
        };
        if (runtime) {
            this.subscribeToRuntime(runtime);
        }
    }

    getSnapshot = () => this.snapshot;

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    send = async (input: {
        text?: string;
        requestText?: string;
        files?: File[];
        signal?: AbortSignal;
    }): Promise<"sent" | "cleared" | "ignored"> => {
        if (input.signal?.aborted) {
            return "ignored";
        }

        const text = input.text?.trim() ?? "";
        if (text === "/clear" || text === "/new") {
            await this.act({ type: "new-chat" });
            return "cleared";
        }

        if (this.loadPromise) {
            await this.loadPromise;
        }
        if (input.signal?.aborted) {
            return "ignored";
        }
        if (this.stopPromise) {
            await this.stopPromise;
        }
        if (input.signal?.aborted) {
            return "ignored";
        }

        const newAttachments = input.files?.length ? await this.attachFiles(input.files) : [];
        if (input.signal?.aborted) {
            this.removeFiles(new Set(newAttachments.map((attachment) => attachment.id)));
            return "ignored";
        }

        const files = this.snapshot.files;
        if (
            (!text && files.length === 0) ||
            (this.snapshot.status !== "ready" && this.snapshot.status !== "error") ||
            this.snapshot.isLoadingHistory ||
            !this.runtime
        ) {
            return "ignored";
        }

        const requestParts: AIMessagePart[] = [];
        const uiParts: WaveUIMessagePart[] = [];
        if (text) {
            requestParts.push({ type: "text", text: input.requestText?.trim() || text });
            uiParts.push({ type: "text", text });
        }
        for (const attachment of files) {
            requestParts.push(await this.fileAdapter.encode(attachment));
            if (input.signal?.aborted) {
                this.removeFiles(new Set(newAttachments.map((candidate) => candidate.id)));
                return "ignored";
            }
            uiParts.push({
                type: "data-userfile",
                data: {
                    filename: attachment.name,
                    mimetype: normalizeMimeType(attachment.file),
                    size: attachment.size,
                    previewurl: attachment.previewUrl,
                },
            });
        }

        if (this.stopPromise) {
            await this.stopPromise;
        }
        if (
            input.signal?.aborted ||
            !this.runtime ||
            (this.snapshot.status !== "ready" && this.snapshot.status !== "error")
        ) {
            this.removeFiles(new Set(newAttachments.map((attachment) => attachment.id)));
            return "ignored";
        }

        this.runtime.clearError();
        this.updateSnapshot({ error: null });
        await this.runtime.send({
            uiParts,
            requestMessage: {
                messageid: crypto.randomUUID(),
                parts: requestParts,
            },
        });
        this.clearFiles();
        this.updateSnapshot({ isEmpty: false });
        return "sent";
    };

    act = async (action: AIConversationAction): Promise<void> => {
        if (action.type === "load-history") {
            await this.loadHistory();
        } else if (action.type === "attach-files") {
            await this.attachFiles(action.files);
        } else if (action.type === "remove-file") {
            const file = this.snapshot.files.find((attachment) => attachment.id === action.fileId);
            if (file) {
                this.fileAdapter.release(file);
            }
            this.updateSnapshot({ files: this.snapshot.files.filter((attachment) => attachment.id !== action.fileId) });
        } else if (action.type === "clear-files") {
            this.clearFiles();
        } else if (action.type === "stop") {
            await this.stop();
        } else if (action.type === "retry") {
            this.runtime?.clearError();
            this.updateSnapshot({ error: null });
            await this.runtime?.retry(action.messageId);
        } else if (action.type === "approve-tools") {
            await this.config.approveTools(action.toolCallIds, action.approval);
        } else if (action.type === "new-chat") {
            this.historyGeneration += 1;
            this.loadPromise = null;
            this.requestBodies.clear();
            this.runtime?.stop();
            this.clearFiles();
            this.runtime?.setMessages([]);
            this.updateSnapshot({
                messages: [],
                error: null,
                isEmpty: true,
                historyLoaded: true,
                isLoadingHistory: false,
            });
            await this.config.startNewChat();
        } else if (action.type === "report-error") {
            this.updateSnapshot({ error: action.message });
        } else if (action.type === "dismiss-error") {
            this.runtime?.clearError();
            this.updateSnapshot({ error: null });
        }
    };

    private async stop() {
        if (!this.runtime) {
            return;
        }
        if (this.stopPromise) {
            return this.stopPromise;
        }
        const runtime = this.runtime;
        const stopGeneration = this.historyGeneration;
        const stopPromise = (async () => {
            runtime.stop();
            const delayMs = this.config.stopReloadDelayMs ?? 500;
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            try {
                const messages = await this.config.reloadHistory();
                if (stopGeneration !== this.historyGeneration) {
                    return;
                }
                runtime.setMessages(messages);
                this.updateSnapshot({ messages, isEmpty: messages.length === 0 });
            } catch (error) {
                console.error("Failed to reload chat after stop:", error);
            }
        })();
        this.stopPromise = stopPromise;
        try {
            await stopPromise;
        } finally {
            if (this.stopPromise === stopPromise) {
                this.stopPromise = null;
            }
        }
    }

    private async attachFiles(files: File[]): Promise<AIConversationFile[]> {
        const attachments = await Promise.all(files.map((file) => this.fileAdapter.prepare(file)));
        this.updateSnapshot({ files: [...this.snapshot.files, ...attachments] });
        return attachments;
    }

    private removeFiles(fileIds: ReadonlySet<string>) {
        if (fileIds.size === 0) return;
        const removed = this.snapshot.files.filter((file) => fileIds.has(file.id));
        removed.forEach((file) => this.fileAdapter.release(file));
        this.updateSnapshot({ files: this.snapshot.files.filter((file) => !fileIds.has(file.id)) });
    }

    private clearFiles() {
        this.snapshot.files.forEach((file) => this.fileAdapter.release(file));
        this.updateSnapshot({ files: [] });
    }

    private async loadHistory() {
        if (this.snapshot.historyLoaded) {
            return;
        }
        if (this.loadPromise) {
            return this.loadPromise;
        }
        const historyGeneration = this.historyGeneration;
        this.loadPromise = (async () => {
            this.updateSnapshot({ isLoadingHistory: true });
            try {
                const messages = await this.config.loadHistory();
                if (historyGeneration !== this.historyGeneration) {
                    return;
                }
                this.runtime?.setMessages(messages);
                this.updateSnapshot({
                    messages,
                    historyLoaded: true,
                    isLoadingHistory: false,
                    isEmpty: messages.length === 0,
                });
            } catch (error) {
                if (historyGeneration !== this.historyGeneration) {
                    return;
                }
                console.error("Failed to load chat:", error);
                await this.config.startNewChat();
                this.runtime?.setMessages([]);
                this.updateSnapshot({
                    messages: [],
                    error: "Failed to load chat. Starting new chat...",
                    historyLoaded: true,
                    isLoadingHistory: false,
                    isEmpty: true,
                });
            } finally {
                if (historyGeneration === this.historyGeneration) {
                    this.loadPromise = null;
                }
            }
        })();
        return this.loadPromise;
    }

    private subscribeToRuntime(runtime: AIConversationRuntime) {
        this.runtimeUnsubscribe?.();
        this.runtimeUnsubscribe = runtime.subscribe(() => {
            const runtimeSnapshot = runtime.getSnapshot();
            this.updateSnapshot({
                messages: runtimeSnapshot.messages,
                status: runtimeSnapshot.status,
                error: runtimeSnapshot.error?.message ?? null,
                isEmpty: runtimeSnapshot.messages.length === 0,
            });
        });
    }

    bindRuntime(runtime: AIConversationRuntime): () => void {
        this.runtime = runtime;
        this.subscribeToRuntime(runtime);
        const runtimeSnapshot = runtime.getSnapshot();
        if (this.snapshot.historyLoaded) {
            runtime.setMessages(this.snapshot.messages);
            this.updateSnapshot({
                status: runtimeSnapshot.status,
                error: runtimeSnapshot.error?.message ?? this.snapshot.error,
            });
        } else {
            this.updateSnapshot({
                messages: runtimeSnapshot.messages,
                status: runtimeSnapshot.status,
                error: runtimeSnapshot.error?.message ?? this.snapshot.error,
                isEmpty: runtimeSnapshot.messages.length === 0,
            });
        }
        return () => {
            if (this.runtime !== runtime) {
                return;
            }
            this.runtimeUnsubscribe?.();
            this.runtimeUnsubscribe = null;
            this.runtime = null;
        };
    }

    createTransport(takePendingRequest: () => AIMessage | null): DefaultChatTransport<WaveUIMessage> {
        return new DefaultChatTransport<WaveUIMessage>({
            api: this.config.endpoint,
            prepareSendMessagesRequest: ({ trigger, messages }) => {
                const userMessage = [...messages].reverse().find((message) => message.role === "user");
                if (trigger === "regenerate-message" && userMessage) {
                    const originalBody = this.requestBodies.get(userMessage.id);
                    if (originalBody) {
                        return { body: originalBody };
                    }
                }

                const requestMessage = takePendingRequest();
                const body = this.config.prepareRequestBody(requestMessage);
                if (requestMessage && userMessage) {
                    // Terminal retry is intentionally limited to the latest request. Keeping older
                    // request bodies would retain attachment data URLs for the lifetime of the block.
                    this.requestBodies.clear();
                    this.requestBodies.set(userMessage.id, body);
                }
                return { body };
            },
        });
    }

    private updateSnapshot(update: Partial<AIConversationSnapshot>) {
        this.snapshot = { ...this.snapshot, ...update };
        this.listeners.forEach((listener) => listener());
    }
}

function createBrowserFileAdapter(): AIConversationFileAdapter {
    return {
        prepare: async (file) => {
            const processedFile = await resizeImage(file);
            const attachment: AIConversationFile = {
                id: crypto.randomUUID(),
                file: processedFile,
                name: processedFile.name,
                type: processedFile.type,
                size: processedFile.size,
            };
            if (processedFile.type.startsWith("image/")) {
                attachment.previewUrl = await createImagePreview(processedFile);
            }
            return attachment;
        },
        encode: async (attachment) => ({
            type: "file",
            filename: attachment.name,
            mimetype: normalizeMimeType(attachment.file),
            url: await createDataUrl(attachment.file),
            size: attachment.file.size,
            previewurl: attachment.previewUrl,
        }),
        release: (attachment) => {
            if (attachment.previewUrl?.startsWith("blob:")) {
                URL.revokeObjectURL(attachment.previewUrl);
            }
        },
    };
}

export function createAIConversation(config: AIConversationConfig): AIConversation {
    const conversation = new AIConversationImplementation(config, config.runtime ?? null);
    conversationImplementations.set(conversation, conversation);
    return conversation;
}

const conversationImplementations = new WeakMap<AIConversation, AIConversationImplementation>();

/** @internal Used only by AIConversationHost. */
export function bindAIConversationHostRuntime(
    conversation: AIConversation,
    runtime: AIConversationRuntime
): () => void {
    return getConversationImplementation(conversation).bindRuntime(runtime);
}

/** @internal Used only by AIConversationHost. */
export function createAIConversationChatTransport(
    conversation: AIConversation,
    takePendingRequest: () => AIMessage | null
): DefaultChatTransport<WaveUIMessage> {
    return getConversationImplementation(conversation).createTransport(takePendingRequest);
}

function getConversationImplementation(conversation: AIConversation): AIConversationImplementation {
    const implementation = conversationImplementations.get(conversation);
    if (!implementation) {
        throw new Error("AIConversationHost requires a conversation created by createAIConversation");
    }
    return implementation;
}
