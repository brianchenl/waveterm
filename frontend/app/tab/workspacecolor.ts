// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const DefaultWorkspaceColor = "#B08A3E";
const LegacyDefaultWorkspaceColor = "#58C142";
const DefaultWorkspaceIcon = "custom@wave-logo-solid";

export function getWorkspaceDisplayColor(workspace: Pick<Workspace, "icon" | "color">): string {
    if (
        workspace.icon === DefaultWorkspaceIcon &&
        workspace.color.toUpperCase() === LegacyDefaultWorkspaceColor.toUpperCase()
    ) {
        return DefaultWorkspaceColor;
    }
    return workspace.color;
}
