// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildPlotGeometry, findClosestPlotPoint } from "./sysinfo-plot";

describe("sysinfo plot geometry", () => {
    it("maps finite samples into the bounded plot area", () => {
        const geometry = buildPlotGeometry({
            data: [
                { ts: 1000, cpu: 0 },
                { ts: 2000, cpu: 50 },
                { ts: 3000, cpu: 100 },
                { ts: 4000, cpu: Number.NaN },
            ],
            yKey: "cpu",
            minY: 0,
            maxY: 100,
            minX: 1000,
            maxX: 3000,
            width: 300,
            height: 120,
            axes: true,
        });

        expect(geometry.points).toHaveLength(3);
        expect(geometry.points[0]).toMatchObject({ x: geometry.plotLeft, y: geometry.plotBottom });
        expect(geometry.points[2]).toMatchObject({ x: geometry.plotRight, y: geometry.plotTop });
        expect(geometry.linePath).toContain("M");
        expect(geometry.areaPath).toMatch(/Z$/);
    });

    it("finds the nearest sample without scanning past the data", () => {
        const geometry = buildPlotGeometry({
            data: [
                { ts: 1000, cpu: 10 },
                { ts: 2000, cpu: 20 },
                { ts: 3000, cpu: 30 },
            ],
            yKey: "cpu",
            minY: 0,
            maxY: 100,
            minX: 1000,
            maxX: 3000,
            width: 300,
            height: 120,
            axes: false,
        });

        expect(findClosestPlotPoint(geometry.points, geometry.points[1].x + 1)?.data.ts).toBe(2000);
        expect(findClosestPlotPoint([], 10)).toBeNull();
    });
});
