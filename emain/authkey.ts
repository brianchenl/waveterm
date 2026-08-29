// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ipcMain } from "electron";
import { getWebServerEndpoint, getWSServerEndpoint } from "../frontend/util/endpoints";
import { createSecureIpcRegistrar, isNonWebviewIpcSender } from "./emain-ipc-guard";

const AuthKeyHeader = "X-AuthKey";
export const WaveAuthKeyEnv = "WAVETERM_AUTH_KEY";
export const AuthKey = crypto.randomUUID();

const authIpc = createSecureIpcRegistrar(ipcMain, isNonWebviewIpcSender);

authIpc.on("get-auth-key", (event) => {
    event.returnValue = AuthKey;
});

export function configureAuthKeyRequestInjection(session: Electron.Session) {
    const filter: Electron.WebRequestFilter = {
        urls: [`${getWebServerEndpoint()}/*`, `${getWSServerEndpoint()}/*`],
    };
    session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        details.requestHeaders[AuthKeyHeader] = AuthKey;
        callback({ requestHeaders: details.requestHeaders });
    });
}
