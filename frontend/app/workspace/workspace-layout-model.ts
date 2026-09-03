// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, getOrefMetaKeyAtom } from "@/store/global";
import * as jotai from "jotai";
import { debounce } from "lodash-es";
import type { ImperativePanelGroupHandle, ImperativePanelHandle } from "react-resizable-panels";

const VTabBarDefaultWidth = 220;
const VTabBarMinWidth = 110;
const VTabBarMaxWidth = 280;

function clampVTabWidth(width: number): number {
    return Math.max(VTabBarMinWidth, Math.min(width, VTabBarMaxWidth));
}

/** Owns only the persistent vertical-tab width. */
class WorkspaceLayoutModel {
    private static instance: WorkspaceLayoutModel | null = null;
    private panelGroupRef: ImperativePanelGroupHandle | null = null;
    private vtabPanelRef: ImperativePanelHandle | null = null;
    private vtabWrapperRef: HTMLDivElement | null = null;
    private vtabWidth = VTabBarDefaultWidth;
    private vtabVisible = false;
    private committing = false;

    readonly widgetsSidebarVisibleAtom = jotai.atom(
        (get) =>
            get(getOrefMetaKeyAtom(WOS.makeORef("workspace", this.getWorkspaceId()), "layout:widgetsvisible")) ?? true
    );

    private readonly persistVTabWidth = debounce(() => {
        if (!this.vtabVisible || !this.vtabWrapperRef?.offsetWidth) return;
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("workspace", this.getWorkspaceId()),
            meta: { "layout:vtabbarwidth": this.vtabWrapperRef.offsetWidth },
        }).catch((error) => console.warn("Failed to persist vtabbar width:", error));
    }, 300);

    private constructor() {
        const savedWidth = globalStore.get(this.getVTabBarWidthAtom());
        if (savedWidth != null && savedWidth > 0) this.vtabWidth = clampVTabWidth(savedWidth);
        this.handlePanelLayout = this.handlePanelLayout.bind(this);
    }

    static getInstance(): WorkspaceLayoutModel {
        WorkspaceLayoutModel.instance ??= new WorkspaceLayoutModel();
        return WorkspaceLayoutModel.instance;
    }

    private getWorkspaceId(): string {
        return globalStore.get(atoms.workspace)?.oid ?? "";
    }

    private getVTabBarWidthAtom(): jotai.Atom<number> {
        return getOrefMetaKeyAtom(WOS.makeORef("workspace", this.getWorkspaceId()), "layout:vtabbarwidth");
    }

    getInitialPercentage(windowWidth: number, visible: boolean): number {
        return visible && windowWidth > 0 ? (clampVTabWidth(this.vtabWidth) / windowWidth) * 100 : 0;
    }

    registerRefs(
        panelGroupRef: ImperativePanelGroupHandle,
        vtabPanelRef: ImperativePanelHandle,
        vtabWrapperRef: HTMLDivElement,
        visible: boolean
    ): void {
        this.panelGroupRef = panelGroupRef;
        this.vtabPanelRef = vtabPanelRef;
        this.vtabWrapperRef = vtabWrapperRef;
        this.vtabVisible = visible;
        this.commitLayout();
    }

    handlePanelLayout(sizes: number[]): void {
        if (this.committing || !this.vtabVisible || window.innerWidth <= 0) return;
        this.vtabWidth = clampVTabWidth((sizes[0] / 100) * window.innerWidth);
        this.persistVTabWidth();
    }

    handleWindowResize(): void {
        this.commitLayout();
    }

    syncVTabWidthFromMeta(): void {
        const savedWidth = globalStore.get(this.getVTabBarWidthAtom());
        if (savedWidth != null && savedWidth > 0 && savedWidth !== this.vtabWidth) {
            this.vtabWidth = clampVTabWidth(savedWidth);
            this.commitLayout();
        }
    }

    setShowLeftTabBar(visible: boolean): void {
        if (this.vtabVisible === visible) return;
        this.vtabVisible = visible;
        this.commitLayout();
    }

    private commitLayout(): void {
        if (!this.panelGroupRef || !this.vtabPanelRef) return;
        this.committing = true;
        if (this.vtabVisible) {
            this.vtabPanelRef.expand();
            const percentage = this.getInitialPercentage(window.innerWidth, true);
            this.panelGroupRef.setLayout([percentage, 100 - percentage]);
        } else {
            this.vtabPanelRef.collapse();
            this.panelGroupRef.setLayout([0, 100]);
        }
        this.committing = false;
    }
}

export { WorkspaceLayoutModel };
