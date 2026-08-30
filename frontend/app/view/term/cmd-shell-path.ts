// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function normalizeCmdShellPath(rawPath: string): string | null {
    if (
        rawPath.length === 0 ||
        rawPath.length > 1024 ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(rawPath) ||
        (!/^[a-zA-Z]:[\\/]/.test(rawPath) && !/^\\\\[^\\]/.test(rawPath))
    ) {
        return null;
    }
    if (/^[a-zA-Z]:[\\/]/.test(rawPath)) {
        return rawPath.replace(/\\/g, "/");
    }
    return rawPath;
}
