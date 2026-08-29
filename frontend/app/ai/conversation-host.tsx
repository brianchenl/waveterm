// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { WaveUIMessage } from "../aipanel/aitypes";
import {
    bindAIConversationHostRuntime,
    createAIConversationChatTransport,
    type AIConversation,
    type AIConversationRuntime,
    type AIConversationRuntimeSend,
    type AIConversationRuntimeSnapshot,
    type AIConversationSnapshot,
} from "./conversation";

type ChatBinding = Pick<
    UseChatHelpers<WaveUIMessage>,
    "messages" | "status" | "error" | "setMessages" | "sendMessage" | "stop" | "regenerate" | "clearError"
>;

class ReactChatRuntimeAdapter implements AIConversationRuntime {
    private snapshot: AIConversationRuntimeSnapshot = { messages: [], status: "ready", error: null };
    private binding: ChatBinding | null = null;
    private pendingRequest: AIMessage | null = null;
    private listeners = new Set<() => void>();

    getSnapshot = () => this.snapshot;

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    update(binding: ChatBinding) {
        this.binding = binding;
        this.snapshot = {
            messages: binding.messages,
            status: binding.status,
            error: binding.error ?? null,
        };
        this.listeners.forEach((listener) => listener());
    }

    setMessages = (messages: WaveUIMessage[]) => {
        this.binding?.setMessages(messages);
    };

    send = async ({ uiParts, requestMessage }: AIConversationRuntimeSend) => {
        if (!this.binding) {
            return;
        }
        this.pendingRequest = requestMessage;
        try {
            await this.binding.sendMessage({ parts: uiParts });
        } finally {
            this.pendingRequest = null;
        }
    };

    stop = () => {
        this.binding?.stop();
    };

    retry = async (messageId?: string) => {
        if (!this.binding) {
            return;
        }
        this.pendingRequest = null;
        await this.binding.regenerate({ messageId });
    };

    clearError = () => {
        this.binding?.clearError();
    };

    takePendingRequest = (): AIMessage | null => {
        const request = this.pendingRequest;
        this.pendingRequest = null;
        return request;
    };
}

const AIConversationContext = createContext<AIConversation | null>(null);

export interface AIConversationHostProps {
    conversation: AIConversation;
    children?: React.ReactNode;
}

/** Headless React Adapter that owns useChat for exactly one conversation instance. */
export function AIConversationHost({ conversation, children }: AIConversationHostProps) {
    const runtime = useMemo(() => new ReactChatRuntimeAdapter(), [conversation]);
    const transport = useMemo(
        () => createAIConversationChatTransport(conversation, runtime.takePendingRequest),
        [conversation, runtime]
    );
    const chat = useChat<WaveUIMessage>({
        id: conversation.getSnapshot().key,
        transport,
        onError: (error) => {
            void conversation.act({ type: "report-error", message: error.message || "An error occurred" });
        },
    });

    useLayoutEffect(() => {
        runtime.update(chat);
    }, [
        chat.messages,
        chat.status,
        chat.error,
        chat.setMessages,
        chat.sendMessage,
        chat.stop,
        chat.regenerate,
        chat.clearError,
    ]);

    useEffect(() => {
        const unbind = bindAIConversationHostRuntime(conversation, runtime);
        void conversation.act({ type: "load-history" });
        return unbind;
    }, [conversation, runtime]);

    return <AIConversationContext.Provider value={conversation}>{children}</AIConversationContext.Provider>;
}

export function useAIConversation(): AIConversation {
    const conversation = useContext(AIConversationContext);
    if (!conversation) {
        throw new Error("useAIConversation must be used within an AIConversationHost");
    }
    return conversation;
}

export function useAIConversationSnapshot(conversation?: AIConversation): AIConversationSnapshot {
    const contextConversation = useContext(AIConversationContext);
    const selectedConversation = conversation ?? contextConversation;
    if (!selectedConversation) {
        throw new Error("useAIConversationSnapshot requires a conversation or AIConversationHost");
    }
    return useSyncExternalStore(
        selectedConversation.subscribe,
        selectedConversation.getSnapshot,
        selectedConversation.getSnapshot
    );
}
