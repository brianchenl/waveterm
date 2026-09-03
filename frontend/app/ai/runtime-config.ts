// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { getWebServerEndpoint } from "@/util/endpoints";

export function getWaveAIEndpoint(): string {
    return `${getWebServerEndpoint()}/api/post-chat-message`;
}

export function getDefaultWaveAIMode(): string {
    const telemetryEnabled = globalStore.get(getSettingsKeyAtom("telemetry:enabled")) ?? false;
    const configuredMode = globalStore.get(getSettingsKeyAtom("waveai:defaultmode"));
    if (!telemetryEnabled) {
        return configuredMode == null || configuredMode.startsWith("waveai@") ? "unknown" : configuredMode;
    }

    const rateLimitInfo = globalStore.get(atoms.waveAIRateLimitInfoAtom);
    const hasPremium = !rateLimitInfo || rateLimitInfo.unknown || rateLimitInfo.preq > 0;
    const fallback = hasPremium ? "waveai@balanced" : "waveai@quick";
    let mode = configuredMode ?? fallback;
    if (!hasPremium && mode.startsWith("waveai@")) {
        mode = "waveai@quick";
    }
    const modeConfigs = globalStore.get(atoms.waveaiModeConfigAtom);
    return modeConfigs != null && mode in modeConfigs ? mode : fallback;
}
