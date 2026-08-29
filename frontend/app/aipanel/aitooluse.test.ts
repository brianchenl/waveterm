// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockModel } from "@/app/block/block-model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAIToolUseHighlight } from "./aitooluse";

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("AI tool-use highlight lifecycle", () => {
    it("clears an active block highlight when the tool-use item unmounts", () => {
        vi.useFakeTimers();
        const timeout = setTimeout(() => undefined, 2_000);
        const highlightTimeoutRef = { current: timeout };
        const highlightedBlockIdRef = { current: "block-1" };
        const setBlockHighlight = vi.spyOn(BlockModel.getInstance(), "setBlockHighlight");

        clearAIToolUseHighlight(highlightTimeoutRef, highlightedBlockIdRef);

        expect(setBlockHighlight).toHaveBeenCalledWith(null);
        expect(highlightTimeoutRef.current).toBeNull();
        expect(highlightedBlockIdRef.current).toBeNull();
    });
});
