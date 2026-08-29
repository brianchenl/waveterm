// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DefaultWorkspaceColor, getWorkspaceDisplayColor } from "./workspacecolor";

describe("workspace colors", () => {
    it("migrates the legacy green default Wave workspace icon to dark gold", () => {
        expect(getWorkspaceDisplayColor({ icon: "custom@wave-logo-solid", color: "#58C142" })).toBe(
            DefaultWorkspaceColor
        );
    });

    it("preserves a user-selected green color for other workspace icons", () => {
        expect(getWorkspaceDisplayColor({ icon: "star", color: "#58C142" })).toBe("#58C142");
    });

    it("preserves non-legacy Wave workspace colors", () => {
        expect(getWorkspaceDisplayColor({ icon: "custom@wave-logo-solid", color: "#429DFF" })).toBe("#429DFF");
    });
});
