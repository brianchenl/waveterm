// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CmdEditBuffer } from "./cmd-edit-buffer";

describe("CmdEditBuffer", () => {
    it("sends the current CMD line to AI and returns an edit-only sequence", async () => {
        const buffer = new CmdEditBuffer();
        buffer.beginPrompt();
        buffer.handleInput("查找最新日志");

        const sequence = await buffer.enhance("C:/repo", async (request) => {
            expect(request).toEqual({ command: "查找最新日志", cwd: "C:/repo", shell: "cmd" });
            return "dir /b /o:-d";
        });

        expect(sequence).toBe("\x1bdir /b /o:-d");
        expect(sequence).not.toMatch(/[\r\n]/);
    });

    it("does not replace CMD input edited while AI is responding", async () => {
        const buffer = new CmdEditBuffer();
        buffer.beginPrompt();
        buffer.handleInput("dir");
        let resolveSuggestion: (value: string) => void;
        const suggestion = new Promise<string>((resolve) => {
            resolveSuggestion = resolve;
        });

        const enhancement = buffer.enhance("C:/repo", () => suggestion);
        buffer.handleInput(" /s");
        resolveSuggestion!("dir /b");

        expect(await enhancement).toBeNull();
        expect(buffer.snapshot()).toMatchObject({ text: "dir /s" });
    });

    it("tracks normal editing and replaces the current line without executing it", () => {
        const buffer = new CmdEditBuffer();
        buffer.beginPrompt();
        buffer.handleInput("echo helo");
        buffer.handleInput("\x1b[D");
        buffer.handleInput("l");

        const snapshot = buffer.snapshot();
        expect(snapshot).toMatchObject({ text: "echo hello", cursor: 9 });

        const sequence = buffer.commitSuggestion(snapshot!, "dir /b /o:-d");
        expect(sequence).toBe("\x1bdir /b /o:-d");
        expect(sequence).not.toMatch(/[\r\n]/);
        expect(buffer.snapshot()).toMatchObject({ text: "dir /b /o:-d", cursor: 12 });
    });

    it("refuses to overwrite input that changed while AI was running", () => {
        const buffer = new CmdEditBuffer();
        buffer.beginPrompt();
        buffer.handleInput("dir");
        const snapshot = buffer.snapshot();

        buffer.handleInput(" /s");

        expect(buffer.commitSuggestion(snapshot!, "dir /b")).toBeNull();
        expect(buffer.snapshot()).toMatchObject({ text: "dir /s" });
    });

    it("marks Enter as command submission and disables editing until the next prompt", () => {
        const buffer = new CmdEditBuffer();
        buffer.beginPrompt();
        buffer.handleInput("echo ready");

        expect(buffer.handleInput("\r")).toEqual({ submitted: true, command: "echo ready" });
        expect(buffer.snapshot()).toBeNull();

        buffer.handleInput("ignored while running");
        expect(buffer.snapshot()).toBeNull();

        buffer.beginPrompt();
        expect(buffer.snapshot()).toMatchObject({ text: "", cursor: 0 });
    });

    it("fails closed for CMD history keys because DOSKEY history is external", () => {
        const buffer = new CmdEditBuffer();
        buffer.beginPrompt();
        buffer.handleInput("echo local");
        buffer.handleInput("\x1b[A");

        expect(buffer.snapshot()).toBeNull();
        buffer.beginPrompt();
        expect(buffer.snapshot()).toMatchObject({ text: "", cursor: 0 });
    });

    it("does not resynchronize at a prompt that consumes trailing pasted input", () => {
        const buffer = new CmdEditBuffer();
        buffer.beginPrompt();

        expect(buffer.handleInput("echo one\rpartial")).toEqual({ submitted: true, command: "echo one" });
        buffer.beginPrompt();
        expect(buffer.snapshot()).toBeNull();

        buffer.beginPrompt();
        expect(buffer.snapshot()).toMatchObject({ text: "", cursor: 0 });
    });

    it("can be invalidated when the terminal controller rejects a prepared edit", () => {
        const buffer = new CmdEditBuffer();
        buffer.beginPrompt();
        buffer.handleInput("dir");
        const snapshot = buffer.snapshot();
        expect(buffer.commitSuggestion(snapshot!, "dir /b")).toBe("\x1bdir /b");

        buffer.invalidateCurrentPrompt();

        expect(buffer.snapshot()).toBeNull();
    });

    it("fails closed after an unsupported completion key and recovers at a new prompt", () => {
        const buffer = new CmdEditBuffer();
        buffer.beginPrompt();
        buffer.handleInput("ec");
        buffer.handleInput("\t");
        expect(buffer.snapshot()).toBeNull();

        buffer.beginPrompt();
        buffer.handleInput("中文命令意图");
        expect(buffer.snapshot()).toMatchObject({ text: "中文命令意图", cursor: 6 });
    });

    it("fails closed for an unknown multi-byte escape sequence", () => {
        const buffer = new CmdEditBuffer();
        buffer.beginPrompt();
        buffer.handleInput("echo safe");

        buffer.handleInput("\x1b[99~");

        expect(buffer.snapshot()).toBeNull();
    });

    it("supports Home End Backspace and Delete editing keys", () => {
        const buffer = new CmdEditBuffer();
        buffer.beginPrompt();
        buffer.handleInput("acd");
        buffer.handleInput("\x1b[H");
        buffer.handleInput("b");
        buffer.handleInput("\x1b[F");
        buffer.handleInput("\x7f");
        buffer.handleInput("\x1b[D");
        buffer.handleInput("\x1b[3~");

        expect(buffer.snapshot()).toMatchObject({ text: "ba", cursor: 2 });
    });
});
