// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { lazyWithRetry } from "@/app/element/lazy-module";
import { tCurrent } from "@/app/i18n/current-i18n";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { MetaKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import * as keyutil from "@/util/keyutil";
import { isBlank, makeConnRoute } from "@/util/util";
import * as jotai from "jotai";

// ---- types ----

export type ActionStatus = {
    pid: number;
    message: string;
    isError: boolean;
};

type ProcessViewerEnv = WaveEnvSubset<{
    rpc: {
        RemoteProcessListCommand: WaveEnv["rpc"]["RemoteProcessListCommand"];
        RemoteProcessSignalCommand: WaveEnv["rpc"]["RemoteProcessSignalCommand"];
    };
    getConnStatusAtom: WaveEnv["getConnStatusAtom"];
    getBlockMetaKeyAtom: MetaKeyAtomFnType<"connection">;
}>;

export type SortCol = "pid" | "command" | "user" | "cpu" | "mem" | "status" | "threads";

export const RowHeight = 24;
const OverscanRows = 100;

// ---- model ----

const ProcessViewerView = lazyWithRetry(
    () => import("./processviewer-view").then((module) => ({ default: module.ProcessViewerView })),
    "Process viewer"
);

export class ProcessViewerViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    env: ProcessViewerEnv;

    viewIcon = jotai.atom<string>("microchip");
    viewName = jotai.atom<string>("Processes");
    manageConnection = jotai.atom<boolean>(true);
    filterOutNowsh = jotai.atom<boolean>(true);
    noPadding = jotai.atom<boolean>(true);

    dataAtom: jotai.PrimitiveAtom<ProcessListResponse>;
    dataStartAtom: jotai.PrimitiveAtom<number>;
    sortByAtom: jotai.PrimitiveAtom<SortCol>;
    sortDescAtom: jotai.PrimitiveAtom<boolean>;
    scrollTopAtom: jotai.PrimitiveAtom<number>;
    containerHeightAtom: jotai.PrimitiveAtom<number>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    errorAtom: jotai.PrimitiveAtom<string>;
    lastSuccessAtom: jotai.PrimitiveAtom<number>;
    pausedAtom: jotai.PrimitiveAtom<boolean>;
    selectedPidAtom: jotai.PrimitiveAtom<number>;
    actionStatusAtom: jotai.PrimitiveAtom<ActionStatus>;
    textSearchAtom: jotai.PrimitiveAtom<string>;
    searchOpenAtom: jotai.PrimitiveAtom<boolean>;
    fetchIntervalAtom: jotai.PrimitiveAtom<number>;

    connection: jotai.Atom<string>;
    connStatus: jotai.Atom<ConnStatus>;

    disposed = false;
    cancelPoll: (() => void) | null = null;
    fetchEpoch = 0;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.viewType = "processviewer";
        this.blockId = blockId;
        this.env = waveEnv;

        this.dataAtom = jotai.atom<ProcessListResponse>(null) as jotai.PrimitiveAtom<ProcessListResponse>;
        this.dataStartAtom = jotai.atom<number>(0);
        this.sortByAtom = jotai.atom<SortCol>("cpu");
        this.sortDescAtom = jotai.atom<boolean>(true);
        this.scrollTopAtom = jotai.atom<number>(0);
        this.containerHeightAtom = jotai.atom<number>(0);
        this.loadingAtom = jotai.atom<boolean>(true);
        this.errorAtom = jotai.atom<string>(null) as jotai.PrimitiveAtom<string>;
        this.lastSuccessAtom = jotai.atom<number>(0) as jotai.PrimitiveAtom<number>;
        this.pausedAtom = jotai.atom<boolean>(false) as jotai.PrimitiveAtom<boolean>;
        this.selectedPidAtom = jotai.atom<number>(null) as jotai.PrimitiveAtom<number>;
        this.actionStatusAtom = jotai.atom<ActionStatus>(null) as jotai.PrimitiveAtom<ActionStatus>;
        this.textSearchAtom = jotai.atom<string>("") as jotai.PrimitiveAtom<string>;
        this.searchOpenAtom = jotai.atom<boolean>(false) as jotai.PrimitiveAtom<boolean>;
        this.fetchIntervalAtom = jotai.atom<number>(2000) as jotai.PrimitiveAtom<number>;

        this.connection = jotai.atom((get) => {
            const connValue = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            if (isBlank(connValue)) {
                return "local";
            }
            return connValue;
        });
        this.connStatus = jotai.atom((get) => {
            const connName = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            const connAtom = this.env.getConnStatusAtom(connName);
            return get(connAtom);
        });

        this.startPolling();
    }

    get viewComponent(): ViewComponent {
        return ProcessViewerView;
    }

    async doOneFetch(lastPidOrder: boolean, cancelledFn?: () => boolean) {
        if (this.disposed) return;
        const epoch = ++this.fetchEpoch;
        const sortBy = globalStore.get(this.sortByAtom);
        const sortDesc = globalStore.get(this.sortDescAtom);
        const scrollTop = globalStore.get(this.scrollTopAtom);
        const containerHeight = globalStore.get(this.containerHeightAtom);
        const conn = globalStore.get(this.connection);
        const textSearch = globalStore.get(this.textSearchAtom);
        const connStatus = globalStore.get(this.connStatus);

        if (!connStatus?.connected) {
            return;
        }
        const start = Math.max(0, Math.floor(scrollTop / RowHeight) - OverscanRows);
        const visibleRows = containerHeight > 0 ? Math.ceil(containerHeight / RowHeight) : 50;
        const limit = visibleRows + OverscanRows * 2;

        const route = makeConnRoute(conn);
        try {
            const resp = await this.env.rpc.RemoteProcessListCommand(
                TabRpcClient,
                {
                    widgetid: this.blockId,
                    sortby: sortBy,
                    sortdesc: sortDesc,
                    start,
                    limit,
                    textsearch: textSearch || undefined,
                    lastpidorder: lastPidOrder,
                },
                { route }
            );
            if (!this.disposed && !cancelledFn?.() && this.fetchEpoch === epoch) {
                globalStore.set(this.dataAtom, resp);
                globalStore.set(this.dataStartAtom, start);
                globalStore.set(this.loadingAtom, false);
                globalStore.set(this.errorAtom, null);
                globalStore.set(this.lastSuccessAtom, Date.now());
            }
        } catch (e) {
            if (!this.disposed && !cancelledFn?.() && this.fetchEpoch === epoch) {
                globalStore.set(this.loadingAtom, false);
                globalStore.set(this.errorAtom, String(e));
            }
        }
    }

    async doKeepAlive() {
        if (this.disposed) return;
        const connStatus = globalStore.get(this.connStatus);
        if (!connStatus?.connected) {
            return;
        }
        const conn = globalStore.get(this.connection);
        const route = makeConnRoute(conn);
        try {
            await this.env.rpc.RemoteProcessListCommand(
                TabRpcClient,
                { widgetid: this.blockId, keepalive: true },
                { route }
            );
        } catch (_) {
            // keepalive failures are silent
        }
    }

    startPolling() {
        let cancelled = false;
        this.cancelPoll = () => {
            cancelled = true;
        };

        const poll = async () => {
            while (!cancelled && !this.disposed) {
                await this.doOneFetch(false, () => cancelled);

                if (cancelled || this.disposed) break;

                const interval = globalStore.get(this.fetchIntervalAtom);
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, interval);
                    this.cancelPoll = () => {
                        clearTimeout(timer);
                        cancelled = true;
                        resolve();
                    };
                });

                if (!cancelled) {
                    this.cancelPoll = () => {
                        cancelled = true;
                    };
                }
            }
        };

        poll();
    }

    startKeepAlive() {
        let cancelled = false;
        this.cancelPoll = () => {
            cancelled = true;
        };

        const keepAliveLoop = async () => {
            while (!cancelled && !this.disposed) {
                await this.doKeepAlive();

                if (cancelled || this.disposed) break;

                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, 10000);
                    this.cancelPoll = () => {
                        clearTimeout(timer);
                        cancelled = true;
                        resolve();
                    };
                });

                if (!cancelled) {
                    this.cancelPoll = () => {
                        cancelled = true;
                    };
                }
            }
        };

        keepAliveLoop();
    }

    triggerRefresh() {
        if (this.cancelPoll) {
            this.cancelPoll();
        }
        this.cancelPoll = null;
        if (!globalStore.get(this.pausedAtom)) {
            this.startPolling();
        }
    }

    forceRefreshOnConnectionChange() {
        if (this.cancelPoll) {
            this.cancelPoll();
        }
        this.cancelPoll = null;
        globalStore.set(this.dataAtom, null);
        globalStore.set(this.loadingAtom, true);
        globalStore.set(this.errorAtom, null);
        if (globalStore.get(this.pausedAtom)) {
            this.doOneFetch(false);
            this.startKeepAlive();
        } else {
            this.startPolling();
        }
    }

    setPaused(paused: boolean) {
        globalStore.set(this.pausedAtom, paused);
        if (paused) {
            if (this.cancelPoll) {
                this.cancelPoll();
            }
            this.cancelPoll = null;
            this.startKeepAlive();
        } else {
            if (this.cancelPoll) {
                this.cancelPoll();
            }
            this.cancelPoll = null;
            this.startPolling();
        }
    }

    setTextSearch(text: string) {
        globalStore.set(this.textSearchAtom, text);
        if (globalStore.get(this.pausedAtom)) {
            this.doOneFetch(false);
        } else {
            this.triggerRefresh();
        }
    }

    openSearch() {
        globalStore.set(this.searchOpenAtom, true);
    }

    closeSearch() {
        globalStore.set(this.searchOpenAtom, false);
        globalStore.set(this.textSearchAtom, "");
        this.triggerRefresh();
    }

    keyDownHandler(waveEvent: WaveKeyboardEvent): boolean {
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:f")) {
            this.openSearch();
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Space") && !globalStore.get(this.searchOpenAtom)) {
            this.setPaused(!globalStore.get(this.pausedAtom));
            return true;
        }
        return false;
    }

    setSort(col: SortCol) {
        const curSort = globalStore.get(this.sortByAtom);
        const curDesc = globalStore.get(this.sortDescAtom);
        const numericCols: SortCol[] = ["cpu", "mem", "threads"];
        if (curSort === col) {
            globalStore.set(this.sortDescAtom, !curDesc);
        } else {
            globalStore.set(this.sortByAtom, col);
            globalStore.set(this.sortDescAtom, numericCols.includes(col));
        }
        if (globalStore.get(this.pausedAtom)) {
            this.doOneFetch(false);
        } else {
            this.triggerRefresh();
        }
    }

    setScrollTop(scrollTop: number) {
        const cur = globalStore.get(this.scrollTopAtom);
        if (Math.abs(cur - scrollTop) < RowHeight) return;
        globalStore.set(this.scrollTopAtom, scrollTop);
        if (globalStore.get(this.pausedAtom)) {
            this.doOneFetch(true);
        }
    }

    setContainerHeight(height: number) {
        const cur = globalStore.get(this.containerHeightAtom);
        if (cur === height) return;
        globalStore.set(this.containerHeightAtom, height);
        if (globalStore.get(this.pausedAtom)) {
            this.doOneFetch(true);
        } else {
            this.triggerRefresh();
        }
    }

    async sendSignal(pid: number, signal: string, killLabel?: boolean) {
        const conn = globalStore.get(this.connection);
        const route = makeConnRoute(conn);
        const label = killLabel ? "Killed" : `sent ${signal}`;
        try {
            await this.env.rpc.RemoteProcessSignalCommand(TabRpcClient, { pid, signal }, { route });
            this.setActionStatus({ pid, message: `Process #${pid} ${label}`, isError: false });
        } catch (e) {
            this.setActionStatus({ pid, message: String(e), isError: true });
        }
    }

    setActionStatus(status: ActionStatus) {
        globalStore.set(this.actionStatusAtom, status);
        if (!status.isError) {
            setTimeout(() => {
                const cur = globalStore.get(this.actionStatusAtom);
                if (cur === status) {
                    globalStore.set(this.actionStatusAtom, null);
                }
            }, 3000);
        }
    }

    clearActionStatus() {
        globalStore.set(this.actionStatusAtom, null);
    }

    setFetchInterval(ms: number) {
        globalStore.set(this.fetchIntervalAtom, ms);
        this.triggerRefresh();
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const currentInterval = globalStore.get(this.fetchIntervalAtom);
        return [
            {
                label: tCurrent("Refresh Interval"),
                type: "submenu",
                submenu: [
                    {
                        label: tCurrent("1 second"),
                        type: "checkbox",
                        checked: currentInterval === 1000,
                        click: () => this.setFetchInterval(1000),
                    },
                    {
                        label: tCurrent("2 seconds"),
                        type: "checkbox",
                        checked: currentInterval === 2000,
                        click: () => this.setFetchInterval(2000),
                    },
                    {
                        label: tCurrent("5 seconds"),
                        type: "checkbox",
                        checked: currentInterval === 5000,
                        click: () => this.setFetchInterval(5000),
                    },
                ],
            },
        ];
    }

    dispose() {
        this.disposed = true;
        if (this.cancelPoll) {
            this.cancelPoll();
            this.cancelPoll = null;
        }
    }
}
