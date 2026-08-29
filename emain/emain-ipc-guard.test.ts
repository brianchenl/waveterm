// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { createSecureIpcRegistrar, isNonWebviewIpcSender } from "./emain-ipc-guard";

function makeFakeIpcMain() {
    const listeners = new Map<string, (...args: any[]) => any>();
    return {
        listeners,
        ipcMain: {
            on: (channel: string, listener: (...args: any[]) => any) => {
                listeners.set(`on:${channel}`, listener);
            },
            removeListener: (channel: string, listener: (...args: any[]) => any) => {
                if (listeners.get(`on:${channel}`) === listener) {
                    listeners.delete(`on:${channel}`);
                }
            },
            handle: (channel: string, listener: (...args: any[]) => any) => {
                listeners.set(`handle:${channel}`, listener);
            },
        },
    };
}

describe("createSecureIpcRegistrar", () => {
    it("runs a send listener only for an authorized sender and valid arguments", () => {
        const { ipcMain, listeners } = makeFakeIpcMain();
        const handler = vi.fn();
        const registrar = createSecureIpcRegistrar(ipcMain as any, (event: any) => event.sender.trusted);
        registrar.on("mutate", handler, (value) => typeof value === "string" && value.length <= 8);
        const listener = listeners.get("on:mutate");

        listener({ sender: { trusted: false } }, "ok");
        listener({ sender: { trusted: true } }, "too-long-value");
        listener({ sender: { trusted: true } }, "ok");

        expect(handler).toHaveBeenCalledOnce();
    });

    it("rejects unauthorized or invalid invoke requests", async () => {
        const { ipcMain, listeners } = makeFakeIpcMain();
        const registrar = createSecureIpcRegistrar(ipcMain as any, (event: any) => event.sender.trusted);
        registrar.handle(
            "read",
            async (_event, value) => `result:${value}`,
            (value) => Number.isSafeInteger(value)
        );
        const listener = listeners.get("handle:read");

        await expect(listener({ sender: { trusted: false } }, 1)).rejects.toThrow("Unauthorized IPC request");
        await expect(listener({ sender: { trusted: true } }, "1")).rejects.toThrow("Invalid IPC arguments");
        await expect(listener({ sender: { trusted: true } }, 1)).resolves.toBe("result:1");
    });

    it("authorizes a one-shot listener with its arguments", () => {
        const { ipcMain, listeners } = makeFakeIpcMain();
        const handler = vi.fn();
        const registrar = createSecureIpcRegistrar(ipcMain as any, (_event, resourceId) => resourceId === "owned");
        registrar.once("response", handler);
        const listener = listeners.get("on:response");

        listener({ sender: {} }, "other");
        listener({ sender: {} }, "owned");

        expect(handler).toHaveBeenCalledOnce();
        expect(listeners.has("on:response")).toBe(false);
    });
});

describe("isNonWebviewIpcSender", () => {
    it("accepts a live app renderer and rejects webviews or destroyed senders", () => {
        const makeEvent = (type: string, destroyed = false) => ({
            sender: { getType: () => type, isDestroyed: () => destroyed },
        });

        expect(isNonWebviewIpcSender(makeEvent("window") as any)).toBe(true);
        expect(isNonWebviewIpcSender(makeEvent("webview") as any)).toBe(false);
        expect(isNonWebviewIpcSender(makeEvent("window", true) as any)).toBe(false);
    });
});
