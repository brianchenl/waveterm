// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelAIPanelFocusRequest, registerAIPanelFocusHandler, requestAIPanelFocus } from "./aipanel-focus";

afterEach(() => cancelAIPanelFocusRequest());

describe("AI panel focus requests", () => {
    it("delivers a pending request when the lazy panel registers", () => {
        const focus = vi.fn();
        requestAIPanelFocus();
        const unregister = registerAIPanelFocusHandler(focus);
        expect(focus).toHaveBeenCalledOnce();
        unregister();
    });

    it("does not deliver a cancelled pending request", () => {
        const focus = vi.fn();
        requestAIPanelFocus();
        cancelAIPanelFocusRequest();
        const unregister = registerAIPanelFocusHandler(focus);
        expect(focus).not.toHaveBeenCalled();
        unregister();
    });
});
