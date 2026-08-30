// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package shellexec

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
)

func TestMakeLocalExecCommandUsesRawCmdExeCommandLine(t *testing.T) {
	cmd := makeLocalExecCommand(`C:\Windows\System32\cmd.exe`, shellutil.ShellType_cmd, []string{
		"/D", "/V:OFF", "/S", "/C", `echo "hello world" && echo done`,
	})
	if len(cmd.Args) != 0 {
		t.Fatalf("CMD Args = %#v, want empty when SysProcAttr.CmdLine is used", cmd.Args)
	}
	if cmd.SysProcAttr == nil || !strings.Contains(cmd.SysProcAttr.CmdLine, `/C "echo "hello world" && echo done"`) {
		t.Fatalf("CMD raw command line was not preserved: %#v", cmd.SysProcAttr)
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("executing raw CMD command line: %v\n%s", err, output)
	}
	if !strings.Contains(string(output), `"hello world"`) || !strings.Contains(string(output), "done") {
		t.Fatalf("CMD command output was corrupted: %q", output)
	}
}

func TestMakeLocalExecCommandStartsQuotedBatchPathThroughEnvironment(t *testing.T) {
	scriptDir := filepath.Join(t.TempDir(), "startup with spaces")
	if err := os.MkdirAll(scriptDir, 0o755); err != nil {
		t.Fatal(err)
	}
	scriptPath := filepath.Join(scriptDir, "wave startup.cmd")
	if err := os.WriteFile(scriptPath, []byte("@echo off\r\necho startup-ok\r\nexit\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := makeLocalExecCommand("cmd.exe", shellutil.ShellType_cmd, []string{
		"/D", "/Q", "/V:OFF", "/K", `call "%WAVETERM_CMD_INIT%"`,
	})
	cmd.Env = append(os.Environ(), "WAVETERM_CMD_INIT="+scriptPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("starting quoted CMD batch path: %v\n%s", err, output)
	}
	if !strings.Contains(string(output), "startup-ok") {
		t.Fatalf("CMD startup script did not run: %q", output)
	}
}
