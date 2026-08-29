export type TerminalAIContextSnapshot = {
    version: 1;
    sourceBlockId: string;
    capturedAt: number;
    terminal: {
        connection?: string;
        cwd?: string;
        shell?: string;
    };
    command?: {
        text: string;
        exitCode?: number;
    };
    output: {
        source: "selection" | "last-command" | "recent-output";
        text: string;
        logicalLines: number;
        bytes: number;
        truncated: boolean;
    };
};

export type CaptureTerminalAIContext = (input: {
    blockId: string;
    selection?: string;
}) => Promise<TerminalAIContextSnapshot>;

export type TerminalRuntimeData = {
    terminal: {
        connection?: string;
        cwd?: string;
    };
    rtInfo: ObjRTInfo;
};

export interface TerminalRuntimeAdapter {
    read(blockId: string): Promise<TerminalRuntimeData>;
}

export interface TerminalScrollbackAdapter {
    readLastCommand(blockId: string): Promise<string[] | null>;
    readRecent(blockId: string): Promise<string[]>;
}

export type TerminalAIContextAdapters = {
    runtime: TerminalRuntimeAdapter;
    scrollback: TerminalScrollbackAdapter;
};

const encoder = new TextEncoder();

async function readLastCommandSafely(adapters: TerminalAIContextAdapters, blockId: string): Promise<string[] | null> {
    try {
        return await adapters.scrollback.readLastCommand(blockId);
    } catch {
        return null;
    }
}

async function readRecentSafely(adapters: TerminalAIContextAdapters, blockId: string): Promise<string[]> {
    try {
        return await adapters.scrollback.readRecent(blockId);
    } catch {
        return [];
    }
}

function logicalLineCount(text: string): number {
    if (text.length === 0) {
        return 0;
    }
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function normalizeText(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

function normalizeOptionalText(text: string | undefined): string | undefined {
    if (text == null) {
        return undefined;
    }
    const normalized = normalizeText(text);
    return normalized.length > 0 ? normalized : undefined;
}

function limitLeadingLogicalLines(text: string, maxLines: number): { text: string; truncated: boolean } {
    if (logicalLineCount(text) <= maxLines) {
        return { text, truncated: false };
    }
    return { text: text.split("\n").slice(0, maxLines).join("\n"), truncated: true };
}

function limitTrailingLogicalLines(text: string, maxLines: number): { text: string; truncated: boolean } {
    if (logicalLineCount(text) <= maxLines) {
        return { text, truncated: false };
    }
    return { text: text.split("\n").slice(-maxLines).join("\n"), truncated: true };
}

function limitLeadingBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
    if (encoder.encode(text).byteLength <= maxBytes) {
        return { text, truncated: false };
    }
    let bytes = 0;
    let end = 0;
    for (const character of text) {
        const characterBytes = encoder.encode(character).byteLength;
        if (bytes + characterBytes > maxBytes) {
            break;
        }
        bytes += characterBytes;
        end += character.length;
    }
    const byteLimited = text.slice(0, end);
    const lastLineBreak = byteLimited.lastIndexOf("\n");
    return { text: lastLineBreak >= 0 ? byteLimited.slice(0, lastLineBreak) : byteLimited, truncated: true };
}

function limitTrailingBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
    if (encoder.encode(text).byteLength <= maxBytes) {
        return { text, truncated: false };
    }
    const characters = Array.from(text);
    let bytes = 0;
    let start = characters.length;
    for (let index = characters.length - 1; index >= 0; index--) {
        const characterBytes = encoder.encode(characters[index]).byteLength;
        if (bytes + characterBytes > maxBytes) {
            break;
        }
        bytes += characterBytes;
        start = index;
    }
    const byteLimited = characters.slice(start).join("");
    const firstLineBreak = byteLimited.indexOf("\n");
    return { text: firstLineBreak >= 0 ? byteLimited.slice(firstLineBreak + 1) : byteLimited, truncated: true };
}

function serializedBytes(snapshot: TerminalAIContextSnapshot): number {
    return encoder.encode(JSON.stringify(snapshot)).byteLength;
}

function withOutputText(snapshot: TerminalAIContextSnapshot, text: string): TerminalAIContextSnapshot {
    return {
        ...snapshot,
        output: {
            ...snapshot.output,
            text,
            logicalLines: logicalLineCount(text),
            bytes: encoder.encode(text).byteLength,
            truncated: true,
        },
    };
}

function maximizeFittingPrefix(
    snapshot: TerminalAIContextSnapshot,
    value: string,
    apply: (candidate: TerminalAIContextSnapshot, prefix: string) => TerminalAIContextSnapshot
): TerminalAIContextSnapshot {
    const maxPayloadBytes = 12 * 1024;
    const characters = Array.from(value);
    let low = 0;
    let high = characters.length;
    let best = apply(snapshot, "");

    while (low <= high) {
        const length = Math.floor((low + high) / 2);
        const candidate = apply(snapshot, characters.slice(0, length).join(""));
        if (serializedBytes(candidate) <= maxPayloadBytes) {
            best = candidate;
            low = length + 1;
        } else {
            high = length - 1;
        }
    }
    return best;
}

function fitMetadataToPayload(snapshot: TerminalAIContextSnapshot): TerminalAIContextSnapshot {
    const maxPayloadBytes = 12 * 1024;
    let fitted = snapshot;

    if (serializedBytes(fitted) > maxPayloadBytes && fitted.command?.text) {
        fitted = maximizeFittingPrefix(fitted, fitted.command.text, (candidate, text) => ({
            ...candidate,
            ...(text ? { command: { ...candidate.command, text } } : { command: undefined }),
        }));
    }

    for (const key of ["cwd", "connection", "shell"] as const) {
        const value = fitted.terminal[key];
        if (serializedBytes(fitted) <= maxPayloadBytes || !value) {
            continue;
        }
        fitted = maximizeFittingPrefix(fitted, value, (candidate, text) => {
            const terminal = { ...candidate.terminal };
            if (text) {
                terminal[key] = text;
            } else {
                delete terminal[key];
            }
            return { ...candidate, terminal };
        });
    }

    return fitted;
}

function fitOutputToPayload(snapshot: TerminalAIContextSnapshot): TerminalAIContextSnapshot {
    const maxPayloadBytes = 12 * 1024;
    if (serializedBytes(snapshot) <= maxPayloadBytes) {
        return snapshot;
    }

    const originalText = snapshot.output.text;
    const keepLeading = snapshot.output.source === "selection";
    let low = 0;
    let high = encoder.encode(originalText).byteLength;
    let best = withOutputText(snapshot, "");

    while (low <= high) {
        const byteLimit = Math.floor((low + high) / 2);
        const candidateText = keepLeading
            ? limitLeadingBytes(originalText, byteLimit).text
            : limitTrailingBytes(originalText, byteLimit).text;
        const candidate = withOutputText(snapshot, candidateText);
        if (serializedBytes(candidate) <= maxPayloadBytes) {
            best = candidate;
            low = byteLimit + 1;
        } else {
            high = byteLimit - 1;
        }
    }

    return fitMetadataToPayload(best);
}

export function createTerminalAIContextCapture(adapters: TerminalAIContextAdapters): CaptureTerminalAIContext {
    return async ({ blockId, selection }) => {
        const runtime = await adapters.runtime.read(blockId);
        const connection = normalizeOptionalText(runtime.terminal.connection);
        const cwd = normalizeOptionalText(runtime.terminal.cwd);
        const shell = normalizeOptionalText(runtime.rtInfo["shell:type"]);
        const terminal = {
            ...(connection ? { connection } : {}),
            ...(cwd ? { cwd } : {}),
            ...(shell ? { shell } : {}),
        };
        const hasShellIntegration = runtime.rtInfo["shell:integration"] === true;
        const commandText = hasShellIntegration ? normalizeOptionalText(runtime.rtInfo["shell:lastcmd"]) : undefined;
        const command =
            commandText != null
                ? {
                      text: commandText,
                      ...(runtime.rtInfo["shell:lastcmdexitcode"] != null
                          ? { exitCode: runtime.rtInfo["shell:lastcmdexitcode"] }
                          : {}),
                  }
                : undefined;
        const normalizedSelection = normalizeText(selection ?? "");
        let source: TerminalAIContextSnapshot["output"]["source"] = "selection";
        let text = normalizedSelection;
        if (normalizedSelection.length === 0) {
            const lastCommandOutput = hasShellIntegration ? await readLastCommandSafely(adapters, blockId) : null;
            if (lastCommandOutput != null) {
                source = "last-command";
                text = normalizeText(lastCommandOutput.join("\n"));
            } else {
                source = "recent-output";
                text = normalizeText((await readRecentSafely(adapters, blockId)).join("\n"));
            }
        }
        const limited =
            source === "selection"
                ? limitLeadingLogicalLines(text, 200)
                : source === "last-command"
                  ? limitTrailingLogicalLines(text, 200)
                  : limitTrailingLogicalLines(text, 50);
        const byteLimited =
            source === "selection"
                ? limitLeadingBytes(limited.text, 8 * 1024)
                : limitTrailingBytes(limited.text, 8 * 1024);
        text = byteLimited.text;

        const snapshot: TerminalAIContextSnapshot = {
            version: 1,
            sourceBlockId: blockId,
            capturedAt: Date.now(),
            terminal,
            ...(command ? { command } : {}),
            output: {
                source,
                text,
                logicalLines: logicalLineCount(text),
                bytes: encoder.encode(text).byteLength,
                truncated: limited.truncated || byteLimited.truncated,
            },
        };
        return fitOutputToPayload(snapshot);
    };
}
