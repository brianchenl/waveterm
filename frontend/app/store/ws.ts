// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { type WebSocket, newWebSocket } from "@/util/wsutil";
import debug from "debug";
import { sprintf } from "sprintf-js";

const AuthKeyHeader = "X-AuthKey";

const dlog = debug("wave:ws");

const WarnWebSocketSendSize = 1024 * 1024; // 1MB
const MaxWebSocketSendSize = 5 * 1024 * 1024; // 5MB
const MaxQueuedWebSocketMessages = 256;
const MaxQueuedWebSocketBytes = 8 * 1024 * 1024; // 8MB
const reconnectHandlers: (() => void)[] = [];
const StableConnTime = 2000;

function addWSReconnectHandler(handler: () => void) {
    reconnectHandlers.push(handler);
}

function removeWSReconnectHandler(handler: () => void) {
    const index = reconnectHandlers.indexOf(handler);
    if (index > -1) {
        reconnectHandlers.splice(index, 1);
    }
}

type WSEventCallback = (arg0: WSEventType) => void;

type ElectronOverrideOpts = {
    authKey: string;
};

type QueuedMessage = {
    data: WSCommandType;
    byteSize: number;
    priority: "normal" | "high";
};

type WSQueueStats = {
    queuedMessages: number;
    queuedBytes: number;
    droppedMessages: number;
    droppedBytes: number;
};

class WSControl {
    wsConn: WebSocket;
    open: boolean;
    opening: boolean = false;
    reconnectTimes: number = 0;
    msgQueue: QueuedMessage[] = [];
    msgQueueBytes: number = 0;
    queueLimitWarningShown: boolean = false;
    droppedMessageCount: number = 0;
    droppedMessageBytes: number = 0;
    stableId: string;
    messageCallback: WSEventCallback;
    watchSessionId: string = null;
    watchScreenId: string = null;
    wsLog: string[] = [];
    baseHostPort: string;
    lastReconnectTime: number = 0;
    eoOpts: ElectronOverrideOpts;
    noReconnect: boolean = false;
    onOpenTimeoutId: NodeJS.Timeout = null;
    pingIntervalId: NodeJS.Timeout = null;
    reconnectTimeoutId: NodeJS.Timeout = null;
    queueTimeoutId: NodeJS.Timeout = null;

    constructor(
        baseHostPort: string,
        stableId: string,
        messageCallback: WSEventCallback,
        electronOverrideOpts?: ElectronOverrideOpts
    ) {
        this.baseHostPort = baseHostPort;
        this.messageCallback = messageCallback;
        this.stableId = stableId;
        this.open = false;
        this.eoOpts = electronOverrideOpts;
        this.pingIntervalId = setInterval(this.sendPing.bind(this), 5000);
    }

    shutdown() {
        this.noReconnect = true;
        this.open = false;
        this.opening = false;
        this.msgQueue = [];
        this.msgQueueBytes = 0;
        this.queueLimitWarningShown = false;
        clearInterval(this.pingIntervalId);
        clearTimeout(this.onOpenTimeoutId);
        clearTimeout(this.reconnectTimeoutId);
        clearTimeout(this.queueTimeoutId);
        this.pingIntervalId = null;
        this.onOpenTimeoutId = null;
        this.reconnectTimeoutId = null;
        this.queueTimeoutId = null;
        this.wsConn?.close();
    }

    getQueueStats(): WSQueueStats {
        return {
            queuedMessages: this.msgQueue.length,
            queuedBytes: this.msgQueueBytes,
            droppedMessages: this.droppedMessageCount,
            droppedBytes: this.droppedMessageBytes,
        };
    }

    connectNow(desc: string) {
        if (this.open || this.opening || this.noReconnect) {
            return;
        }
        this.lastReconnectTime = Date.now();
        dlog("try reconnect:", desc);
        this.opening = true;
        this.wsConn = newWebSocket(
            this.baseHostPort + "/ws?stableid=" + encodeURIComponent(this.stableId),
            this.eoOpts
                ? {
                      [AuthKeyHeader]: this.eoOpts.authKey,
                  }
                : null
        );
        this.wsConn.onopen = (e: Event) => {
            this.onopen(e);
        };
        this.wsConn.onmessage = (e: MessageEvent) => {
            this.onmessage(e);
        };
        this.wsConn.onclose = (e: CloseEvent) => {
            this.onclose(e);
        };
        // turns out onerror is not necessary (onclose always follows onerror)
        // this.wsConn.onerror = this.onerror;
    }

    reconnect(forceClose?: boolean) {
        if (this.noReconnect) {
            return;
        }
        if (this.open) {
            if (forceClose) {
                this.wsConn.close(); // this will force a reconnect
            }
            return;
        }
        this.reconnectTimes++;
        if (this.reconnectTimes > 20) {
            dlog("cannot connect, giving up");
            this.noReconnect = true;
            this.msgQueue = [];
            this.msgQueueBytes = 0;
            this.queueLimitWarningShown = false;
            clearInterval(this.pingIntervalId);
            this.pingIntervalId = null;
            return;
        }
        const timeoutArr = [0, 0, 2, 5, 10, 10, 30, 60];
        let timeout = 60;
        if (this.reconnectTimes < timeoutArr.length) {
            timeout = timeoutArr[this.reconnectTimes];
        }
        if (Date.now() - this.lastReconnectTime < 500) {
            timeout = 1;
        }
        if (timeout > 0) {
            dlog(sprintf("sleeping %ds", timeout));
        }
        clearTimeout(this.reconnectTimeoutId);
        this.reconnectTimeoutId = setTimeout(() => {
            this.reconnectTimeoutId = null;
            this.connectNow(String(this.reconnectTimes));
        }, timeout * 1000);
    }

    onclose(event: CloseEvent) {
        // console.log("close", event);
        if (this.onOpenTimeoutId) {
            clearTimeout(this.onOpenTimeoutId);
            this.onOpenTimeoutId = null;
        }
        if (event.wasClean) {
            dlog("connection closed");
        } else {
            dlog("connection error/disconnected");
        }
        if (this.open || this.opening) {
            this.open = false;
            this.opening = false;
            this.reconnect();
        }
    }

    onopen(e: Event) {
        if (this.noReconnect) {
            this.wsConn?.close();
            return;
        }
        dlog("connection open");
        this.open = true;
        this.opening = false;
        this.onOpenTimeoutId = setTimeout(() => {
            this.reconnectTimes = 0;
            dlog("clear reconnect times");
        }, StableConnTime);
        for (let handler of reconnectHandlers) {
            handler();
        }
        this.runMsgQueue();
    }

    runMsgQueue() {
        if (!this.open) {
            return;
        }
        if (this.msgQueue.length == 0) {
            return;
        }
        const msg = this.msgQueue.shift();
        this.msgQueueBytes -= msg.byteSize;
        if (this.msgQueue.length < MaxQueuedWebSocketMessages / 2 && this.msgQueueBytes < MaxQueuedWebSocketBytes / 2) {
            this.queueLimitWarningShown = false;
        }
        this.sendMessage(msg.data);
        this.queueTimeoutId = setTimeout(() => {
            this.queueTimeoutId = null;
            this.runMsgQueue();
        }, 100);
    }

    onmessage(event: MessageEvent) {
        let eventData = null;
        try {
            if (event.data != null) {
                eventData = JSON.parse(event.data);
            }
        } catch (error) {
            console.warn("ignoring malformed websocket message", error);
            return;
        }
        if (eventData == null) {
            return;
        }
        if (eventData.type == "ping") {
            this.wsConn.send(JSON.stringify({ type: "pong", stime: Date.now() }));
            return;
        }
        if (eventData.type == "pong") {
            // nothing
            return;
        }
        if (this.messageCallback) {
            try {
                this.messageCallback(eventData);
            } catch (e) {
                console.log("[error] messageCallback", e);
            }
        }
    }

    sendPing() {
        if (!this.open) {
            return;
        }
        this.wsConn.send(JSON.stringify({ type: "ping", stime: Date.now() }));
    }

    sendMessage(data: WSCommandType) {
        if (!this.open) {
            return;
        }
        const serialized = this.serializeMessage(data);
        if (serialized == null) {
            return;
        }
        const { msg } = serialized;
        this.wsConn.send(msg);
    }

    private serializeMessage(data: WSCommandType): { msg: string; byteSize: number } | null {
        let msg: string;
        try {
            msg = JSON.stringify(data);
        } catch (error) {
            console.warn("failed to serialize websocket message", error);
            return null;
        }
        const byteSize = new TextEncoder().encode(msg).byteLength;
        if (byteSize > MaxWebSocketSendSize) {
            console.log("ws message too large", byteSize, data.wscommand, msg.substring(0, 100));
            return null;
        }
        if (byteSize > WarnWebSocketSendSize) {
            console.log("ws message large", byteSize, data.wscommand, msg.substring(0, 100));
        }
        return { msg, byteSize };
    }

    private getMessagePriority(data: WSCommandType): "normal" | "high" {
        if (data.wscommand !== "rpc") {
            return "normal";
        }
        const message = data.message;
        return message?.reqid || message?.resid || message?.cancel ? "high" : "normal";
    }

    private recordDroppedMessage(byteSize: number): void {
        this.droppedMessageCount++;
        this.droppedMessageBytes += byteSize;
        if (!this.queueLimitWarningShown) {
            console.warn("websocket queue limit reached; dropping queued message");
            this.queueLimitWarningShown = true;
        }
    }

    pushMessage(data: WSCommandType) {
        if (this.noReconnect) {
            return;
        }
        if (!this.open) {
            if (data.wscommand === "rpc" && data.message) {
                const cmd = data.message.command;
                if (cmd === "routeannounce" || cmd === "routeunannounce") {
                    return;
                }
            }
            const serialized = this.serializeMessage(data);
            if (serialized == null) {
                return;
            }
            const priority = this.getMessagePriority(data);
            let wouldExceedLimit =
                this.msgQueue.length >= MaxQueuedWebSocketMessages ||
                this.msgQueueBytes + serialized.byteSize > MaxQueuedWebSocketBytes;
            while (wouldExceedLimit && priority === "high") {
                const normalIndex = this.msgQueue.findIndex((message) => message.priority === "normal");
                if (normalIndex < 0) {
                    break;
                }
                const [evicted] = this.msgQueue.splice(normalIndex, 1);
                this.msgQueueBytes -= evicted.byteSize;
                this.recordDroppedMessage(evicted.byteSize);
                wouldExceedLimit =
                    this.msgQueue.length >= MaxQueuedWebSocketMessages ||
                    this.msgQueueBytes + serialized.byteSize > MaxQueuedWebSocketBytes;
            }
            if (wouldExceedLimit) {
                this.recordDroppedMessage(serialized.byteSize);
                return;
            }
            this.msgQueue.push({ data, byteSize: serialized.byteSize, priority });
            this.msgQueueBytes += serialized.byteSize;
            return;
        }
        this.sendMessage(data);
    }
}

let globalWS: WSControl;
function initGlobalWS(
    baseHostPort: string,
    stableId: string,
    messageCallback: WSEventCallback,
    electronOverrideOpts?: ElectronOverrideOpts
) {
    globalWS = new WSControl(baseHostPort, stableId, messageCallback, electronOverrideOpts);
}

function sendRawRpcMessage(msg: RpcMessage) {
    const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
    sendWSCommand(wsMsg);
}

function sendWSCommand(cmd: WSCommandType) {
    globalWS?.pushMessage(cmd);
}

export {
    MaxQueuedWebSocketBytes,
    MaxQueuedWebSocketMessages,
    WSControl,
    addWSReconnectHandler,
    globalWS,
    initGlobalWS,
    removeWSReconnectHandler,
    sendRawRpcMessage,
    sendWSCommand,
    type ElectronOverrideOpts,
    type WSQueueStats,
};
