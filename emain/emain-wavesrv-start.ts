// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type WaveSrvStartParams = {
    wsEndpoint: string;
    webEndpoint: string;
    version: string;
    buildTime: number;
};

export function parseWaveSrvStartLine(line: string): WaveSrvStartParams | null {
    const match = /^WAVESRV-ESTART ws:(\S+) web:(\S+) version:(\S+) buildtime:(\d+)\s*$/.exec(line.trim());
    if (match == null) {
        return null;
    }
    return {
        wsEndpoint: match[1],
        webEndpoint: match[2],
        version: match[3],
        buildTime: Number.parseInt(match[4], 10),
    };
}
