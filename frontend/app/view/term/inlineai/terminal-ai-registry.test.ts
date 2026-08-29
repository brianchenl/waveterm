// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { TerminalAIRegistry, type TerminalAIHandle } from "./terminal-ai-registry";

function makeHandle(): TerminalAIHandle {
    return {
        open: vi.fn(),
        toggle: vi.fn(),
        close: vi.fn(),
    };
}

describe("TerminalAIRegistry Interface", () => {
    it("routes open and toggle actions only to the requested terminal", async () => {
        const registry = new TerminalAIRegistry();
        const first = makeHandle();
        const second = makeHandle();
        registry.register("block-1", first);
        registry.register("block-2", second);

        await expect(registry.open("block-2", { text: "Explain this" })).resolves.toBe(true);
        expect(registry.toggle("block-1")).toBe(true);
        expect(first.toggle).toHaveBeenCalledOnce();
        expect(first.open).not.toHaveBeenCalled();
        expect(second.open).toHaveBeenCalledWith({ text: "Explain this" });
    });

    it("does not redirect an action when its terminal is unavailable", async () => {
        const registry = new TerminalAIRegistry();
        const available = makeHandle();
        registry.register("block-available", available);

        await expect(registry.open("block-closed")).resolves.toBe(false);
        expect(registry.toggle("block-closed")).toBe(false);
        expect(available.open).not.toHaveBeenCalled();
        expect(available.toggle).not.toHaveBeenCalled();
    });

    it("unregisters only the handle that owns the registration", () => {
        const registry = new TerminalAIRegistry();
        const oldHandle = makeHandle();
        const currentHandle = makeHandle();
        const unregisterOld = registry.register("block-1", oldHandle);
        registry.register("block-1", currentHandle);

        unregisterOld();

        expect(registry.toggle("block-1")).toBe(true);
        expect(currentHandle.toggle).toHaveBeenCalledOnce();
    });

    it("serializes open requests and acknowledges each only after its terminal work completes", async () => {
        const registry = new TerminalAIRegistry();
        const releases: Array<() => void> = [];
        const seen: string[] = [];
        registry.register("block-1", {
            open: async (seed) => {
                seen.push(seed?.text ?? "");
                await new Promise<void>((resolve) => releases.push(resolve));
            },
            toggle: vi.fn(),
            close: vi.fn(),
        });

        const first = registry.open("block-1", { text: "first" });
        const second = registry.open("block-1", { text: "second" });
        await Promise.resolve();
        await Promise.resolve();
        expect(seen).toEqual(["first"]);

        releases.shift()?.();
        await expect(first).resolves.toBe(true);
        await Promise.resolve();
        expect(seen).toEqual(["first", "second"]);
        releases.shift()?.();
        await expect(second).resolves.toBe(true);
    });
});
