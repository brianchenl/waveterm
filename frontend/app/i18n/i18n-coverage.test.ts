// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoots = ["emain", "frontend/app"];
const ignoredFiles = new Set(["frontend/app/i18n/i18n.ts"]);
const technicalLabels = new Set([
    "CPU%",
    "GB",
    "Git Bash",
    "MY_SECRET_NAME",
    "NT",
    "PID",
    "SIGTERM",
    "SIGINT",
    "SIGHUP",
    "SIGKILL",
    "SIGUSR1",
    "SIGUSR2",
    "Wave Terminal",
]);

function collectSourceFiles(relativeRoot: string): string[] {
    const absoluteRoot = path.join(process.cwd(), relativeRoot);
    return fs.readdirSync(absoluteRoot, { withFileTypes: true }).flatMap((entry) => {
        const relativePath = path.join(relativeRoot, entry.name);
        if (entry.isDirectory()) return collectSourceFiles(relativePath);
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
        return [relativePath];
    });
}

function findRawEnglishUiStrings(relativePath: string): string[] {
    if (ignoredFiles.has(relativePath)) return [];
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    const patterns = [
        /\b(?:label|title|tooltip|placeholder|message|description):\s*"([A-Z][^"]*[A-Za-z][^"]*)"/g,
        /\b(?:title|aria-label|placeholder)="([A-Z][^"]*[A-Za-z][^"]*)"/g,
    ];
    return patterns.flatMap((pattern) =>
        Array.from(source.matchAll(pattern))
            .map((match) => match[1])
            .filter((message) => !technicalLabels.has(message) && !message.includes("(hidden"))
            .map((message) => `${relativePath}: ${message}`)
    );
}

describe("i18n coverage", () => {
    it("routes user-visible English labels through the translation layer", () => {
        const rawStrings = sourceRoots.flatMap(collectSourceFiles).flatMap(findRawEnglishUiStrings);
        expect(rawStrings, rawStrings.join("\n")).toEqual([]);
    });
});
