// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WebContents, WebPreferences } from "electron";
import { Buffer } from "node:buffer";
import path from "node:path";

const MaxExternalUrlLength = 8 * 1024;
const MaxNativePathLength = 4 * 1024;
const MaxBuilderAppIdLength = 256;
const AllowedExternalProtocols = new Set(["http:", "https:", "mailto:"]);
export const MaxCapturePixels = 16 * 1024 * 1024;
export const MaxSavedTextBytes = 16 * 1024 * 1024;
export const MaxImageDataUrlLength = 35 * 1024 * 1024;

type RectangleLike = { x: number; y: number; width: number; height: number };

export function normalizeBuilderAppId(value: unknown): string | null {
    if (value == null) {
        return "";
    }
    if (typeof value !== "string" || value.length > MaxBuilderAppIdLength || /[\u0000-\u001f\u007f]/.test(value)) {
        return null;
    }
    return value;
}

export function normalizeImageMimeType(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.split(";", 1)[0].trim().toLowerCase();
    if (normalized.length === 0 || /[\u0000-\u001f\u007f]/.test(normalized)) {
        return null;
    }
    return normalized;
}

export function validateExternalUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0 || value.length > MaxExternalUrlLength) {
        return null;
    }
    if (/[\u0000-\u001f\u007f]/.test(value)) {
        return null;
    }
    try {
        const parsed = new URL(value);
        if (!AllowedExternalProtocols.has(parsed.protocol)) {
            return null;
        }
        if (
            (parsed.protocol === "http:" || parsed.protocol === "https:") &&
            (!parsed.hostname || parsed.username || parsed.password)
        ) {
            return null;
        }
        return parsed.href;
    } catch {
        return null;
    }
}

export function validateImageSourceUrl(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    if (value.startsWith("data:")) {
        return value.length <= MaxImageDataUrlLength && /^data:image\//i.test(value) ? value : null;
    }
    const externalUrl = validateExternalUrl(value);
    if (externalUrl == null) {
        return null;
    }
    const protocol = new URL(externalUrl).protocol;
    return protocol === "http:" || protocol === "https:" ? externalUrl : null;
}

export function normalizeNativePath(value: unknown, homeDir: string): string | null {
    if (typeof value !== "string" || value.length === 0 || value.length > MaxNativePathLength || value.includes("\0")) {
        return null;
    }
    let expanded = value;
    if (value === "~") {
        expanded = homeDir;
    } else if (value.startsWith(`~${path.sep}`)) {
        expanded = path.join(homeDir, value.slice(2));
    }
    if (!path.isAbsolute(expanded)) {
        return null;
    }
    return path.normalize(expanded);
}

export function normalizeCaptureRectangle(
    value: unknown,
    bounds: { width: number; height: number }
): RectangleLike | null {
    if (value == null || typeof value !== "object") {
        return null;
    }
    const rect = value as RectangleLike;
    if (![rect.x, rect.y, rect.width, rect.height, bounds.width, bounds.height].every(Number.isFinite)) {
        return null;
    }
    const normalized = {
        x: Math.floor(rect.x),
        y: Math.floor(rect.y),
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
    };
    if (
        normalized.x < 0 ||
        normalized.y < 0 ||
        normalized.width <= 0 ||
        normalized.height <= 0 ||
        normalized.x + normalized.width > bounds.width ||
        normalized.y + normalized.height > bounds.height ||
        normalized.width * normalized.height > MaxCapturePixels
    ) {
        return null;
    }
    return normalized;
}

export function validateSavedTextInput(
    fileName: unknown,
    content: unknown
): { fileName: string; content: string } | null {
    if (
        typeof fileName !== "string" ||
        typeof content !== "string" ||
        Buffer.byteLength(content, "utf8") > MaxSavedTextBytes
    ) {
        return null;
    }
    const normalizedFileName = path.basename(fileName.trim() || "session.log");
    if (
        normalizedFileName.length === 0 ||
        normalizedFileName.length > 255 ||
        /[\u0000-\u001f\u007f]/.test(normalizedFileName)
    ) {
        return null;
    }
    return { fileName: normalizedFileName, content };
}

export function configureWebviewAttachmentSecurity(webContents: WebContents, expectedPreloadPath: string): void {
    const expectedPreload = path.resolve(expectedPreloadPath);
    webContents.on("will-attach-webview", (event, webPreferences: WebPreferences) => {
        const requestedPreload =
            typeof webPreferences.preload === "string" ? path.resolve(webPreferences.preload) : null;
        if (requestedPreload !== expectedPreload) {
            event.preventDefault();
            return;
        }
        webPreferences.preload = expectedPreload;
        webPreferences.nodeIntegration = false;
        webPreferences.nodeIntegrationInSubFrames = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
        webPreferences.webSecurity = true;
        webPreferences.allowRunningInsecureContent = false;
    });
}
