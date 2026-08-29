// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseWaveSrvStartLine } from "./emain-wavesrv-start";

describe("parseWaveSrvStartLine", () => {
    it("accepts an uppercase build suffix", () => {
        expect(
            parseWaveSrvStartLine(
                "WAVESRV-ESTART ws:127.0.0.1:65347 web:127.0.0.1:65346 version:0.14.5-B001 buildtime:202608161555"
            )
        ).toEqual({
            wsEndpoint: "127.0.0.1:65347",
            webEndpoint: "127.0.0.1:65346",
            version: "0.14.5-B001",
            buildTime: 202608161555,
        });
    });

    it("accepts semver build metadata", () => {
        expect(
            parseWaveSrvStartLine(
                "WAVESRV-ESTART ws:[::1]:65347 web:localhost:65346 version:0.14.5-B001+mac.arm64 buildtime:42"
            )
        ).toMatchObject({
            wsEndpoint: "[::1]:65347",
            version: "0.14.5-B001+mac.arm64",
        });
    });

    it("rejects incomplete startup lines", () => {
        expect(parseWaveSrvStartLine("WAVESRV-ESTART version:0.14.5-B001")).toBeNull();
    });
});
