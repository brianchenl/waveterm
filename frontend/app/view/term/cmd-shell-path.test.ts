// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { normalizeCmdShellPath } from "./cmd-shell-path";

describe("normalizeCmdShellPath", () => {
    it("preserves legal CMD path characters without URL decoding", () => {
        expect(normalizeCmdShellPath(String.raw`C:\work\100%#done`)).toBe("C:/work/100%#done");
        expect(normalizeCmdShellPath(String.raw`\\server\share\100%#done`)).toBe(
            String.raw`\\server\share\100%#done`
        );
    });

    it("rejects non-Windows and control-character paths", () => {
        expect(normalizeCmdShellPath("/tmp/repo")).toBeNull();
        expect(normalizeCmdShellPath("C:\\bad\npath")).toBeNull();
    });
});
