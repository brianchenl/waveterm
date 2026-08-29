// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { tCurrent } from "@/app/i18n/current-i18n";
import React, { Suspense, useMemo, useState } from "react";

type LoaderResult<P> = { default: React.ComponentType<P> };

export type PreloadableComponent<P> = React.FunctionComponent<P> & {
    preload: () => Promise<void>;
};

type LazyModuleBoundaryProps = {
    children: React.ReactNode;
    moduleName: string;
    onRetry: () => void;
};

class LazyModuleBoundary extends React.Component<LazyModuleBoundaryProps, { error: Error | null }> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error(`Failed to render lazy module ${this.props.moduleName}`, error, info);
    }

    private retry = () => {
        this.setState({ error: null });
        this.props.onRetry();
    };

    render() {
        if (this.state.error == null) return this.props.children;
        return (
            <div className="flex h-full min-h-24 w-full items-center justify-center p-4" role="alert">
                <div className="rounded-md border border-error/50 bg-panel px-4 py-3 text-sm text-secondary">
                    <p>{tCurrent("Wave encountered an error")}</p>
                    <p>{tCurrent("Affected area: {{area}}", { area: this.props.moduleName })}</p>
                    <button
                        type="button"
                        className="mt-3 min-h-9 cursor-pointer rounded-md bg-accent px-3 py-1.5 text-white hover:bg-accent/80"
                        onClick={this.retry}
                    >
                        {tCurrent("Try again")}
                    </button>
                </div>
            </div>
        );
    }
}

export function lazyWithRetry<P>(loader: () => Promise<LoaderResult<P>>, moduleName: string): PreloadableComponent<P> {
    let loadPromise: Promise<LoaderResult<P>> | null = null;
    const load = () => {
        if (loadPromise == null) {
            loadPromise = loader().catch((error) => {
                loadPromise = null;
                throw error;
            });
        }
        return loadPromise;
    };

    const RetryableLazy = (props: P) => {
        const [attempt, setAttempt] = useState(0);
        const LazyComponent = useMemo(() => React.lazy(load), [attempt]);
        return (
            <LazyModuleBoundary moduleName={moduleName} onRetry={() => setAttempt((value) => value + 1)}>
                <Suspense fallback={<div className="h-full min-h-12 w-full animate-pulse bg-black/10" />}>
                    <LazyComponent {...(props as P & React.JSX.IntrinsicAttributes)} />
                </Suspense>
            </LazyModuleBoundary>
        );
    };
    RetryableLazy.displayName = `LazyWithRetry(${moduleName})`;
    return Object.assign(RetryableLazy, { preload: () => load().then(() => undefined) });
}

export function scheduleIdlePreload(component: Pick<PreloadableComponent<any>, "preload">, timeout = 2000): () => void {
    const windowWithIdleCallback = window as typeof window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        cancelIdleCallback?: (handle: number) => void;
    };
    const preload = () => component.preload().catch((error) => console.error("Lazy module preload failed", error));
    if (windowWithIdleCallback.requestIdleCallback && windowWithIdleCallback.cancelIdleCallback) {
        const handle = windowWithIdleCallback.requestIdleCallback(() => void preload(), { timeout });
        return () => windowWithIdleCallback.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(() => void preload(), timeout);
    return () => window.clearTimeout(handle);
}
