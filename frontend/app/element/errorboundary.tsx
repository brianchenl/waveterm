// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { tCurrent } from "@/app/i18n/current-i18n";
import React, { ReactNode } from "react";

type ErrorBoundaryState = {
    error: Error | null;
    componentStack: string;
    copyStatus: "idle" | "copied" | "failed";
};

export function makeErrorReport(error: Error, componentStack = ""): string {
    const parts = [`${error.name || "Error"}: ${error.message || "Unknown error"}`];
    if (error.stack) {
        parts.push(error.stack);
    }
    if (componentStack.trim()) {
        parts.push(`Component stack:\n${componentStack.trim()}`);
    }
    return parts.join("\n\n");
}

export class ErrorBoundary extends React.Component<
    { children: ReactNode; fallback?: React.ReactElement & { error?: Error }; scopeName?: string },
    ErrorBoundaryState
> {
    constructor(props) {
        super(props);
        this.state = { error: null, componentStack: "", copyStatus: "idle" };
    }

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { error, copyStatus: "idle" };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
        this.setState({ componentStack: errorInfo.componentStack ?? "" });
    }

    private reset = () => {
        this.setState({ error: null, componentStack: "", copyStatus: "idle" });
    };

    private reload = () => {
        window.location.reload();
    };

    private copyError = async () => {
        const { error, componentStack } = this.state;
        if (!error) return;
        try {
            await navigator.clipboard.writeText(makeErrorReport(error, componentStack));
            this.setState({ copyStatus: "copied" });
        } catch {
            this.setState({ copyStatus: "failed" });
        }
    };

    render() {
        const { fallback } = this.props;
        const { error, componentStack, copyStatus } = this.state;
        if (error) {
            if (fallback != null) {
                return React.cloneElement(fallback as any, { error });
            }
            const report = makeErrorReport(error, componentStack);
            return (
                <div className="flex h-full min-h-48 w-full items-center justify-center bg-background p-6" role="alert">
                    <div className="w-full max-w-2xl rounded-xl border border-error/50 bg-panel p-5 shadow-xl">
                        <div className="flex items-start gap-3">
                            <i
                                className="fa-sharp fa-solid fa-triangle-exclamation mt-0.5 text-lg text-error"
                                aria-hidden="true"
                            />
                            <div className="min-w-0 flex-1">
                                <h2 className="text-base font-semibold text-primary">
                                    {tCurrent("Wave encountered an error")}
                                </h2>
                                <p className="mt-1 text-sm text-secondary">
                                    {tCurrent(
                                        "You can retry this area or reload the window. Your configuration has not been deleted."
                                    )}
                                </p>
                                {this.props.scopeName && (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        {tCurrent("Affected area: {{area}}", { area: this.props.scopeName })}
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={this.reset}
                                className="min-h-10 cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                {tCurrent("Try again")}
                            </button>
                            <button
                                type="button"
                                onClick={this.reload}
                                className="min-h-10 cursor-pointer rounded-md border border-border bg-background px-4 py-2 text-sm text-primary transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                {tCurrent("Reload window")}
                            </button>
                            <button
                                type="button"
                                onClick={this.copyError}
                                className="min-h-10 cursor-pointer rounded-md border border-border bg-background px-4 py-2 text-sm text-primary transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                {copyStatus === "copied" ? tCurrent("Copied") : tCurrent("Copy error report")}
                            </button>
                        </div>
                        {copyStatus === "failed" && (
                            <p className="mt-2 text-xs text-error" aria-live="polite">
                                {tCurrent("Unable to copy automatically. Expand the details and copy them manually.")}
                            </p>
                        )}
                        <details className="mt-4 rounded-md border border-border bg-background/60">
                            <summary className="cursor-pointer px-3 py-2 text-sm text-secondary hover:text-primary">
                                {tCurrent("Technical details")}
                            </summary>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border p-3 text-xs text-muted-foreground">
                                {report}
                            </pre>
                        </details>
                    </div>
                </div>
            );
        } else {
            return <>{this.props.children}</>;
        }
    }
}

export class NullErrorBoundary extends React.Component<
    { children: React.ReactNode; debugName?: string },
    { hasError: boolean }
> {
    constructor(props: { children: React.ReactNode; debugName?: string }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error(`${this.props.debugName ?? "NullErrorBoundary"} error boundary caught error`, error, info);
    }

    render() {
        if (this.state.hasError) {
            return null;
        }
        return this.props.children;
    }
}
