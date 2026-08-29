// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type RendererPerformanceSample = {
    firstRenderMs: number;
    longTaskCount: number;
    longTaskTotalMs: number;
    longestTaskMs: number;
    usedHeapBytes?: number;
};

export type RendererPerformanceBudgets = {
    firstRenderMs: number;
    longTaskTotalMs: number;
    longestTaskMs: number;
    usedHeapBytes: number;
};

export const DefaultRendererPerformanceBudgets: RendererPerformanceBudgets = {
    firstRenderMs: 8_000,
    longTaskTotalMs: 1_500,
    longestTaskMs: 500,
    usedHeapBytes: 256 * 1024 * 1024,
};

export function evaluateRendererPerformance(
    sample: RendererPerformanceSample,
    budgets: RendererPerformanceBudgets = DefaultRendererPerformanceBudgets
): string[] {
    const violations: string[] = [];
    if (sample.firstRenderMs > budgets.firstRenderMs) {
        violations.push(`first render ${sample.firstRenderMs.toFixed(0)}ms > ${budgets.firstRenderMs}ms`);
    }
    if (sample.longTaskTotalMs > budgets.longTaskTotalMs) {
        violations.push(`long tasks ${sample.longTaskTotalMs.toFixed(0)}ms > ${budgets.longTaskTotalMs}ms`);
    }
    if (sample.longestTaskMs > budgets.longestTaskMs) {
        violations.push(`longest task ${sample.longestTaskMs.toFixed(0)}ms > ${budgets.longestTaskMs}ms`);
    }
    if (sample.usedHeapBytes != null && sample.usedHeapBytes > budgets.usedHeapBytes) {
        violations.push(`heap ${sample.usedHeapBytes} bytes > ${budgets.usedHeapBytes} bytes`);
    }
    return violations;
}

type PerformanceWithMemory = Performance & {
    memory?: { usedJSHeapSize?: number };
};

export function startRendererPerformanceMonitor() {
    const longTasks: number[] = [];
    let observer: PerformanceObserver | null = null;
    if (typeof PerformanceObserver !== "undefined") {
        try {
            observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.entryType === "longtask") longTasks.push(entry.duration);
                }
            });
            observer.observe({ type: "longtask", buffered: true });
        } catch {
            observer = null;
        }
    }

    return {
        finish(): RendererPerformanceSample {
            observer?.disconnect();
            const navigation = performance.getEntriesByType("navigation")[0];
            const firstRenderMs = performance.now() - (navigation?.startTime ?? 0);
            const usedHeapBytes = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
            return {
                firstRenderMs,
                longTaskCount: longTasks.length,
                longTaskTotalMs: longTasks.reduce((total, duration) => total + duration, 0),
                longestTaskMs: longTasks.length === 0 ? 0 : Math.max(...longTasks),
                usedHeapBytes: Number.isFinite(usedHeapBytes) ? usedHeapBytes : undefined,
            };
        },
    };
}

export function publishRendererPerformance(sample: RendererPerformanceSample, sendLog: (message: string) => void) {
    const violations = evaluateRendererPerformance(sample);
    const result = { sample, budgets: DefaultRendererPerformanceBudgets, violations };
    (window as any).__waveRendererPerformance = result;
    document.documentElement.dataset.rendererPerformanceBudget = violations.length === 0 ? "pass" : "fail";
    const message = `[renderer-performance] ${JSON.stringify(result)}`;
    if (violations.length === 0) console.info(message);
    else console.error(message);
    try {
        sendLog(message);
    } catch (error) {
        console.error("Failed to publish renderer performance log", error);
    }
}
