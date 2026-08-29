// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import clsx from "clsx";
import * as jotai from "jotai";
import { OverlayScrollbarsComponent, type OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import * as React from "react";
import { convertWaveEventToDataItem, type DataItem, type SysinfoViewModel } from "./sysinfo";
import { buildPlotGeometry, findClosestPlotPoint, formatPlotTime, type PlotPoint } from "./sysinfo-plot";

type SysinfoViewProps = {
    blockId: string;
    model: SysinfoViewModel;
};

function resolveDomainBound(value: number | string, dataItem: DataItem): number | undefined {
    if (typeof value == "number") {
        return value;
    } else if (typeof value == "string") {
        return dataItem?.[value];
    } else {
        return undefined;
    }
}

export function SysinfoView({ model, blockId }: SysinfoViewProps) {
    const connName = jotai.useAtomValue(model.connection);
    const lastConnName = React.useRef(connName);
    const connStatus = jotai.useAtomValue(model.connStatus);
    const addContinuousData = jotai.useSetAtom(model.addContinuousDataAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);

    React.useEffect(() => {
        if (connStatus?.status != "connected") {
            return;
        }
        if (lastConnName.current !== connName) {
            lastConnName.current = connName;
            model.loadInitialData();
        }
    }, [connStatus.status, connName]);
    React.useEffect(() => {
        const unsubFn = waveEventSubscribeSingle({
            eventType: "sysinfo",
            scope: connName,
            handler: (event) => {
                const loading = globalStore.get(model.loadingAtom);
                if (loading) {
                    return;
                }
                const dataItem = convertWaveEventToDataItem(event);
                const prevData = globalStore.get(model.dataAtom);
                const prevLastTs = prevData[prevData.length - 1]?.ts ?? 0;
                if (dataItem.ts - prevLastTs > 2000) {
                    model.loadInitialData();
                } else {
                    addContinuousData(dataItem);
                }
            },
        });
        console.log("subscribe to sysinfo", connName);
        return () => {
            unsubFn();
        };
    }, [connName, addContinuousData]);
    if (connStatus?.status != "connected") {
        return null;
    }
    if (loading) {
        return null;
    }
    return <SysinfoViewInner key={connStatus?.connection ?? "local"} blockId={blockId} model={model} />;
}

type SingleLinePlotProps = {
    plotData: Array<DataItem>;
    yval: string;
    yvalMeta: TimeSeriesMeta;
    defaultColor: string;
    title?: boolean;
    sparkline?: boolean;
    targetLen: number;
};

function SingleLinePlot({
    plotData,
    yval,
    yvalMeta,
    defaultColor,
    title = false,
    sparkline = false,
    targetLen,
}: SingleLinePlotProps) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const domRect = useDimensionsWithExistingRef(containerRef, 300);
    const plotHeight = domRect?.height ?? 0;
    const plotWidth = domRect?.width ?? 0;
    const [hoveredPoint, setHoveredPoint] = React.useState<PlotPoint | null>(null);
    const gradientId = React.useId().split(":").join("-");
    const decimalPlaces = yvalMeta?.decimalPlaces ?? 0;
    const color = yvalMeta?.color || defaultColor;
    const labelY = yvalMeta?.label ?? "?";
    const maxY = resolveDomainBound(yvalMeta?.maxy, plotData[plotData.length - 1]) ?? 100;
    const minY = resolveDomainBound(yvalMeta?.miny, plotData[plotData.length - 1]) ?? 0;
    const maxX = plotData[plotData.length - 1].ts;
    const minX = maxX - targetLen * 1000;
    const geometry = React.useMemo(
        () =>
            buildPlotGeometry({
                data: plotData,
                yKey: yval,
                minY,
                maxY,
                minX,
                maxX,
                width: plotWidth,
                height: plotHeight,
                axes: !sparkline,
            }),
        [plotData, yval, minY, maxY, minX, maxX, plotWidth, plotHeight, sparkline]
    );

    const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setHoveredPoint(findClosestPlotPoint(geometry.points, event.clientX - rect.left));
    };

    const xTicks = [0, 0.5, 1];
    const yTicks = [0, 0.5, 1];
    const tooltipLeft = hoveredPoint == null ? 0 : Math.min(Math.max(hoveredPoint.x, 70), Math.max(70, plotWidth - 70));

    return (
        <div ref={containerRef} className="relative min-h-[100px] overflow-hidden">
            {plotWidth > 0 && plotHeight > 0 && (
                <svg
                    width={plotWidth}
                    height={plotHeight}
                    role="img"
                    aria-label={yvalMeta?.name ?? yval}
                    onPointerMove={handlePointerMove}
                    onPointerLeave={() => setHoveredPoint(null)}
                >
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.7" />
                            <stop offset="100%" stopColor={color} stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    {!sparkline &&
                        xTicks.map((ratio) => {
                            const x = geometry.plotLeft + ratio * (geometry.plotRight - geometry.plotLeft);
                            const timestamp = minX + ratio * (maxX - minX);
                            return (
                                <g key={`x-${ratio}`}>
                                    <line
                                        x1={x}
                                        x2={x}
                                        y1={geometry.plotTop}
                                        y2={geometry.plotBottom}
                                        stroke="var(--border-color)"
                                        strokeOpacity="0.45"
                                    />
                                    <text
                                        x={x}
                                        y={plotHeight - 5}
                                        textAnchor="middle"
                                        fill="var(--grey-text-color)"
                                        fontSize="9"
                                    >
                                        {formatPlotTime(timestamp)}
                                    </text>
                                </g>
                            );
                        })}
                    {!sparkline &&
                        yTicks.map((ratio) => {
                            const y = geometry.plotBottom - ratio * (geometry.plotBottom - geometry.plotTop);
                            return (
                                <g key={`y-${ratio}`}>
                                    <line
                                        x1={geometry.plotLeft}
                                        x2={geometry.plotRight}
                                        y1={y}
                                        y2={y}
                                        stroke="var(--border-color)"
                                        strokeOpacity="0.45"
                                    />
                                    <text
                                        x={geometry.plotLeft - 4}
                                        y={y + 3}
                                        textAnchor="end"
                                        fill="var(--grey-text-color)"
                                        fontSize="9"
                                    >
                                        {(minY + ratio * (maxY - minY)).toFixed(decimalPlaces)}
                                    </text>
                                </g>
                            );
                        })}
                    <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
                    <path
                        d={geometry.linePath}
                        fill="none"
                        stroke={color}
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                    />
                    {title && (
                        <text x="6" y="14" fill="var(--grey-text-color)" fontSize="11">
                            {yvalMeta?.name}
                        </text>
                    )}
                    {hoveredPoint && (
                        <g pointerEvents="none">
                            <line
                                x1={hoveredPoint.x}
                                x2={hoveredPoint.x}
                                y1={geometry.plotTop}
                                y2={geometry.plotBottom}
                                stroke="var(--grey-text-color)"
                                strokeDasharray="2"
                            />
                            <line
                                x1={geometry.plotLeft}
                                x2={geometry.plotRight}
                                y1={hoveredPoint.y}
                                y2={hoveredPoint.y}
                                stroke="var(--grey-text-color)"
                                strokeDasharray="2"
                            />
                            <circle
                                cx={hoveredPoint.x}
                                cy={hoveredPoint.y}
                                r="3"
                                fill={color}
                                stroke="var(--main-text-color)"
                            />
                        </g>
                    )}
                </svg>
            )}
            {hoveredPoint && (
                <div
                    className="pointer-events-none absolute top-1 -translate-x-1/2 rounded border border-border bg-background px-2 py-1 text-[10px] text-primary shadow-md"
                    style={{ left: tooltipLeft }}
                >
                    {formatPlotTime(hoveredPoint.data.ts)} {Number(hoveredPoint.data[yval]).toFixed(decimalPlaces)}
                    {labelY}
                </div>
            )}
        </div>
    );
}

const SysinfoViewInner = React.memo(({ model }: SysinfoViewProps) => {
    const plotData = jotai.useAtomValue(model.dataAtom);
    const yvals = jotai.useAtomValue(model.metrics);
    const plotMeta = jotai.useAtomValue(model.plotMetaAtom);
    const osRef = React.useRef<OverlayScrollbarsComponentRef>(null);
    const targetLen = jotai.useAtomValue(model.numPoints) + 1;
    let title = false;
    let cols2 = false;
    if (yvals.length > 1) {
        title = true;
    }
    if (yvals.length > 2) {
        cols2 = true;
    }

    return (
        <OverlayScrollbarsComponent
            ref={osRef}
            className="flex flex-col flex-grow mb-0 overflow-y-auto"
            options={{ scrollbars: { autoHide: "leave" } }}
        >
            <div
                className={clsx("w-full h-full grid grid-rows-[repeat(auto-fit,minmax(100px,1fr))] gap-[10px]", {
                    "grid-cols-2": cols2,
                })}
            >
                {plotData &&
                    plotData.length > 0 &&
                    yvals.map((yval, _idx) => {
                        return (
                            <SingleLinePlot
                                key={`plot-${model.blockId}-${yval}`}
                                plotData={plotData}
                                yval={yval}
                                yvalMeta={plotMeta.get(yval)}
                                defaultColor={"var(--accent-color)"}
                                title={title}
                                targetLen={targetLen}
                            />
                        );
                    })}
            </div>
        </OverlayScrollbarsComponent>
    );
});
