// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyWithRetry, scheduleIdlePreload } from "./lazy-module";

afterEach(() => vi.unstubAllGlobals());

describe("lazyWithRetry", () => {
    it("deduplicates successful preload requests", async () => {
        const loader = vi.fn(async () => ({ default: () => null }));
        const LazyComponent = lazyWithRetry(loader, "test module");

        await Promise.all([LazyComponent.preload(), LazyComponent.preload()]);

        expect(loader).toHaveBeenCalledOnce();
    });

    it("allows a failed preload to be retried", async () => {
        const loader = vi
            .fn()
            .mockRejectedValueOnce(new Error("chunk failed"))
            .mockResolvedValueOnce({ default: () => null });
        const LazyComponent = lazyWithRetry(loader, "test module");

        await expect(LazyComponent.preload()).rejects.toThrow("chunk failed");
        await expect(LazyComponent.preload()).resolves.toBeUndefined();
        expect(loader).toHaveBeenCalledTimes(2);
    });
});

describe("scheduleIdlePreload", () => {
    it("preloads on idle and supports cancellation", () => {
        const callbacks = new Map<number, IdleRequestCallback>();
        const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
            callbacks.set(7, callback);
            return 7;
        });
        const cancelIdleCallback = vi.fn();
        vi.stubGlobal("window", { requestIdleCallback, cancelIdleCallback });
        const component = { preload: vi.fn(async () => undefined) };

        const cancel = scheduleIdlePreload(component as any);
        callbacks.get(7)({ didTimeout: false, timeRemaining: () => 10 });
        cancel();

        expect(component.preload).toHaveBeenCalledOnce();
        expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    });
});
