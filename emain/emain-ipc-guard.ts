// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";

type IpcEvent = IpcMainEvent | IpcMainInvokeEvent;
type AuthorizeSender = (event: IpcEvent, ...args: unknown[]) => boolean;
type ValidateArguments = (...args: unknown[]) => boolean;

const AcceptArguments: ValidateArguments = () => true;

export type SecureIpcRegistrar = {
    on: (
        channel: string,
        listener: (event: IpcMainEvent, ...args: any[]) => void,
        validateArguments?: ValidateArguments
    ) => void;
    once: (
        channel: string,
        listener: (event: IpcMainEvent, ...args: any[]) => void,
        validateArguments?: ValidateArguments
    ) => () => void;
    handle: (
        channel: string,
        listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
        validateArguments?: ValidateArguments
    ) => void;
};

export function createSecureIpcRegistrar(
    ipcMain: Pick<IpcMain, "on" | "handle" | "removeListener">,
    authorizeSender: AuthorizeSender
): SecureIpcRegistrar {
    return {
        on(channel, listener, validateArguments = AcceptArguments) {
            ipcMain.on(channel, (event, ...args) => {
                if (!authorizeSender(event, ...args) || !validateArguments(...args)) {
                    return;
                }
                listener(event, ...args);
            });
        },
        once(channel, listener, validateArguments = AcceptArguments) {
            const wrappedListener = (event: IpcMainEvent, ...args: any[]) => {
                if (!authorizeSender(event, ...args) || !validateArguments(...args)) {
                    return;
                }
                ipcMain.removeListener(channel, wrappedListener);
                listener(event, ...args);
            };
            ipcMain.on(channel, wrappedListener);
            return () => ipcMain.removeListener(channel, wrappedListener);
        },
        handle(channel, listener, validateArguments = AcceptArguments) {
            ipcMain.handle(channel, async (event, ...args) => {
                if (!authorizeSender(event, ...args)) {
                    throw new Error(`Unauthorized IPC request: ${channel}`);
                }
                if (!validateArguments(...args)) {
                    throw new Error(`Invalid IPC arguments: ${channel}`);
                }
                return await listener(event, ...args);
            });
        },
    };
}

export function isNonWebviewIpcSender(event: IpcEvent): boolean {
    const sender = event?.sender;
    return sender != null && !sender.isDestroyed() && sender.getType() !== "webview";
}
