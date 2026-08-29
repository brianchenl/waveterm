import { describe, expect, it } from "vitest";

import { createTestCapture } from "./test-adapters";

describe("TerminalAIContext.capture", () => {
    it("captures a terminal selection as the sole output source", async () => {
        const capture = createTestCapture({
            terminal: { connection: "ssh://prod", cwd: "/srv/app" },
            rtInfo: {
                "shell:integration": true,
                "shell:type": "zsh",
                "shell:lastcmd": "npm test",
                "shell:lastcmdexitcode": 1,
            },
            lastCommandOutput: new Error("selection must not read command output"),
            recentOutput: new Error("selection must not read recent output"),
        });

        const snapshot = await capture({ blockId: "block-1", selection: "failure\ndetails" });

        expect(snapshot).toMatchObject({
            version: 1,
            sourceBlockId: "block-1",
            terminal: { connection: "ssh://prod", cwd: "/srv/app", shell: "zsh" },
            command: { text: "npm test", exitCode: 1 },
            output: {
                source: "selection",
                text: "failure\ndetails",
                logicalLines: 2,
                bytes: 15,
                truncated: false,
            },
        });
        expect(snapshot.capturedAt).toEqual(expect.any(Number));
    });

    it("uses last-command output when there is no usable selection", async () => {
        const capture = createTestCapture({
            terminal: {},
            rtInfo: {
                "shell:integration": true,
                "shell:lastcmd": "cargo test",
                "shell:lastcmdexitcode": 101,
            },
            lastCommandOutput: ["running 2 tests", "test result: FAILED"],
            recentOutput: new Error("last-command output must win over recent output"),
        });

        const snapshot = await capture({ blockId: "block-2", selection: "\r\u0000" });

        expect(snapshot.command).toEqual({ text: "cargo test", exitCode: 101 });
        expect(snapshot.output).toEqual({
            source: "last-command",
            text: "running 2 tests\ntest result: FAILED",
            logicalLines: 2,
            bytes: 35,
            truncated: false,
        });
    });

    it("falls back to recent output when shell integration is unavailable", async () => {
        const capture = createTestCapture({
            terminal: { connection: "local", cwd: "/tmp" },
            rtInfo: {
                "shell:integration": false,
                "shell:lastcmd": "must not leak",
                "shell:lastcmdexitcode": 9,
            },
            lastCommandOutput: new Error("last-command output is unavailable without shell integration"),
            recentOutput: ["prompt", "build output", "next prompt"],
        });

        const snapshot = await capture({ blockId: "block-3" });

        expect(snapshot.command).toBeUndefined();
        expect(snapshot.output).toEqual({
            source: "recent-output",
            text: "prompt\nbuild output\nnext prompt",
            logicalLines: 3,
            bytes: 31,
            truncated: false,
        });
    });

    it("normalizes line endings and removes unsafe controls from all captured text", async () => {
        const capture = createTestCapture({
            terminal: { connection: "prod\u0000", cwd: "/srv\r\napp" },
            rtInfo: {
                "shell:integration": true,
                "shell:type": "zsh\u001b",
                "shell:lastcmd": "printf\r\nok\u0000\u0007",
            },
        });

        const snapshot = await capture({
            blockId: "block-4",
            selection: "one\r\ntwo\u0000\u001b\tok\rlast",
        });

        expect(snapshot.terminal).toEqual({ connection: "prod", cwd: "/srv\napp", shell: "zsh" });
        expect(snapshot.command).toEqual({ text: "printf\nok" });
        expect(snapshot.output.text).toBe("one\ntwo\toklast");
        expect(snapshot.output.logicalLines).toBe(2);
    });

    it("limits a selection to 200 logical lines and marks truncation", async () => {
        const capture = createTestCapture({ terminal: {}, rtInfo: {} });
        const selection = Array.from({ length: 201 }, (_, index) => `selected-${index + 1}`).join("\n");

        const snapshot = await capture({ blockId: "block-5", selection });
        const capturedLines = snapshot.output.text.split("\n");

        expect(snapshot.output.source).toBe("selection");
        expect(snapshot.output.logicalLines).toBe(200);
        expect(snapshot.output.truncated).toBe(true);
        expect(capturedLines[0]).toBe("selected-1");
        expect(capturedLines.at(-1)).toBe("selected-200");
    });

    it("keeps the latest 200 logical lines of last-command output", async () => {
        const capture = createTestCapture({
            terminal: {},
            rtInfo: { "shell:integration": true, "shell:lastcmd": "run checks" },
            lastCommandOutput: Array.from({ length: 201 }, (_, index) => `command-${index + 1}`),
        });

        const snapshot = await capture({ blockId: "block-6" });
        const capturedLines = snapshot.output.text.split("\n");

        expect(snapshot.output.logicalLines).toBe(200);
        expect(snapshot.output.truncated).toBe(true);
        expect(capturedLines[0]).toBe("command-2");
        expect(capturedLines.at(-1)).toBe("command-201");
    });

    it("keeps only the latest 50 logical lines of recent output", async () => {
        const capture = createTestCapture({
            terminal: {},
            rtInfo: {},
            recentOutput: Array.from({ length: 51 }, (_, index) => `recent-${index + 1}`),
        });

        const snapshot = await capture({ blockId: "block-7" });
        const capturedLines = snapshot.output.text.split("\n");

        expect(snapshot.output.source).toBe("recent-output");
        expect(snapshot.output.logicalLines).toBe(50);
        expect(snapshot.output.truncated).toBe(true);
        expect(capturedLines[0]).toBe("recent-2");
        expect(capturedLines.at(-1)).toBe("recent-51");
    });

    it("limits an oversized selection to 8 KiB on a UTF-8 boundary", async () => {
        const capture = createTestCapture({ terminal: {}, rtInfo: {} });

        const snapshot = await capture({ blockId: "block-8", selection: "界".repeat(3_000) });

        expect(snapshot.output.bytes).toBe(8_190);
        expect(snapshot.output.text).toBe("界".repeat(2_730));
        expect(snapshot.output.logicalLines).toBe(1);
        expect(snapshot.output.truncated).toBe(true);
    });

    it("keeps the latest 8 KiB of terminal-derived output", async () => {
        const capture = createTestCapture({
            terminal: {},
            rtInfo: { "shell:integration": true },
            lastCommandOutput: [`A${"x".repeat(8_191)}Z`],
        });

        const snapshot = await capture({ blockId: "block-9" });

        expect(snapshot.output.source).toBe("last-command");
        expect(snapshot.output.bytes).toBe(8_192);
        expect(snapshot.output.text).toBe(`${"x".repeat(8_191)}Z`);
        expect(snapshot.output.truncated).toBe(true);
    });

    it("prefers logical-line boundaries when applying the byte limit", async () => {
        const firstLine = "a".repeat(5_000);
        const secondLine = "b".repeat(5_000);
        const selectionCapture = createTestCapture({ terminal: {}, rtInfo: {} });
        const recentCapture = createTestCapture({
            terminal: {},
            rtInfo: {},
            recentOutput: [firstLine, secondLine],
        });

        const selection = await selectionCapture({ blockId: "block-10", selection: `${firstLine}\n${secondLine}` });
        const recent = await recentCapture({ blockId: "block-11" });

        expect(selection.output.text).toBe(firstLine);
        expect(selection.output.logicalLines).toBe(1);
        expect(recent.output.text).toBe(secondLine);
        expect(recent.output.logicalLines).toBe(1);
    });

    it("limits the whole serialized snapshot to 12 KiB", async () => {
        const capture = createTestCapture({
            terminal: { connection: "ssh://production", cwd: "/srv/application" },
            rtInfo: {
                "shell:integration": true,
                "shell:type": "zsh",
                "shell:lastcmd": "c".repeat(8 * 1024),
            },
        });

        const snapshot = await capture({ blockId: "block-12", selection: "o".repeat(8 * 1024) });
        const payloadBytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;

        expect(payloadBytes).toBeLessThanOrEqual(12 * 1024);
        expect(snapshot.output.source).toBe("selection");
        expect(snapshot.output.truncated).toBe(true);
        expect(snapshot.output.bytes).toBeLessThan(8 * 1024);
    });

    it("preserves the payload limit when escaped metadata expands in JSON", async () => {
        const capture = createTestCapture({
            terminal: {},
            rtInfo: {
                "shell:integration": true,
                "shell:lastcmd": '"'.repeat(8 * 1024),
            },
            lastCommandOutput: [],
        });

        const snapshot = await capture({ blockId: "block-13" });
        const payloadBytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;

        expect(payloadBytes).toBeLessThanOrEqual(12 * 1024);
        expect(snapshot.command?.text.length).toBeGreaterThan(0);
        expect(snapshot.command?.text.length).toBeLessThan(8 * 1024);
        expect(snapshot.output.truncated).toBe(true);
    });

    it("returns metadata and an empty output source when scrollback is unavailable", async () => {
        const capture = createTestCapture({
            terminal: { connection: "ssh://prod", cwd: "/srv" },
            rtInfo: { "shell:integration": true, "shell:lastcmd": "deploy" },
            lastCommandOutput: new Error("last-command RPC failed"),
            recentOutput: new Error("recent-output RPC failed"),
        });

        const snapshot = await capture({ blockId: "block-14" });

        expect(snapshot.terminal).toEqual({ connection: "ssh://prod", cwd: "/srv" });
        expect(snapshot.command).toEqual({ text: "deploy" });
        expect(snapshot.output).toEqual({
            source: "recent-output",
            text: "",
            logicalLines: 0,
            bytes: 0,
            truncated: false,
        });
    });
});
