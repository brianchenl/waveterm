// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ErrorBoundary } from "@/app/element/errorboundary";
import { lazyWithRetry } from "@/app/element/lazy-module";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { VTabBar } from "@/app/tab/vtabbar";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { atoms, getSettingsKeyAtom } from "@/store/global";
import { isMacOS } from "@/util/platformutil";
import { useAtomValue } from "jotai";
import { memo, Suspense, useEffect, useRef } from "react";
import {
    ImperativePanelGroupHandle,
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";

const Widgets = lazyWithRetry(
    () => import("@/app/workspace/widgets").then((module) => ({ default: module.Widgets })),
    "Widgets"
);

const MacOSTabBarSpacer = memo(() => (
    <div
        className="w-full shrink-0"
        style={
            {
                height: "calc(8px * var(--zoomfactor-inv))",
                WebkitAppRegion: "drag",
                backdropFilter: "blur(20px)",
                background: "rgba(0, 0, 0, 0.35)",
            } as React.CSSProperties
        }
    />
));
MacOSTabBarSpacer.displayName = "MacOSTabBarSpacer";

const WorkspaceElem = memo(() => {
    const layout = WorkspaceLayoutModel.getInstance();
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const tabBarPosition = useAtomValue(getSettingsKeyAtom("app:tabbar")) ?? "top";
    const showLeftTabBar = tabBarPosition === "left";
    const widgetsSidebarVisible = useAtomValue(layout.widgetsSidebarVisibleAtom);
    const panelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const vtabPanelRef = useRef<ImperativePanelHandle>(null);
    const vtabWrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (panelGroupRef.current && vtabPanelRef.current && vtabWrapperRef.current) {
            layout.registerRefs(panelGroupRef.current, vtabPanelRef.current, vtabWrapperRef.current, showLeftTabBar);
        }
    }, []);

    useEffect(() => layout.setShowLeftTabBar(showLeftTabBar), [showLeftTabBar]);

    useEffect(() => {
        const handleResize = () => layout.handleWindowResize();
        const handleFocus = () => layout.syncVTabWidthFromMeta();
        window.addEventListener("resize", handleResize);
        window.addEventListener("focus", handleFocus);
        return () => {
            window.removeEventListener("resize", handleResize);
            window.removeEventListener("focus", handleFocus);
        };
    }, []);

    const initialVTabPercentage = layout.getInitialPercentage(window.innerWidth, showLeftTabBar);
    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden">
            {!(showLeftTabBar && isMacOS()) && <TabBar key={ws.oid} workspace={ws} noTabs={showLeftTabBar} />}
            {showLeftTabBar && isMacOS() && <MacOSTabBarSpacer />}
            <div className="flex flex-row flex-grow overflow-hidden">
                <ErrorBoundary key={tabId}>
                    <PanelGroup direction="horizontal" onLayout={layout.handlePanelLayout} ref={panelGroupRef}>
                        <Panel
                            ref={vtabPanelRef}
                            collapsible
                            order={0}
                            defaultSize={initialVTabPercentage}
                            className="overflow-hidden"
                        >
                            <div ref={vtabWrapperRef} className="w-full h-full">
                                {showLeftTabBar && <VTabBar workspace={ws} />}
                            </div>
                        </Panel>
                        <PanelResizeHandle
                            className={`bg-transparent hover:bg-zinc-500/20 transition-colors ${showLeftTabBar ? "w-0.5" : "w-0 pointer-events-none"}`}
                        />
                        <Panel order={1} defaultSize={100 - initialVTabPercentage}>
                            {tabId === "" ? (
                                <CenteredDiv>No Active Tab</CenteredDiv>
                            ) : (
                                <div className="flex flex-row h-full">
                                    <TabContent key={tabId} tabId={tabId} noTopPadding={showLeftTabBar && isMacOS()} />
                                    {widgetsSidebarVisible && (
                                        <Suspense fallback={null}>
                                            <Widgets />
                                        </Suspense>
                                    )}
                                </div>
                            )}
                        </Panel>
                    </PanelGroup>
                    <ModalsRenderer />
                </ErrorBoundary>
            </div>
        </div>
    );
});

WorkspaceElem.displayName = "WorkspaceElem";

export { WorkspaceElem as Workspace };
