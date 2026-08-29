// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi, getFocusedBlockId } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";

export interface TerminalAISeed {
    text?: string;
    submit?: boolean;
    newChat?: boolean;
    files?: File[];
    selection?: string;
    /** Internal acknowledgement used by lazy/controller adapters. */
    completion?: {
        resolve: () => void;
        reject: (error: unknown) => void;
    };
}

export interface TerminalAIHandle {
    open(seed?: TerminalAISeed): void | Promise<void>;
    toggle(): void;
    close(): void;
    focus?(): void;
}

export class TerminalAIRegistry {
    private readonly handles = new Map<string, TerminalAIHandle>();
    private readonly openChains = new Map<string, Promise<boolean>>();
    readonly openBlockIdsAtom = atom<ReadonlySet<string>>(new Set<string>());
    readonly anyOpenAtom = atom((get) => get(this.openBlockIdsAtom).size > 0);

    register(blockId: string, handle: TerminalAIHandle): () => void {
        this.handles.set(blockId, handle);
        return () => {
            if (this.handles.get(blockId) === handle) {
                this.handles.delete(blockId);
                this.setOpen(blockId, false);
            }
        };
    }

    open(blockId: string, seed?: TerminalAISeed): Promise<boolean> {
        const previous = this.openChains.get(blockId) ?? Promise.resolve(true);
        const current = previous
            .catch(() => false)
            .then(async () => {
                const handle = this.handles.get(blockId);
                if (!handle) {
                    return false;
                }
                await handle.open(seed);
                return true;
            });
        this.openChains.set(blockId, current);
        const cleanup = () => {
            if (this.openChains.get(blockId) === current) {
                this.openChains.delete(blockId);
            }
        };
        void current.then(cleanup, cleanup);
        return current;
    }

    toggle(blockId: string): boolean {
        const handle = this.handles.get(blockId);
        if (!handle) {
            return false;
        }
        handle.toggle();
        return true;
    }

    close(blockId: string): boolean {
        const handle = this.handles.get(blockId);
        if (!handle) {
            return false;
        }
        handle.close();
        return true;
    }

    focus(blockId: string): boolean {
        const handle = this.handles.get(blockId);
        if (!handle?.focus) {
            return false;
        }
        handle.focus();
        return true;
    }

    setOpen(blockId: string, open: boolean): void {
        const current = globalStore.get(this.openBlockIdsAtom);
        if (current.has(blockId) === open) {
            return;
        }
        const next = new Set(current);
        if (open) {
            next.add(blockId);
        } else {
            next.delete(blockId);
        }
        globalStore.set(this.openBlockIdsAtom, next);
        getApi().setWaveAIOpen(next.size > 0);
    }
}

export const terminalAIRegistry = new TerminalAIRegistry();

export function openFocusedTerminalAI(seed?: TerminalAISeed): Promise<boolean> {
    const blockId = getFocusedBlockId();
    return blockId ? terminalAIRegistry.open(blockId, seed) : Promise.resolve(false);
}

export function toggleFocusedTerminalAI(): boolean {
    const blockId = getFocusedBlockId();
    return blockId ? terminalAIRegistry.toggle(blockId) : false;
}
