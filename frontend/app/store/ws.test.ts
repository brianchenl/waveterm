// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { MaxQueuedWebSocketBytes, MaxQueuedWebSocketMessages, WSControl } from "./ws";

function makeControl(): WSControl {
    return new WSControl("ws://127.0.0.1:1", "test", () => {});
}

describe("WSControl queue limits", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("bounds the number of messages queued while disconnected", () => {
        vi.useFakeTimers();
        const control = makeControl();
        for (let index = 0; index < MaxQueuedWebSocketMessages + 50; index++) {
            control.pushMessage({ wscommand: "test", index } as any);
        }

        expect(control.msgQueue).toHaveLength(MaxQueuedWebSocketMessages);
        expect(control.msgQueueBytes).toBeLessThanOrEqual(MaxQueuedWebSocketBytes);
        control.shutdown();
    });

    it("rejects an individual message larger than the send limit", () => {
        vi.useFakeTimers();
        const control = makeControl();
        control.pushMessage({ wscommand: "test", payload: "x".repeat(5 * 1024 * 1024 + 1) } as any);

        expect(control.msgQueue).toHaveLength(0);
        expect(control.msgQueueBytes).toBe(0);
        control.shutdown();
    });

    it("shuts down safely before a connection has been created", () => {
        vi.useFakeTimers();
        const control = makeControl();
        control.pushMessage({ wscommand: "test" } as any);

        expect(() => control.shutdown()).not.toThrow();
        expect(control.msgQueue).toHaveLength(0);
        expect(control.msgQueueBytes).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("admits a request or response by evicting an older normal-priority message", () => {
        vi.useFakeTimers();
        const control = makeControl();
        for (let index = 0; index < MaxQueuedWebSocketMessages; index++) {
            control.pushMessage({ wscommand: "test", index } as any);
        }

        control.pushMessage({ wscommand: "rpc", message: { reqid: "critical", command: "test" } } as any);

        expect(control.msgQueue).toHaveLength(MaxQueuedWebSocketMessages);
        expect(control.msgQueue.some((item) => (item.data as any).message?.reqid === "critical")).toBe(true);
        expect(control.getQueueStats().droppedMessages).toBe(1);
        control.shutdown();
    });

    it("exposes cumulative drop statistics", () => {
        vi.useFakeTimers();
        const control = makeControl();
        for (let index = 0; index < MaxQueuedWebSocketMessages + 2; index++) {
            control.pushMessage({ wscommand: "test", index } as any);
        }

        expect(control.getQueueStats()).toMatchObject({
            queuedMessages: MaxQueuedWebSocketMessages,
            droppedMessages: 2,
        });
        expect(control.getQueueStats().droppedBytes).toBeGreaterThan(0);
        control.shutdown();
    });
});
