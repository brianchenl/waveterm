import { createTerminalAIContextCapture, TerminalAIContextAdapters, TerminalRuntimeData } from "./terminal-ai-context";

type TestOutput = string[] | null | Error;

export type TestTerminalAIContextData = TerminalRuntimeData & {
    lastCommandOutput?: TestOutput;
    recentOutput?: Exclude<TestOutput, null>;
};

function resolveOutput(value: TestOutput | undefined, fallback: string[] | null): string[] | null {
    if (value instanceof Error) {
        throw value;
    }
    return value === undefined ? fallback : value;
}

export function createTestCapture(data: TestTerminalAIContextData) {
    const adapters: TerminalAIContextAdapters = {
        runtime: {
            async read() {
                return { terminal: data.terminal, rtInfo: data.rtInfo };
            },
        },
        scrollback: {
            async readLastCommand() {
                return resolveOutput(data.lastCommandOutput, null);
            },
            async readRecent() {
                return resolveOutput(data.recentOutput, []) ?? [];
            },
        },
    };

    return createTerminalAIContextCapture(adapters);
}
