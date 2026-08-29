// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import { FastAverageColor } from "fast-average-color";
import fs from "fs";
import * as child_process from "node:child_process";
import * as path from "path";
import { PNG } from "pngjs";
import { Readable } from "stream";
import { RpcApi } from "../frontend/app/store/wshclientapi";
import { getWebServerEndpoint, WebServerEndpointVarName, WSServerEndpointVarName } from "../frontend/util/endpoints";
import { WaveDevVarName, WaveDevViteVarName } from "../frontend/util/isdev";
import * as keyutil from "../frontend/util/keyutil";
import { fireAndForget, parseDataUrl } from "../frontend/util/util";
import {
    incrementTermCommandsDurable,
    incrementTermCommandsRemote,
    incrementTermCommandsRun,
    incrementTermCommandsWsl,
    setWasActive,
} from "./emain-activity";
import { createBuilderWindow, getAllBuilderWindows, getBuilderWindowByWebContentsId } from "./emain-builder";
import { tMain } from "./emain-i18n";
import { createSecureIpcRegistrar } from "./emain-ipc-guard";
import { callWithOriginalXdgCurrentDesktopAsync, unamePlatform } from "./emain-platform";
import {
    normalizeBuilderAppId,
    normalizeCaptureRectangle,
    normalizeImageMimeType,
    normalizeNativePath,
    validateExternalUrl,
    validateImageSourceUrl,
    validateSavedTextInput,
} from "./emain-security";
import { getWaveTabViewByWebContentsId } from "./emain-tabview";
import { handleCtrlShiftState } from "./emain-util";
import { getWaveVersion } from "./emain-wavesrv";
import { createNewWaveWindow, getWaveWindowByWebContentsId } from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";

const electronApp = electron.app;
const MaxSavedImageBytes = 25 * 1024 * 1024;
const MaxRegisteredWebviewKeys = 100;
const MaxRegisteredWebviewKeyLength = 100;
const MaxFrontendLogLength = 16 * 1024;

const RendererEnvAllowlist = new Set([
    WebServerEndpointVarName,
    WSServerEndpointVarName,
    WaveDevVarName,
    WaveDevViteVarName,
]);

function getOwnerWindowForSender(sender: electron.WebContents): electron.BaseWindow | null {
    if (sender == null || sender.isDestroyed()) {
        return null;
    }
    return (
        getWaveWindowByWebContentsId(sender?.id) ??
        getBuilderWindowByWebContentsId(sender?.id) ??
        electron.BrowserWindow.fromWebContents(sender) ??
        null
    );
}

function isTrustedAppRenderer(sender: electron.WebContents): boolean {
    if (sender == null || sender.isDestroyed() || sender.getType() === "webview") {
        return false;
    }
    return getWaveTabViewByWebContentsId(sender.id) != null || getOwnerWindowForSender(sender) != null;
}

let webviewFocusId: number = null;
let webviewKeys: string[] = [];

export function openBuilderWindow(appId?: string) {
    const normalizedAppId = normalizeBuilderAppId(appId);
    if (normalizedAppId == null) {
        return;
    }
    const existingBuilderWindows = getAllBuilderWindows();
    const existingWindow = existingBuilderWindows.find((win) => win.builderAppId === normalizedAppId);
    if (existingWindow) {
        existingWindow.focus();
        return;
    }
    fireAndForget(() => createBuilderWindow(normalizedAppId));
}

type UrlInSessionResult = {
    stream: Readable;
    mimeType: string;
    fileName: string;
};

function getSingleHeaderVal(headers: Record<string, string | string[]>, key: string): string {
    const val = headers[key];
    if (val == null) {
        return null;
    }
    if (Array.isArray(val)) {
        return val[0];
    }
    return val;
}

function getFileNameFromUrl(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const filename = pathname.substring(pathname.lastIndexOf("/") + 1);
        return filename;
    } catch (e) {
        return null;
    }
}

function getUrlInSession(session: Electron.Session, url: string): Promise<UrlInSessionResult> {
    return new Promise((resolve, reject) => {
        const validatedUrl = validateImageSourceUrl(url);
        if (validatedUrl == null) {
            reject(new Error("unsupported image URL"));
            return;
        }
        url = validatedUrl;
        if (url.startsWith("data:")) {
            try {
                const parsed = parseDataUrl(url);
                const buffer = Buffer.from(parsed.buffer);
                const mimeType = normalizeImageMimeType(parsed.mimeType);
                if (!mimeType?.startsWith("image/") || buffer.byteLength > MaxSavedImageBytes) {
                    reject(new Error("image data is invalid or too large"));
                    return;
                }
                const readable = Readable.from(buffer);
                resolve({ stream: readable, mimeType, fileName: "image" });
            } catch (err) {
                return reject(err);
            }
            return;
        }
        const request = electron.net.request({
            url,
            method: "GET",
            session,
        });
        request.on("response", (response) => {
            let settled = false;
            const statusCode = response.statusCode;
            if (statusCode < 200 || statusCode >= 300) {
                request.abort();
                reject(new Error(`HTTP request failed with status ${statusCode}: ${response.statusMessage || ""}`));
                return;
            }

            const mimeType = normalizeImageMimeType(getSingleHeaderVal(response.headers, "content-type"));
            if (mimeType == null || !mimeType.startsWith("image/")) {
                request.abort();
                reject(new Error(`unsupported image MIME type: ${mimeType || "missing"}`));
                return;
            }
            const contentLength = Number(getSingleHeaderVal(response.headers, "content-length"));
            if (Number.isFinite(contentLength) && contentLength > MaxSavedImageBytes) {
                request.abort();
                reject(new Error("image response is too large"));
                return;
            }
            const fileName = getFileNameFromUrl(url) || "image";
            const chunks: Buffer[] = [];
            let receivedBytes = 0;
            response.on("data", (chunk) => {
                if (settled) return;
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                receivedBytes += buffer.byteLength;
                if (receivedBytes > MaxSavedImageBytes) {
                    settled = true;
                    request.abort();
                    reject(new Error("image response is too large"));
                    return;
                }
                chunks.push(buffer);
            });
            response.on("end", () => {
                if (settled) return;
                settled = true;
                resolve({ stream: Readable.from(Buffer.concat(chunks, receivedBytes)), mimeType, fileName });
            });
            response.on("error", (err) => {
                if (settled) return;
                settled = true;
                reject(err);
            });
        });
        request.on("error", (err) => {
            reject(err);
        });
        request.end();
    });
}

function saveImageFileWithNativeDialog(
    sender: electron.WebContents,
    defaultFileName: string,
    mimeType: string,
    readStream: Readable
) {
    if (defaultFileName == null || defaultFileName == "") {
        defaultFileName = "image";
    }
    const ww = getOwnerWindowForSender(sender);
    if (ww == null) {
        readStream.destroy();
        return;
    }
    const mimeToExtension: { [key: string]: string } = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/bmp": "bmp",
        "image/tiff": "tiff",
        "image/heic": "heic",
        "image/svg+xml": "svg",
    };
    function addExtensionIfNeeded(fileName: string, mimeType: string): string {
        const extension = mimeToExtension[mimeType];
        if (!path.extname(fileName) && extension) {
            return `${fileName}.${extension}`;
        }
        return fileName;
    }
    defaultFileName = addExtensionIfNeeded(defaultFileName, mimeType);
    electron.dialog
        .showSaveDialog(ww, {
            title: tMain("Save Image"),
            defaultPath: defaultFileName,
            filters: [
                {
                    name: tMain("Images"),
                    extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "heic"],
                },
            ],
        })
        .then((file) => {
            if (file.canceled) {
                readStream.destroy();
                return;
            }
            const writeStream = fs.createWriteStream(file.filePath);
            readStream.pipe(writeStream);
            writeStream.on("finish", () => {
                console.log("saved file", file.filePath);
            });
            writeStream.on("error", (err) => {
                console.log("error saving file (writeStream)", err);
                readStream.destroy();
            });
            readStream.on("error", (err) => {
                console.error("error saving file (readStream)", err);
                writeStream.destroy();
            });
        })
        .catch((err) => {
            console.log("error trying to save file", err);
        });
}

export function initIpcHandlers() {
    const secureIpc = createSecureIpcRegistrar(electron.ipcMain, (event) => isTrustedAppRenderer(event.sender));

    secureIpc.on("open-external", (event, url) => {
        const externalUrl = validateExternalUrl(url);
        if (externalUrl) {
            fireAndForget(() =>
                callWithOriginalXdgCurrentDesktopAsync(() =>
                    electron.shell.openExternal(externalUrl).catch((err) => {
                        console.error(`Failed to open URL ${externalUrl}:`, err);
                    })
                )
            );
        } else {
            console.error("Invalid URL received in open-external event:", url);
        }
    });

    electron.ipcMain.on("webview-image-contextmenu", (event: electron.IpcMainEvent, payload: { src: string }) => {
        const menu = new electron.Menu();
        const hostWebContents = event.sender.hostWebContents;
        const win = getWaveWindowByWebContentsId(hostWebContents?.id);
        const imageUrl = validateImageSourceUrl(payload?.src);
        if (win == null || event.sender.getType() !== "webview" || imageUrl == null) {
            return;
        }
        menu.append(
            new electron.MenuItem({
                label: tMain("Save Image"),
                click: () => {
                    const resultP = getUrlInSession(event.sender.session, imageUrl);
                    resultP
                        .then((result) => {
                            saveImageFileWithNativeDialog(
                                hostWebContents,
                                result.fileName,
                                result.mimeType,
                                result.stream
                            );
                        })
                        .catch((e) => {
                            console.log("error getting image", e);
                        });
                },
            })
        );
        menu.popup();
    });

    electron.ipcMain.on("webview-mouse-navigate", (event: electron.IpcMainEvent, direction: string) => {
        if (
            event.sender.getType() !== "webview" ||
            !isTrustedAppRenderer(event.sender.hostWebContents) ||
            (direction !== "back" && direction !== "forward")
        ) {
            return;
        }
        if (direction === "back") {
            event.sender.navigationHistory.goBack();
        } else if (direction === "forward") {
            event.sender.navigationHistory.goForward();
        }
    });

    secureIpc.on("download", (event, payload) => {
        const filePath = normalizeNativePath(payload?.filePath, electronApp.getPath("home"));
        if (filePath == null) {
            return;
        }
        const baseName = encodeURIComponent(path.basename(filePath));
        const streamingUrl =
            getWebServerEndpoint() + "/wave/stream-file/" + baseName + "?path=" + encodeURIComponent(filePath);
        event.sender.downloadURL(streamingUrl);
    });

    secureIpc.on("get-cursor-point", (event) => {
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        if (tabView == null) {
            event.returnValue = null;
            return;
        }
        const screenPoint = electron.screen.getCursorScreenPoint();
        const windowRect = tabView.getBounds();
        const retVal: Electron.Point = {
            x: screenPoint.x - windowRect.x,
            y: screenPoint.y - windowRect.y,
        };
        event.returnValue = retVal;
    });

    secureIpc.handle("capture-screenshot", async (event, rect) => {
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        if (!tabView) {
            throw new Error("No tab view found for the given webContents id");
        }
        const bounds = tabView.getBounds();
        const normalizedRect = normalizeCaptureRectangle(rect, { width: bounds.width, height: bounds.height });
        if (normalizedRect == null) {
            throw new Error("Invalid screenshot rectangle");
        }
        const image = await tabView.webContents.capturePage(normalizedRect);
        const base64String = image.toPNG().toString("base64");
        return `data:image/png;base64,${base64String}`;
    });

    secureIpc.on("get-env", (event, varName) => {
        if (!RendererEnvAllowlist.has(varName)) {
            event.returnValue = null;
            return;
        }
        event.returnValue = process.env[varName] ?? null;
    });

    secureIpc.on("get-about-modal-details", (event) => {
        event.returnValue = getWaveVersion() as AboutModalDetails;
    });

    secureIpc.on("get-zoom-factor", (event) => {
        event.returnValue = event.sender.getZoomFactor();
    });

    const hasBeforeInputRegisteredMap = new Map<number, boolean>();

    secureIpc.on("webview-focus", (event: Electron.IpcMainEvent, focusedId: number) => {
        if (focusedId == null) {
            webviewFocusId = null;
            return;
        }
        if (!Number.isSafeInteger(focusedId)) {
            return;
        }
        const parentWc = event.sender;
        const webviewWc = electron.webContents.fromId(focusedId);
        if (webviewWc == null || webviewWc.getType() !== "webview" || webviewWc.hostWebContents?.id !== parentWc.id) {
            return;
        }
        webviewFocusId = focusedId;
        console.log("webview-focus", focusedId);
        if (!hasBeforeInputRegisteredMap.get(focusedId)) {
            hasBeforeInputRegisteredMap.set(focusedId, true);
            webviewWc.on("before-input-event", (e, input) => {
                let waveEvent = keyutil.adaptFromElectronKeyEvent(input);
                handleCtrlShiftState(parentWc, waveEvent);
                if (webviewFocusId != focusedId) {
                    return;
                }
                if (input.type != "keyDown") {
                    return;
                }
                for (let keyDesc of webviewKeys) {
                    if (keyutil.checkKeyPressed(waveEvent, keyDesc)) {
                        e.preventDefault();
                        parentWc.send("reinject-key", waveEvent);
                        console.log("webview reinject-key", keyDesc);
                        return;
                    }
                }
            });
            webviewWc.on("destroyed", () => {
                hasBeforeInputRegisteredMap.delete(focusedId);
            });
        }
    });

    secureIpc.on(
        "register-global-webview-keys",
        (event, keys: string[]) => {
            webviewKeys = keys
                .filter(
                    (key) => typeof key === "string" && key.length > 0 && key.length <= MaxRegisteredWebviewKeyLength
                )
                .slice(0, MaxRegisteredWebviewKeys);
        },
        (keys) => Array.isArray(keys)
    );

    secureIpc.on("set-keyboard-chord-mode", (event) => {
        event.returnValue = null;
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        tabView?.setKeyboardChordMode(true);
    });

    secureIpc.handle("set-is-active", (event) => {
        setWasActive(true);
        return true;
    });

    const fac = new FastAverageColor();
    secureIpc.on("update-window-controls-overlay", async (event, rect: Dimensions) => {
        if (unamePlatform === "darwin") return;
        try {
            const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
            if (fullConfig?.settings?.["window:nativetitlebar"] && unamePlatform !== "win32") return;

            const zoomFactor = event.sender.getZoomFactor();
            const electronRect: Electron.Rectangle = {
                x: rect.left * zoomFactor,
                y: rect.top * zoomFactor,
                height: rect.height * zoomFactor,
                width: rect.width * zoomFactor,
            };
            const overlay = await event.sender.capturePage(electronRect);
            const overlayBuffer = overlay.toPNG();
            const png = PNG.sync.read(overlayBuffer);
            const color = fac.prepareResult(fac.getColorFromArray4(png.data));
            const ww = getWaveWindowByWebContentsId(event.sender.id);
            if (ww == null) return;
            ww.setTitleBarOverlay({
                color: unamePlatform === "linux" ? color.rgba : "#00000000",
                symbolColor: color.isDark ? "white" : "black",
            });
        } catch (e) {
            console.error("Error updating window controls overlay:", e);
        }
    });

    secureIpc.on("quicklook", (event, filePath: string) => {
        if (unamePlatform !== "darwin") return;
        const normalizedPath = normalizeNativePath(filePath, electronApp.getPath("home"));
        if (normalizedPath == null) return;
        child_process.execFile("/usr/bin/qlmanage", ["-p", normalizedPath], (error, stdout, stderr) => {
            if (error) {
                console.error(`Error opening Quick Look: ${error}`);
            }
        });
    });

    secureIpc.handle("clear-webview-storage", async (event, webContentsId: number) => {
        try {
            if (!Number.isSafeInteger(webContentsId)) {
                throw new Error("Unauthorized webview storage request");
            }
            const wc = electron.webContents.fromId(webContentsId);
            if (wc == null || wc.getType() !== "webview" || wc.hostWebContents?.id !== event.sender.id || !wc.session) {
                throw new Error("Webview does not belong to the requesting renderer");
            }
            await wc.session.clearStorageData();
            console.log("Cleared cookies and storage for webContentsId:", webContentsId);
        } catch (e) {
            console.error("Failed to clear cookies and storage:", e);
            throw e;
        }
    });

    secureIpc.on("open-native-path", (event, filePath: string) => {
        const normalizedPath = normalizeNativePath(filePath, electronApp.getPath("home"));
        if (normalizedPath == null) {
            console.error("Invalid path received in open-native-path event");
            return;
        }
        console.log("open-native-path", normalizedPath);
        fireAndForget(() =>
            callWithOriginalXdgCurrentDesktopAsync(() =>
                electron.shell.openPath(normalizedPath).then((excuse) => {
                    if (excuse) console.error(`Failed to open ${normalizedPath} in native application: ${excuse}`);
                })
            )
        );
    });

    secureIpc.on(
        "set-window-init-status",
        (event, status: "ready" | "wave-ready") => {
            const tabView = getWaveTabViewByWebContentsId(event.sender.id);
            if (tabView != null && tabView.initResolve != null) {
                if (status === "ready") {
                    tabView.initResolve();
                    if (tabView.savedInitOpts) {
                        console.log("savedInitOpts calling wave-init", tabView.waveTabId);
                        tabView.webContents.send("wave-init", tabView.savedInitOpts);
                    }
                } else if (status === "wave-ready") {
                    tabView.waveReadyResolve();
                }
                return;
            }

            const builderWindow = getBuilderWindowByWebContentsId(event.sender.id);
            if (builderWindow != null) {
                if (status === "ready") {
                    if (builderWindow.savedInitOpts) {
                        console.log("savedInitOpts calling builder-init", builderWindow.savedInitOpts.builderId);
                        builderWindow.webContents.send("builder-init", builderWindow.savedInitOpts);
                    }
                }
                return;
            }

            console.log("set-window-init-status: no window found for webContentsId", event.sender.id);
        },
        (status) => status === "ready" || status === "wave-ready"
    );

    secureIpc.on(
        "fe-log",
        (event, logStr: string) => {
            console.log("fe-log", logStr);
        },
        (logStr) => typeof logStr === "string" && logStr.length <= MaxFrontendLogLength
    );

    secureIpc.on(
        "increment-term-commands",
        (event, opts?: { isRemote?: boolean; isWsl?: boolean; isDurable?: boolean }) => {
            incrementTermCommandsRun();
            if (opts?.isRemote === true) {
                incrementTermCommandsRemote();
            }
            if (opts?.isWsl === true) {
                incrementTermCommandsWsl();
            }
            if (opts?.isDurable === true) {
                incrementTermCommandsDurable();
            }
        }
    );

    secureIpc.on("native-paste", (event) => {
        event.sender.paste();
    });

    secureIpc.on(
        "open-builder",
        (event, appId?: string) => {
            openBuilderWindow(appId);
        },
        (appId) => normalizeBuilderAppId(appId) != null
    );

    secureIpc.on("set-builder-window-appid", (event, appId: string) => {
        const bw = getBuilderWindowByWebContentsId(event.sender.id);
        const normalizedAppId = normalizeBuilderAppId(appId);
        if (bw == null || normalizedAppId == null) {
            return;
        }
        bw.builderAppId = normalizedAppId;
        console.log("set-builder-window-appid", bw.builderId, normalizedAppId);
    });

    secureIpc.on("open-new-window", (event) => {
        fireAndForget(createNewWaveWindow);
    });

    secureIpc.on("close-builder-window", async (event) => {
        const bw = getBuilderWindowByWebContentsId(event.sender.id);
        if (bw == null) {
            return;
        }
        const builderId = bw.builderId;
        if (builderId) {
            try {
                await RpcApi.SetRTInfoCommand(ElectronWshClient, {
                    oref: `builder:${builderId}`,
                    data: {} as ObjRTInfo,
                    delete: true,
                });
            } catch (e) {
                console.error("Error deleting builder rtinfo:", e);
            }
        }
        const wc = bw.webContents;
        if (wc.isDevToolsOpened()) {
            wc.closeDevTools();
        }
        for (const guest of electron.webContents.getAllWebContents()) {
            if (guest.getType() === "webview" && guest.hostWebContents?.id === wc.id) {
                if (guest.isDevToolsOpened()) {
                    guest.closeDevTools();
                }
            }
        }
        bw.destroy();
    });

    secureIpc.on("do-refresh", (event) => {
        event.sender.reloadIgnoringCache();
    });

    secureIpc.handle("save-text-file", async (event, fileName: string, content: string) => {
        const input = validateSavedTextInput(fileName, content);
        const ww = getOwnerWindowForSender(event.sender);
        if (ww == null || input == null) {
            return false;
        }
        const result = await electron.dialog.showSaveDialog(ww, {
            title: tMain("Save Scrollback"),
            defaultPath: input.fileName,
            filters: [{ name: tMain("Text Files"), extensions: ["txt", "log"] }],
        });
        if (result.canceled || !result.filePath) {
            return false;
        }
        try {
            await fs.promises.writeFile(result.filePath, input.content, "utf-8");
            console.log("saved scrollback to", result.filePath);
            return true;
        } catch (err) {
            console.error("error saving scrollback file", err);
            return false;
        }
    });
}
