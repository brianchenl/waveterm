// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
    const focusedNodeAtom = Symbol("focused-node");
    const shellIntegrationStatusAtom = Symbol("shell-integration-status");
    return {
        blockId: "basic-terminal",
        focusedNodeAtom,
        shellIntegrationStatusAtom,
        shellIntegrationStatus: "ready" as string | null,
        isMacOS: true,
        blockComponentModel: null as BlockComponentModel | null,
        registerGlobalWebviewKeys: vi.fn(),
    };
});

vi.mock("@/app/store/global", () => ({
    atoms: {
        modalOpen: Symbol("modal-open"),
        staticTabId: Symbol("static-tab-id"),
    },
    createBlock: vi.fn(),
    createBlockSplitHorizontally: vi.fn(),
    createBlockSplitVertically: vi.fn(),
    createTab: vi.fn(),
    getAllBlockComponentModels: () => [],
    getApi: () => ({
        registerGlobalWebviewKeys: harness.registerGlobalWebviewKeys,
    }),
    getBlockComponentModel: () => harness.blockComponentModel,
    getFocusedBlockId: () => harness.blockId,
    getSettingsKeyAtom: () => Symbol("setting"),
    globalStore: {
        get: (atom: unknown) => {
            if (atom === harness.focusedNodeAtom) {
                return { data: { blockId: harness.blockId } };
            }
            if (atom === harness.shellIntegrationStatusAtom) {
                return harness.shellIntegrationStatus;
            }
            return null;
        },
        set: vi.fn(),
    },
    recordTEvent: vi.fn(),
    refocusNode: vi.fn(),
    replaceBlock: vi.fn(),
    WOS: {
        getWaveObjectAtom: vi.fn(),
        makeORef: vi.fn(),
    },
}));

vi.mock("@/app/store/tab-model", () => ({
    getActiveTabModel: vi.fn(),
}));

vi.mock("@/util/platformutil", () => ({
    isMacOS: () => harness.isMacOS,
}));

vi.mock("@/layout/index", () => ({
    deleteLayoutModelForTab: vi.fn(),
    getLayoutModelForStaticTab: () => ({
        focusedNode: harness.focusedNodeAtom,
    }),
    NavigateDirection: {
        Up: "up",
        Down: "down",
        Left: "left",
        Right: "right",
    },
}));

vi.mock("@/app/store/modalmodel", () => ({
    modalsModel: {
        hasOpenModals: () => false,
    },
}));

vi.mock("@/app/store/windowtype", () => ({
    isBuilderWindow: () => false,
    isTabWindow: () => true,
}));

import { appHandleKeyDown, registerGlobalKeys } from "@/app/store/keymodel";
import { setKeyUtilPlatform } from "@/util/keyutil";

function makeTerminalModel(sendDataToController: ReturnType<typeof vi.fn>, basic = true, bufferType = "normal") {
    return {
        viewType: "term",
        enhanceCurrentCommand: (get: (atom: unknown) => unknown) => {
            if (!basic || get(harness.shellIntegrationStatusAtom) !== "ready" || bufferType !== "normal") {
                return false;
            }
            sendDataToController("\x1b[24;2~");
            return true;
        },
    };
}

describe("terminal inline enhancement shortcut", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        harness.shellIntegrationStatus = "ready";
        harness.isMacOS = true;
        setKeyUtilPlatform("darwin");
        vi.stubGlobal("document", {
            activeElement: null,
            querySelector: vi.fn(() => null),
        });
        registerGlobalKeys();
    });

    it("sends F24 only to the focused basic terminal without creating terminal AI UI", () => {
        const sendDataToController = vi.fn();
        harness.blockComponentModel = {
            viewModel: makeTerminalModel(sendDataToController),
        } as unknown as BlockComponentModel;

        const handled = appHandleKeyDown({
            type: "keydown",
            key: "a",
            code: "KeyA",
            cmd: true,
            meta: true,
            shift: true,
        });

        expect(handled).toBe(true);
        expect(sendDataToController).toHaveBeenCalledOnce();
        expect(sendDataToController).toHaveBeenCalledWith("\x1b[24;2~");
        expect(document.querySelector("[data-terminal-ai], textarea, .inlineai-tray")).toBeNull();
    });

    it("uses Ctrl+Shift+A on Windows and Linux", () => {
        harness.isMacOS = false;
        setKeyUtilPlatform("linux");
        registerGlobalKeys();
        const sendDataToController = vi.fn();
        harness.blockComponentModel = {
            viewModel: makeTerminalModel(sendDataToController),
        } as unknown as BlockComponentModel;

        const handled = appHandleKeyDown({
            type: "keydown",
            key: "a",
            code: "KeyA",
            control: true,
            shift: true,
        });

        expect(handled).toBe(true);
        expect(sendDataToController).toHaveBeenCalledWith("\x1b[24;2~");
    });

    it("consumes the shortcut without writing to a non-basic terminal", () => {
        const sendDataToController = vi.fn();
        harness.blockComponentModel = {
            viewModel: makeTerminalModel(sendDataToController, false),
        } as unknown as BlockComponentModel;

        const handled = appHandleKeyDown({
            type: "keydown",
            key: "a",
            code: "KeyA",
            cmd: true,
            meta: true,
            shift: true,
        });

        expect(handled).toBe(true);
        expect(sendDataToController).not.toHaveBeenCalled();
    });

    it("consumes the shortcut without writing when shell integration is not ready", () => {
        const sendDataToController = vi.fn();
        harness.shellIntegrationStatus = "running-command";
        harness.blockComponentModel = {
            viewModel: makeTerminalModel(sendDataToController),
        } as unknown as BlockComponentModel;

        const handled = appHandleKeyDown({
            type: "keydown",
            key: "a",
            code: "KeyA",
            cmd: true,
            meta: true,
            shift: true,
        });

        expect(handled).toBe(true);
        expect(sendDataToController).not.toHaveBeenCalled();
    });

    it("consumes the shortcut without writing while xterm is in the alternate buffer", () => {
        const sendDataToController = vi.fn();
        harness.blockComponentModel = {
            viewModel: makeTerminalModel(sendDataToController, true, "alternate"),
        } as unknown as BlockComponentModel;

        const handled = appHandleKeyDown({
            type: "keydown",
            key: "a",
            code: "KeyA",
            cmd: true,
            meta: true,
            shift: true,
        });

        expect(handled).toBe(true);
        expect(sendDataToController).not.toHaveBeenCalled();
    });
});
