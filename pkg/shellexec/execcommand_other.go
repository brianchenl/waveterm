// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package shellexec

import "os/exec"

func makeLocalExecCommand(shellPath string, _ string, args []string) *exec.Cmd {
	return exec.Command(shellPath, args...)
}
