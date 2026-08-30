// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type CmdEditSnapshot = Readonly<{
    text: string;
    cursor: number;
    revision: number;
}>;

export type CmdInputResult = Readonly<{
    submitted: boolean;
    command?: string;
}>;

export type CmdSuggestionRequest = Readonly<{
    command: string;
    cwd: string;
    shell: "cmd";
}>;

const MaxCmdEditLength = 8192;

export class CmdEditBuffer {
    private text = "";
    private cursor = 0;
    private revision = 0;
    private ready = false;
    private valid = false;
    private promptsToSuppress = 0;

    beginPrompt(): void {
        this.text = "";
        this.cursor = 0;
        if (this.promptsToSuppress > 0) {
            this.promptsToSuppress--;
            this.ready = false;
            this.valid = false;
            this.revision++;
            return;
        }
        this.ready = true;
        this.valid = true;
        this.revision++;
    }

    snapshot(): CmdEditSnapshot | null {
        if (!this.ready || !this.valid) {
            return null;
        }
        return { text: this.text, cursor: this.cursor, revision: this.revision };
    }

    async enhance(
        cwd: string,
        suggest: (request: CmdSuggestionRequest) => Promise<string>
    ): Promise<string | null> {
        const snapshot = this.snapshot();
        if (snapshot == null || snapshot.text.trim().length === 0) {
            return null;
        }
        const suggestion = await suggest({ command: snapshot.text, cwd, shell: "cmd" });
        return this.commitSuggestion(snapshot, suggestion);
    }

    handleInput(data: string): CmdInputResult {
        if (!this.ready || !this.valid || data.length === 0) {
            return { submitted: false };
        }

        let submittedCommand: string | undefined;
        let index = 0;
        while (index < data.length && this.ready && this.valid) {
            const escapeSequence = this.readEscapeSequence(data, index);
            if (escapeSequence != null) {
                this.applyEscapeSequence(escapeSequence);
                index += escapeSequence.length;
                continue;
            }
            if (data[index] === "\x1b" && index + 1 < data.length) {
                this.invalidate();
                break;
            }

            const codePoint = data.codePointAt(index);
            if (codePoint == null) {
                break;
            }
            const char = String.fromCodePoint(codePoint);
            index += char.length;

            if (char === "\r" || char === "\n") {
                submittedCommand = this.submit();
                const submittedInput = analyzeSubmittedInput(data.slice(index - char.length));
                this.promptsToSuppress += Math.max(
                    0,
                    submittedInput.lineBreaks - (submittedInput.hasTrailingInput ? 0 : 1)
                );
                continue;
            }
            if (char === "\x7f" || char === "\b") {
                this.backspace();
                continue;
            }
            if (char === "\x01") {
                this.setCursor(0);
                continue;
            }
            if (char === "\x05") {
                this.setCursor(this.text.length);
                continue;
            }
            if (char === "\x03") {
                this.clearLine();
                this.ready = false;
                continue;
            }
            if (char === "\x1b") {
                this.clearLine();
                continue;
            }
            if (codePoint < 0x20 || codePoint === 0x7f) {
                this.invalidate();
                continue;
            }
            this.insert(char);
        }

        return submittedCommand == null
            ? { submitted: false }
            : { submitted: true, command: submittedCommand };
    }

    commitSuggestion(snapshot: CmdEditSnapshot, suggestion: string): string | null {
        if (
            !this.ready ||
            !this.valid ||
            snapshot.revision !== this.revision ||
            snapshot.text !== this.text ||
            snapshot.cursor !== this.cursor ||
            suggestion.length === 0 ||
            suggestion.length > MaxCmdEditLength ||
            /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(suggestion)
        ) {
            return null;
        }

        this.text = suggestion;
        this.cursor = suggestion.length;
        this.revision++;
        return `\x1b${suggestion}`;
    }

    invalidateCurrentPrompt(): void {
        this.invalidate();
    }

    private readEscapeSequence(data: string, index: number): string | null {
        if (data[index] !== "\x1b") {
            return null;
        }
        const knownSequences = [
            "\x1b[3~",
            "\x1b[1~",
            "\x1b[4~",
            "\x1b[A",
            "\x1b[B",
            "\x1b[C",
            "\x1b[D",
            "\x1b[H",
            "\x1b[F",
            "\x1bOA",
            "\x1bOB",
            "\x1bOC",
            "\x1bOD",
            "\x1bOH",
            "\x1bOF",
        ];
        return knownSequences.find((sequence) => data.startsWith(sequence, index)) ?? null;
    }

    private applyEscapeSequence(sequence: string): void {
        switch (sequence) {
            case "\x1b[A":
            case "\x1bOA":
            case "\x1b[B":
            case "\x1bOB":
                this.invalidate();
                break;
            case "\x1b[C":
            case "\x1bOC":
                this.setCursor(Math.min(this.text.length, this.cursor + 1));
                break;
            case "\x1b[D":
            case "\x1bOD":
                this.setCursor(Math.max(0, this.cursor - 1));
                break;
            case "\x1b[H":
            case "\x1b[1~":
            case "\x1bOH":
                this.setCursor(0);
                break;
            case "\x1b[F":
            case "\x1b[4~":
            case "\x1bOF":
                this.setCursor(this.text.length);
                break;
            case "\x1b[3~":
                this.deleteAtCursor();
                break;
            default:
                this.invalidate();
        }
    }

    private insert(value: string): void {
        if (this.text.length + value.length > MaxCmdEditLength) {
            this.invalidate();
            return;
        }
        this.text = this.text.slice(0, this.cursor) + value + this.text.slice(this.cursor);
        this.cursor += value.length;
        this.revision++;
    }

    private backspace(): void {
        if (this.cursor === 0) {
            return;
        }
        const previousCodePoint = this.text.codePointAt(this.cursor - 1);
        const deleteLength = previousCodePoint != null && previousCodePoint >= 0xdc00 && previousCodePoint <= 0xdfff ? 2 : 1;
        const start = Math.max(0, this.cursor - deleteLength);
        this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
        this.cursor = start;
        this.revision++;
    }

    private deleteAtCursor(): void {
        if (this.cursor >= this.text.length) {
            return;
        }
        const codePoint = this.text.codePointAt(this.cursor);
        const deleteLength = codePoint != null && codePoint > 0xffff ? 2 : 1;
        this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + deleteLength);
        this.revision++;
    }

    private setCursor(cursor: number): void {
        if (cursor === this.cursor) {
            return;
        }
        this.cursor = cursor;
        this.revision++;
    }

    private clearLine(): void {
        this.text = "";
        this.cursor = 0;
        this.revision++;
    }

    private submit(): string {
        const command = this.text;
        this.ready = false;
        this.revision++;
        return command;
    }

    private invalidate(): void {
        this.valid = false;
        this.revision++;
    }
}

function analyzeSubmittedInput(data: string): { lineBreaks: number; hasTrailingInput: boolean } {
    let lineBreaks = 0;
    let lastLineBreakEnd = 0;
    for (let index = 0; index < data.length; index++) {
        if (data[index] !== "\r" && data[index] !== "\n") {
            continue;
        }
        lineBreaks++;
        if (data[index] === "\r" && data[index + 1] === "\n") {
            index++;
        }
        lastLineBreakEnd = index + 1;
    }
    return { lineBreaks, hasTrailingInput: lastLineBreakEnd < data.length };
}
