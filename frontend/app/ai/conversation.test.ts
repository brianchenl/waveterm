// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import type { WaveUIMessage } from "../aipanel/aitypes";
import {
    AIConversationFileAdapter,
    AIConversationRuntime,
    AIConversationRuntimeSnapshot,
    createAIConversation,
    createAIConversationChatTransport,
    type AIConversationFile,
    type AIConversationRuntimeSend,
} from "./conversation";

class InMemoryConversationRuntime implements AIConversationRuntime {
    private snapshot: AIConversationRuntimeSnapshot = {
        messages: [],
        status: "ready",
        error: null,
    };
    private listeners = new Set<() => void>();
    sent: AIConversationRuntimeSend[] = [];
    stopCount = 0;
    retries: Array<string | undefined> = [];

    getSnapshot = () => this.snapshot;

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    setMessages = (messages: WaveUIMessage[]) => {
        this.update({ messages });
    };

    send = async (message: AIConversationRuntimeSend) => {
        this.sent.push(message);
    };

    stop = () => {
        this.stopCount += 1;
    };

    retry = async (messageId?: string) => {
        this.retries.push(messageId);
    };

    clearError = () => {
        this.update({ error: null });
    };

    update(update: Partial<AIConversationRuntimeSnapshot>) {
        this.snapshot = { ...this.snapshot, ...update };
        this.listeners.forEach((listener) => listener());
    }
}

function message(id: string, role: "user" | "assistant", text: string): WaveUIMessage {
    return { id, role, parts: [{ type: "text", text }] } as WaveUIMessage;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

const inMemoryFileAdapter: AIConversationFileAdapter = {
    prepare: async (file: File): Promise<AIConversationFile> => ({
        id: `file:${file.name}`,
        file,
        name: file.name,
        type: file.type,
        size: file.size,
    }),
    encode: async (attachment: AIConversationFile) => ({
        type: "file",
        filename: attachment.name,
        mimetype: attachment.type,
        size: attachment.size,
        url: `data:${attachment.type};base64,dGVzdA==`,
    }),
    release: () => {},
};

describe("AI conversation Module Interface", () => {
    it("loads persisted history into an isolated block-scoped conversation", async () => {
        const runtime = new InMemoryConversationRuntime();
        const history = [message("user-1", "user", "where am I?"), message("ai-1", "assistant", "/repo")];
        const conversation = createAIConversation({
            key: "block:block-1/chat:chat-1",
            endpoint: "/api/post-chat-message",
            runtime,
            loadHistory: async () => history,
            startNewChat: async () => {},
            reloadHistory: async () => history,
            prepareRequestBody: (requestMessage) => ({ msg: requestMessage, chatid: "chat-1", blockid: "block-1" }),
            approveTools: async () => {},
        });

        await conversation.act({ type: "load-history" });

        expect(conversation.getSnapshot()).toMatchObject({
            key: "block:block-1/chat:chat-1",
            messages: history,
            historyLoaded: true,
            isLoadingHistory: false,
            isEmpty: false,
        });
    });

    it("waits for the initial history load before submitting a message", async () => {
        const runtime = new InMemoryConversationRuntime();
        const history = deferred<WaveUIMessage[]>();
        const conversation = createAIConversation({
            key: "block:block-loading/chat:chat-loading",
            endpoint: "/api/post-chat-message",
            runtime,
            loadHistory: () => history.promise,
            startNewChat: async () => {},
            reloadHistory: async () => [],
            prepareRequestBody: () => ({}),
            approveTools: async () => {},
        });

        const loading = conversation.act({ type: "load-history" });
        const sending = conversation.send({ text: "do not lose this" });

        await Promise.resolve();
        expect(runtime.sent).toEqual([]);

        history.resolve([]);

        await expect(sending).resolves.toBe("sent");
        await loading;
        expect(runtime.sent[0].uiParts).toEqual([{ type: "text", text: "do not lose this" }]);
    });

    it("does not submit a superseded seed after its pending history load completes", async () => {
        const runtime = new InMemoryConversationRuntime();
        const history = deferred<WaveUIMessage[]>();
        const conversation = createAIConversation({
            key: "block:block-abort/chat:chat-abort",
            endpoint: "/api/post-chat-message",
            runtime,
            loadHistory: () => history.promise,
            startNewChat: async () => {},
            reloadHistory: async () => [],
            prepareRequestBody: () => ({}),
            approveTools: async () => {},
        });
        const abortController = new AbortController();

        const loading = conversation.act({ type: "load-history" });
        const sending = conversation.send({ text: "stale seed", signal: abortController.signal });
        abortController.abort();
        history.resolve([]);

        await loading;
        await expect(sending).resolves.toBe("ignored");
        expect(runtime.sent).toEqual([]);
    });

    it("does not let an old history load overwrite a new chat", async () => {
        const runtime = new InMemoryConversationRuntime();
        const history = deferred<WaveUIMessage[]>();
        let newChatCount = 0;
        const conversation = createAIConversation({
            key: "block:block-new-during-load/chat:chat-new-during-load",
            endpoint: "/api/post-chat-message",
            runtime,
            loadHistory: () => history.promise,
            startNewChat: async () => {
                newChatCount += 1;
            },
            reloadHistory: async () => [],
            prepareRequestBody: () => ({}),
            approveTools: async () => {},
        });

        const loading = conversation.act({ type: "load-history" });
        await conversation.act({ type: "new-chat" });

        history.resolve([message("old-user", "user", "old conversation")]);
        await loading;

        expect(newChatCount).toBe(1);
        expect(runtime.getSnapshot().messages).toEqual([]);
        expect(conversation.getSnapshot()).toMatchObject({ messages: [], historyLoaded: true, isEmpty: true });
    });

    it("sends text and attached files through the existing Wave request shape", async () => {
        const runtime = new InMemoryConversationRuntime();
        const conversation = createAIConversation({
            key: "block:block-2/chat:chat-2",
            endpoint: "/api/post-chat-message",
            runtime,
            fileAdapter: inMemoryFileAdapter,
            loadHistory: async () => [],
            startNewChat: async () => {},
            reloadHistory: async () => [],
            prepareRequestBody: (requestMessage) => ({ msg: requestMessage, chatid: "chat-2", blockid: "block-2" }),
            approveTools: async () => {},
        });
        const file = new File(["hello"], "notes.txt", { type: "text/plain" });

        await conversation.act({ type: "attach-files", files: [file] });
        const result = await conversation.send({ text: "summarize this" });

        expect(result).toBe("sent");
        expect(runtime.sent).toEqual([
            {
                uiParts: [
                    { type: "text", text: "summarize this" },
                    {
                        type: "data-userfile",
                        data: { filename: "notes.txt", mimetype: "text/plain", size: 5, previewurl: undefined },
                    },
                ],
                requestMessage: {
                    messageid: expect.any(String),
                    parts: [
                        { type: "text", text: "summarize this" },
                        {
                            type: "file",
                            filename: "notes.txt",
                            mimetype: "text/plain",
                            size: 5,
                            url: "data:text/plain;base64,dGVzdA==",
                        },
                    ],
                },
            },
        ]);
        expect(conversation.getSnapshot()).toMatchObject({ files: [], isEmpty: false, error: null });
    });

    it("keeps terminal context out of the visible user message", async () => {
        const runtime = new InMemoryConversationRuntime();
        const conversation = createAIConversation({
            key: "block:block-context/chat:chat-context",
            endpoint: "/api/post-chat-message",
            runtime,
            loadHistory: async () => [],
            startNewChat: async () => {},
            reloadHistory: async () => [],
            prepareRequestBody: () => ({}),
            approveTools: async () => {},
        });

        await conversation.send({
            text: "Why did this fail?",
            requestText: "Terminal context: npm test exited 1\n\nQuestion: Why did this fail?",
        });

        expect(runtime.sent[0].uiParts).toEqual([{ type: "text", text: "Why did this fail?" }]);
        expect(runtime.sent[0].requestMessage.parts).toEqual([
            { type: "text", text: "Terminal context: npm test exited 1\n\nQuestion: Why did this fail?" },
        ]);
    });

    it("stops streaming and replaces partial output with persisted history", async () => {
        const runtime = new InMemoryConversationRuntime();
        runtime.update({
            status: "streaming",
            messages: [message("partial", "assistant", "part")],
        });
        const persisted = [message("complete", "assistant", "persisted response")];
        const conversation = createAIConversation({
            key: "block:block-3/chat:chat-3",
            endpoint: "/api/post-chat-message",
            runtime,
            stopReloadDelayMs: 0,
            loadHistory: async () => [],
            startNewChat: async () => {},
            reloadHistory: async () => persisted,
            prepareRequestBody: () => ({}),
            approveTools: async () => {},
        });

        await conversation.act({ type: "stop" });

        expect(runtime.stopCount).toBe(1);
        expect(conversation.getSnapshot().messages).toEqual(persisted);
    });

    it("waits for a stop reload before accepting the next message", async () => {
        const runtime = new InMemoryConversationRuntime();
        runtime.update({
            status: "streaming",
            messages: [message("partial", "assistant", "part")],
        });
        const reloadedHistory = deferred<WaveUIMessage[]>();
        const conversation = createAIConversation({
            key: "block:block-stopping/chat:chat-stopping",
            endpoint: "/api/post-chat-message",
            runtime,
            stopReloadDelayMs: 0,
            loadHistory: async () => [],
            startNewChat: async () => {},
            reloadHistory: () => reloadedHistory.promise,
            prepareRequestBody: () => ({}),
            approveTools: async () => {},
        });

        const stopping = conversation.act({ type: "stop" });
        runtime.update({ status: "ready" });
        const sending = conversation.send({ text: "next request" });

        await Promise.resolve();
        expect(runtime.sent).toEqual([]);

        reloadedHistory.resolve([message("stopped", "assistant", "persisted partial response")]);

        await stopping;
        await expect(sending).resolves.toBe("sent");
        expect(runtime.sent[0].uiParts).toEqual([{ type: "text", text: "next request" }]);
    });

    it("does not let a stopped chat reload overwrite a new chat", async () => {
        const runtime = new InMemoryConversationRuntime();
        runtime.update({
            status: "streaming",
            messages: [message("partial-old", "assistant", "old partial response")],
        });
        const reloadedHistory = deferred<WaveUIMessage[]>();
        const conversation = createAIConversation({
            key: "block:block-stop-new/chat:chat-stop-new",
            endpoint: "/api/post-chat-message",
            runtime,
            stopReloadDelayMs: 0,
            loadHistory: async () => [],
            startNewChat: async () => {},
            reloadHistory: () => reloadedHistory.promise,
            prepareRequestBody: () => ({}),
            approveTools: async () => {},
        });

        const stopping = conversation.act({ type: "stop" });
        await conversation.act({ type: "new-chat" });
        reloadedHistory.resolve([message("old-complete", "assistant", "old persisted response")]);
        await stopping;

        expect(runtime.getSnapshot().messages).toEqual([]);
        expect(conversation.getSnapshot()).toMatchObject({ messages: [], historyLoaded: true, isEmpty: true });
    });

    it("retries an assistant response by message id", async () => {
        const runtime = new InMemoryConversationRuntime();
        const conversation = createAIConversation({
            key: "block:block-4/chat:chat-4",
            endpoint: "/api/post-chat-message",
            runtime,
            loadHistory: async () => [],
            startNewChat: async () => {},
            reloadHistory: async () => [],
            prepareRequestBody: () => ({}),
            approveTools: async () => {},
        });

        await conversation.act({ type: "retry", messageId: "assistant-4" });

        expect(runtime.retries).toEqual(["assistant-4"]);
    });

    it("reuses the original request body when the transport retries a response", async () => {
        const runtime = new InMemoryConversationRuntime();
        const requestMessage: AIMessage = {
            messageid: "user-request-4",
            parts: [{ type: "text", text: "request with original context" }],
        };
        let pendingRequest: AIMessage | null = requestMessage;
        const conversation = createAIConversation({
            key: "block:block-transport/chat:chat-transport",
            endpoint: "/api/post-chat-message",
            runtime,
            loadHistory: async () => [],
            startNewChat: async () => {},
            reloadHistory: async () => [],
            prepareRequestBody: (request) => ({ msg: request, chatid: "chat-transport", aimode: "waveai@quick" }),
            approveTools: async () => {},
        });
        const transport = createAIConversationChatTransport(conversation, () => {
            const request = pendingRequest;
            pendingRequest = null;
            return request;
        });
        const requestBodies: unknown[] = [];
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            requestBodies.push(JSON.parse(String(init?.body)));
            return new Response(new ReadableStream(), { status: 200 });
        });
        vi.stubGlobal("fetch", fetchMock);

        try {
            const userMessage = message("user-ui-4", "user", "visible request");
            await transport.sendMessages({
                trigger: "submit-message",
                chatId: "chat-transport",
                messageId: undefined,
                messages: [userMessage],
                abortSignal: undefined,
            });
            await transport.sendMessages({
                trigger: "regenerate-message",
                chatId: "chat-transport",
                messageId: "assistant-ui-4",
                messages: [userMessage],
                abortSignal: undefined,
            });
        } finally {
            vi.unstubAllGlobals();
        }

        expect(requestBodies).toEqual([
            { msg: requestMessage, chatid: "chat-transport", aimode: "waveai@quick" },
            { msg: requestMessage, chatid: "chat-transport", aimode: "waveai@quick" },
        ]);
    });

    it("approves a tool batch in the owning conversation only", async () => {
        const runtime = new InMemoryConversationRuntime();
        const approvals: Array<{ ids: string[]; approval: string }> = [];
        const conversation = createAIConversation({
            key: "block:block-5/chat:chat-5",
            endpoint: "/api/post-chat-message",
            runtime,
            loadHistory: async () => [],
            startNewChat: async () => {},
            reloadHistory: async () => [],
            prepareRequestBody: () => ({}),
            approveTools: async (ids, approval) => {
                approvals.push({ ids, approval });
            },
        });

        await conversation.act({
            type: "approve-tools",
            toolCallIds: ["tool-1", "tool-2"],
            approval: "user-approved",
        });

        expect(approvals).toEqual([{ ids: ["tool-1", "tool-2"], approval: "user-approved" }]);
    });

    it("starts a new chat without changing another block conversation", async () => {
        const runtimeA = new InMemoryConversationRuntime();
        const runtimeB = new InMemoryConversationRuntime();
        runtimeA.update({ messages: [message("a", "assistant", "A")] });
        runtimeB.update({ messages: [message("b", "assistant", "B")] });
        let newChatCount = 0;
        const makeConversation = (key: string, runtime: InMemoryConversationRuntime, ownsNewChat: boolean) =>
            createAIConversation({
                key,
                endpoint: "/api/post-chat-message",
                runtime,
                loadHistory: async () => runtime.getSnapshot().messages,
                startNewChat: async () => {
                    if (ownsNewChat) newChatCount += 1;
                },
                reloadHistory: async () => runtime.getSnapshot().messages,
                prepareRequestBody: () => ({}),
                approveTools: async () => {},
            });
        const conversationA = makeConversation("block:a/chat:a", runtimeA, true);
        const conversationB = makeConversation("block:b/chat:b", runtimeB, false);

        await conversationA.act({ type: "new-chat" });

        expect(newChatCount).toBe(1);
        expect(conversationA.getSnapshot()).toMatchObject({ messages: [], isEmpty: true });
        expect(conversationB.getSnapshot()).toMatchObject({
            messages: [message("b", "assistant", "B")],
            isEmpty: false,
        });
    });
});
