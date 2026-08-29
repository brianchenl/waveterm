import { getBlockMetaKeyAtom, globalStore, WOS } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { TabRpcClient } from "@/app/store/wshrpcutil";

import { TerminalAIContextAdapters } from "./terminal-ai-context";

async function readRTInfo(blockId: string): Promise<ObjRTInfo> {
    try {
        return (
            (await RpcApi.GetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("block", blockId),
            })) ?? {}
        );
    } catch {
        return {};
    }
}

async function readScrollback(
    blockId: string,
    lastCommand: boolean,
    lineEnd: number
): Promise<CommandTermGetScrollbackLinesRtnData> {
    return RpcApi.TermGetScrollbackLinesCommand(
        TabRpcClient,
        {
            linestart: 0,
            lineend: lineEnd,
            lastcommand: lastCommand,
        },
        { route: makeFeBlockRouteId(blockId) }
    );
}

async function readRecentLogicalLines(blockId: string): Promise<string[]> {
    let lineEnd = 50;
    while (true) {
        const result = await readScrollback(blockId, false, lineEnd);
        const lines = result?.lines ?? [];
        const totalLines = result?.totallines ?? 0;
        if (lines.length >= 50 || lineEnd >= totalLines) {
            return lines;
        }
        lineEnd = Math.min(totalLines, lineEnd * 2);
    }
}

export const productionTerminalAIContextAdapters: TerminalAIContextAdapters = {
    runtime: {
        async read(blockId) {
            const connection = globalStore.get(getBlockMetaKeyAtom(blockId, "connection"));
            const cwd = globalStore.get(getBlockMetaKeyAtom(blockId, "cmd:cwd"));
            return {
                terminal: { connection, cwd },
                rtInfo: await readRTInfo(blockId),
            };
        },
    },
    scrollback: {
        async readLastCommand(blockId) {
            return (await readScrollback(blockId, true, 0))?.lines ?? [];
        },
        async readRecent(blockId) {
            return readRecentLogicalLines(blockId);
        },
    },
};
