import { afterEach, describe, expect, it } from "vitest";

import { adaptFromElectronKeyEvent, checkKeyPressed, setKeyUtilPlatform } from "./keyutil";

function windowsKeyEvent(key: string): WaveKeyboardEvent {
    return adaptFromElectronKeyEvent({
        type: "keyDown",
        key,
        code: `Key${key.toUpperCase()}`,
        meta: true,
    });
}

function controlKeyEvent(key: string): WaveKeyboardEvent {
    return adaptFromElectronKeyEvent({
        type: "keyDown",
        key,
        code: `Key${key.toUpperCase()}`,
        control: true,
    });
}

describe("Windows Meta copy shortcut", () => {
    afterEach(() => setKeyUtilPlatform("darwin"));

    it("matches Windows+C as Meta without treating it as Control", () => {
        setKeyUtilPlatform("win32");
        const event = windowsKeyEvent("c");

        expect(checkKeyPressed(event, "Meta:c")).toBe(true);
        expect(checkKeyPressed(event, "Ctrl:c")).toBe(false);
    });

    it("keeps Ctrl+C distinct so terminals can send the interrupt character", () => {
        setKeyUtilPlatform("win32");
        const event = controlKeyEvent("c");

        expect(checkKeyPressed(event, "Ctrl:c")).toBe(true);
        expect(checkKeyPressed(event, "Meta:c")).toBe(false);
    });
});
