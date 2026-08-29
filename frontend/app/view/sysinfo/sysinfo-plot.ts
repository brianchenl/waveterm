// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { DataItem } from "./sysinfo";

export type PlotPoint = {
    data: DataItem;
    x: number;
    y: number;
};

export type PlotGeometry = {
    areaPath: string;
    linePath: string;
    points: PlotPoint[];
    plotBottom: number;
    plotLeft: number;
    plotRight: number;
    plotTop: number;
    minX: number;
    maxX: number;
};

type PlotGeometryOptions = {
    data: DataItem[];
    yKey: string;
    minY: number;
    maxY: number;
    minX: number;
    maxX: number;
    width: number;
    height: number;
    axes: boolean;
};

const AxisPadding = { top: 8, right: 8, bottom: 22, left: 42 };
const SparklinePadding = { top: 4, right: 4, bottom: 4, left: 4 };

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}

export function buildPlotGeometry(options: PlotGeometryOptions): PlotGeometry {
    const padding = options.axes ? AxisPadding : SparklinePadding;
    const plotLeft = padding.left;
    const plotRight = Math.max(plotLeft + 1, options.width - padding.right);
    const plotTop = padding.top;
    const plotBottom = Math.max(plotTop + 1, options.height - padding.bottom);
    const xRange = Math.max(1, options.maxX - options.minX);
    const yRange = Math.max(Number.EPSILON, options.maxY - options.minY);
    const points: PlotPoint[] = [];

    for (const dataItem of options.data) {
        const value = dataItem?.[options.yKey];
        if (!Number.isFinite(dataItem?.ts) || !Number.isFinite(value)) continue;
        const xRatio = clamp((dataItem.ts - options.minX) / xRange, 0, 1);
        const yRatio = clamp((value - options.minY) / yRange, 0, 1);
        points.push({
            data: dataItem,
            x: plotLeft + xRatio * (plotRight - plotLeft),
            y: plotBottom - yRatio * (plotBottom - plotTop),
        });
    }

    const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
    const areaPath =
        points.length === 0
            ? ""
            : `M${points[0].x},${plotBottom} ${points
                  .map((point) => `L${point.x},${point.y}`)
                  .join(" ")} L${points[points.length - 1].x},${plotBottom} Z`;

    return {
        areaPath,
        linePath,
        points,
        plotBottom,
        plotLeft,
        plotRight,
        plotTop,
        minX: options.minX,
        maxX: options.maxX,
    };
}

export function findClosestPlotPoint(points: PlotPoint[], pointerX: number): PlotPoint | null {
    if (points.length === 0 || !Number.isFinite(pointerX)) return null;
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (points[mid].x < pointerX) low = mid + 1;
        else high = mid;
    }
    if (low === 0) return points[0];
    const previous = points[low - 1];
    const current = points[low];
    return pointerX - previous.x <= current.x - pointerX ? previous : current;
}

export function formatPlotTime(timestamp: number): string {
    const date = new Date(timestamp);
    return [date.getHours(), date.getMinutes(), date.getSeconds()]
        .map((value) => String(value).padStart(2, "0"))
        .join(":");
}
