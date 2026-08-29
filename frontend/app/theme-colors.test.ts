// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function luminance(hex: string): number {
    const channels = hex
        .slice(1)
        .match(/.{2}/g)!
        .map((value) => Number.parseInt(value, 16) / 255)
        .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
    const first = luminance(foreground);
    const second = luminance(background);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("black gold theme", () => {
    it("uses the shared black and dark-gold palette in SCSS and Tailwind", () => {
        const scss = read("frontend/app/theme.scss");
        const tailwind = read("frontend/tailwindsetup.css");

        for (const source of [scss, tailwind]) {
            expect(source).toContain("#090806");
            expect(source).toContain("#b08a3e");
            expect(source).toContain("#c6a15b");
        }
    });

    it("keeps primary, secondary, and accent text at WCAG AA contrast on the main surface", () => {
        const background = "#090806";
        expect(contrast("#e9e2d0", background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast("#b8ad96", background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast("#b08a3e", background)).toBeGreaterThanOrEqual(4.5);
    });

    it("makes the default terminal theme black gold", () => {
        const themes = JSON.parse(read("pkg/wconfig/defaultconfig/termthemes.json"));
        expect(themes["default-dark"]).toMatchObject({
            "display:name": "Black Gold",
            background: "#050403",
            foreground: "#D9D0BE",
            yellow: "#B08A3E",
            cursor: "#C6A15B",
        });
    });

    it("uses a black application-icon background with transparent outer corners", () => {
        const icon = PNG.sync.read(fs.readFileSync(path.join(process.cwd(), "build/icon.png")));
        const pixel = (x: number, y: number) => {
            const offset = (icon.width * y + x) * 4;
            return Array.from(icon.data.subarray(offset, offset + 4));
        };

        expect(pixel(0, 0)).toEqual([0, 0, 0, 0]);
        expect(pixel(512, 64)).toEqual([0, 0, 0, 255]);
    });
});
