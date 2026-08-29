// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getSafeTerminalCommand } from "./terminal-ai-controller";

describe("terminal AI command insertion guard", () => {
    it("normalizes a safe single-line command without executing it", () => {
        expect(getSafeTerminalCommand("  git status --short  ")).toBe("git status --short");
    });

    it("rejects multiline and control-character payloads", () => {
        expect(getSafeTerminalCommand("echo one\necho two")).toBeNull();
        expect(getSafeTerminalCommand("echo\tone")).toBeNull();
        expect(getSafeTerminalCommand("printf '\u001b[31m'")).toBeNull();
    });

    it("rejects an empty command", () => {
        expect(getSafeTerminalCommand("   ")).toBeNull();
    });
});
