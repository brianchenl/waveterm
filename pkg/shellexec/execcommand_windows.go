// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package shellexec

import (
	"os/exec"
	"strings"
	"syscall"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
)

func makeLocalExecCommand(shellPath string, shellType string, args []string) *exec.Cmd {
	if shellType != shellutil.ShellType_cmd {
		return exec.Command(shellPath, args...)
	}
	cmd := exec.Command(shellPath)
	cmd.Args = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: buildCmdExeCommandLine(shellPath, args)}
	return cmd
}

func buildCmdExeCommandLine(shellPath string, args []string) string {
	parts := []string{syscall.EscapeArg(shellPath)}
	for index, arg := range args {
		parts = append(parts, syscall.EscapeArg(arg))
		if strings.EqualFold(arg, "/C") || strings.EqualFold(arg, "/K") {
			if index+1 < len(args) {
				command := args[index+1]
				if strings.EqualFold(arg, "/C") {
					parts = append(parts, `"`+command+`"`)
				} else {
					parts = append(parts, command)
				}
			}
			break
		}
	}
	return strings.Join(parts, " ")
}
