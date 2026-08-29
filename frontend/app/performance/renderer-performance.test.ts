// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { evaluateRendererPerformance, type RendererPerformanceBudgets } from "./renderer-performance";

const budgets: RendererPerformanceBudgets = {
    firstRenderMs: 100,
    longTaskTotalMs: 50,
    longestTaskMs: 30,
    usedHeapBytes: 1000,
};

describe("renderer performance budgets", () => {
    it("accepts a sample within every runtime budget", () => {
        expect(
            evaluateRendererPerformance(
                { firstRenderMs: 90, longTaskCount: 1, longTaskTotalMs: 20, longestTaskMs: 20, usedHeapBytes: 900 },
                budgets
            )
        ).toEqual([]);
    });

    it("reports every exceeded runtime budget", () => {
        const violations = evaluateRendererPerformance(
            { firstRenderMs: 101, longTaskCount: 2, longTaskTotalMs: 51, longestTaskMs: 31, usedHeapBytes: 1001 },
            budgets
        );

        expect(violations).toHaveLength(4);
        expect(violations.join(" ")).toContain("first render");
        expect(violations.join(" ")).toContain("long tasks");
        expect(violations.join(" ")).toContain("heap");
    });
});
