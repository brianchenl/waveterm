// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
)

func TestCmdInteractiveShellUsesWaveStartupScript(t *testing.T) {
	got := makeLocalInteractiveShellArgs(shellutil.ShellType_cmd, []string{"/A"}, CommandOptsType{})
	want := []string{"/A", "/D", "/Q", "/V:OFF", "/K", `call "%WAVETERM_CMD_INIT%"`}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("makeLocalInteractiveShellArgs(cmd) = %#v, want %#v", got, want)
	}
}

func TestWindowsShellCommandArgsUseNativeCommandFlags(t *testing.T) {
	if got, want := makeLocalCommandArgs(shellutil.ShellType_cmd, []string{"/A"}, "echo hello"), []string{"/A", "/D", "/V:OFF", "/S", "/C", "echo hello"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("makeLocalCommandArgs(cmd) = %#v, want %#v", got, want)
	}
	if got, want := makeLocalCommandArgs(shellutil.ShellType_pwsh, []string{"-NoLogo"}, "Get-Location"), []string{"-NoLogo", "-Command", "Get-Location"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("makeLocalCommandArgs(pwsh) = %#v, want %#v", got, want)
	}
}
