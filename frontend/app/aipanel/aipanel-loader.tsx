// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { lazyWithRetry } from "@/app/element/lazy-module";

export const LazyAIPanel = lazyWithRetry(
    () => import("@/app/aipanel/aipanel").then((module) => ({ default: module.AIPanel })),
    "Wave AI"
);

export const preloadAIPanel = LazyAIPanel.preload;
