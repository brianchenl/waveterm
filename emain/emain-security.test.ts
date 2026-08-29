// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
    configureWebviewAttachmentSecurity,
    MaxCapturePixels,
    MaxImageDataUrlLength,
    MaxSavedTextBytes,
    normalizeBuilderAppId,
    normalizeCaptureRectangle,
    normalizeImageMimeType,
    normalizeNativePath,
    validateExternalUrl,
    validateImageSourceUrl,
    validateSavedTextInput,
} from "./emain-security";

describe("normalizeBuilderAppId", () => {
    it("normalizes an omitted app id and accepts a bounded id", () => {
        expect(normalizeBuilderAppId(null)).toBe("");
        expect(normalizeBuilderAppId("my-app@dev")).toBe("my-app@dev");
    });

    it("rejects malformed or oversized app ids", () => {
        expect(normalizeBuilderAppId("bad\napp")).toBeNull();
        expect(normalizeBuilderAppId("x".repeat(257))).toBeNull();
        expect(normalizeBuilderAppId({})).toBeNull();
    });
});

describe("normalizeImageMimeType", () => {
    it("normalizes case and strips response parameters", () => {
        expect(normalizeImageMimeType(" Image/PNG; charset=binary ")).toBe("image/png");
    });

    it.each([null, "", "image/png\ntext/html"])("rejects an invalid MIME type: %s", (mimeType) => {
        expect(normalizeImageMimeType(mimeType)).toBeNull();
    });
});

describe("validateExternalUrl", () => {
    it.each(["https://waveterm.dev/docs", "http://localhost:8080/path", "mailto:support@waveterm.dev"])(
        "accepts an explicitly allowed URL: %s",
        (url) => expect(validateExternalUrl(url)).not.toBeNull()
    );

    it.each([
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,hello",
        "https://user:password@example.com",
        "https://example.com/\nnext",
        "not-a-url",
    ])("rejects an unsafe URL: %s", (url) => expect(validateExternalUrl(url)).toBeNull());
});

describe("normalizeNativePath", () => {
    it("expands a leading home-directory marker only", () => {
        expect(normalizeNativePath("~/Documents/report.txt", "/Users/tester")).toBe(
            "/Users/tester/Documents/report.txt"
        );
        expect(normalizeNativePath("/tmp/~archive", "/Users/tester")).toBe("/tmp/~archive");
    });

    it.each(["relative/path", "", "bad\0path"])("rejects an invalid native path: %s", (filePath) => {
        expect(normalizeNativePath(filePath, "/Users/tester")).toBeNull();
    });
});

describe("validateImageSourceUrl", () => {
    it.each(["https://example.com/image.png", "http://localhost:8080/image.jpg", "data:image/png;base64,AA=="])(
        "accepts a supported image source: %s",
        (url) => expect(validateImageSourceUrl(url)).not.toBeNull()
    );

    it.each(["file:///tmp/image.png", "mailto:test@example.com", "data:text/html,hello", "javascript:alert(1)"])(
        "rejects an unsafe image source: %s",
        (url) => expect(validateImageSourceUrl(url)).toBeNull()
    );

    it("rejects an oversized image data URL", () => {
        expect(validateImageSourceUrl(`data:image/png;base64,${"A".repeat(MaxImageDataUrlLength)}`)).toBeNull();
    });
});

describe("configureWebviewAttachmentSecurity", () => {
    function captureAttachmentListener() {
        let listener: (...args: any[]) => void;
        const webContents = {
            on: (_eventName: string, nextListener: (...args: any[]) => void) => {
                listener = nextListener;
            },
        };
        configureWebviewAttachmentSecurity(webContents as any, "/app/preload/preload-webview.cjs");
        return () => listener;
    }

    it("locks an approved webview to the hardened preferences", () => {
        const getListener = captureAttachmentListener();
        const event = { preventDefault: vi.fn() };
        const preferences: Record<string, unknown> = {
            preload: "/app/preload/preload-webview.cjs",
            nodeIntegration: true,
            sandbox: false,
        };

        getListener()(event, preferences, {});

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(preferences).toMatchObject({
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
        });
    });

    it("rejects a webview that requests another preload", () => {
        const getListener = captureAttachmentListener();
        const event = { preventDefault: vi.fn() };

        getListener()(event, { preload: "/tmp/untrusted.cjs" }, {});

        expect(event.preventDefault).toHaveBeenCalledOnce();
    });
});

describe("normalizeCaptureRectangle", () => {
    it("normalizes a finite rectangle inside the view", () => {
        expect(
            normalizeCaptureRectangle({ x: 1.8, y: 2.2, width: 100.1, height: 50.1 }, { width: 500, height: 500 })
        ).toEqual({
            x: 1,
            y: 2,
            width: 101,
            height: 51,
        });
    });

    it.each([
        { x: -1, y: 0, width: 10, height: 10 },
        { x: 0, y: 0, width: 0, height: 10 },
        { x: MaxCapturePixels, y: 0, width: 20, height: 10 },
        { x: 0, y: 0, width: MaxCapturePixels + 1, height: 1 },
        { x: Number.NaN, y: 0, width: 10, height: 10 },
    ])("rejects an unsafe rectangle", (rect) => {
        expect(normalizeCaptureRectangle(rect, { width: MaxCapturePixels + 2, height: 100 })).toBeNull();
    });
});

describe("validateSavedTextInput", () => {
    it("strips directory components from the suggested name", () => {
        expect(validateSavedTextInput("../../session.log", "hello")).toEqual({
            fileName: "session.log",
            content: "hello",
        });
    });

    it("rejects oversized or invalid text input", () => {
        expect(validateSavedTextInput("session.log", "x".repeat(MaxSavedTextBytes + 1))).toBeNull();
        expect(validateSavedTextInput("bad\nname.log", "hello")).toBeNull();
        expect(validateSavedTextInput("session.log", null)).toBeNull();
    });
});
