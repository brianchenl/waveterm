// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"strings"
	"testing"
)

func TestZshAIKeybindingEditsCurrentLineWithoutExecuting(t *testing.T) {
	required := []string{
		`local buffer="$BUFFER"`,
		`[[ -z "$buffer" ]] && return`,
		`replacement=$(printf '%s' "$buffer" | wsh ai --stdin --shell zsh) || {`,
		`zle redisplay`,
		`return 1`,
		`BUFFER="$replacement"`,
		`CURSOR=${#BUFFER}`,
		`zle -N _waveterm_ai`,
		"bindkey $'\\e[24;2~' _waveterm_ai",
	}
	requireSnippetsInOrder(t, "zsh", ZshStartup_Zshrc, required)
	if strings.Contains(ZshStartup_Zshrc, "accept-line") {
		t.Error("zsh AI line editor must not execute the replacement")
	}
}

func TestBashAIKeybindingEditsCurrentLineWithoutExecuting(t *testing.T) {
	required := []string{
		`local buffer="$READLINE_LINE"`,
		`[[ -z "$buffer" ]] && return`,
		`replacement=$(printf '%s' "$buffer" | wsh ai --stdin --shell bash) || return`,
		`READLINE_LINE="$replacement"`,
		`READLINE_POINT=${#READLINE_LINE}`,
		`bind -x '"\e[24;2~":_waveterm_ai'`,
	}
	requireSnippetsInOrder(t, "bash", BashStartup_Bashrc, required)
	if strings.Contains(BashStartup_Bashrc, "accept-line") {
		t.Error("bash AI line editor must not execute the replacement")
	}
}

func TestFishAIKeybindingEditsCurrentLineWithoutExecuting(t *testing.T) {
	required := []string{
		`set -l buffer (commandline)`,
		`test -z "$buffer"; and return`,
		`set -l replacement (printf '%s' "$buffer" | wsh ai --stdin --shell fish)`,
		`set -l ai_status $status`,
		`test $ai_status -eq 0; or return`,
		`commandline --replace -- "$replacement"`,
		`commandline --cursor (string length -- "$replacement")`,
		`bind \e\[24\;2~ _waveterm_ai`,
	}
	requireSnippetsInOrder(t, "fish", FishStartup_Wavefish, required)
	if strings.Contains(FishStartup_Wavefish, "commandline -f execute") {
		t.Error("fish AI line editor must not execute the replacement")
	}
}

func TestPowerShellAIKeybindingEditsCurrentLineWithoutExecuting(t *testing.T) {
	required := []string{
		`function Global:_waveterm_ai {`,
		`[Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$buffer, [ref]$cursor)`,
		`if ([string]::IsNullOrWhiteSpace($buffer)) { return }`,
		`$previousOutputEncoding = $OutputEncoding`,
		`$OutputEncoding = New-Object System.Text.UTF8Encoding($false)`,
		`$replacement = $buffer | wsh ai --stdin --shell pwsh`,
		`$OutputEncoding = $previousOutputEncoding`,
		`if ($aiExitCode -ne 0) {`,
		`[Microsoft.PowerShell.PSConsoleReadLine]::Replace(0, $buffer.Length, $replacement)`,
		`[Microsoft.PowerShell.PSConsoleReadLine]::SetCursorPosition($replacement.Length)`,
		`Set-PSReadLineKeyHandler -Chord Shift+F12 -ScriptBlock $function:_waveterm_ai`,
	}
	requireSnippetsInOrder(t, "powershell", PwshStartup_wavepwsh, required)

	aiStart := strings.Index(PwshStartup_wavepwsh, `function Global:_waveterm_ai {`)
	if aiStart == -1 {
		t.Fatal("powershell AI key handler start not found")
	}
	aiEnd := strings.Index(PwshStartup_wavepwsh[aiStart:], `Set-PSReadLineKeyHandler -Chord Shift+F12`)
	if aiEnd == -1 {
		t.Fatal("powershell AI key handler bounds not found")
	}
	if strings.Contains(PwshStartup_wavepwsh[aiStart:aiStart+aiEnd], "AcceptLine") {
		t.Error("powershell AI line editor must not execute the replacement")
	}
}

func TestPowerShellIntegrationTracksPromptAndCommandState(t *testing.T) {
	required := []string{
		`Set-PSReadLineKeyHandler -Chord Enter`,
		`[Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$buffer, [ref]$cursor)`,
		`[System.Management.Automation.Language.Parser]::ParseInput`,
		`$parseErrors | Where-Object { $_.IncompleteInput }`,
		`_waveterm_si_command_start $buffer`,
		`[Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()`,
		"`\"integration`\":true",
		`_waveterm_si_prompt $lastCommandSucceeded`,
	}
	requireSnippetsInOrder(t, "powershell", PwshStartup_wavepwsh, required)
}

func TestCmdPromptIntegrationAdvertisesShellCwdAndReadiness(t *testing.T) {
	required := []string{
		`@echo off`,
		`set "PATH={{.WSHBINDIR_CMD}};%PATH%"`,
		`call wsh token "%WAVETERM_SWAPTOKEN%" cmd`,
		`set "WAVETERM_SWAPTOKEN="`,
		`$E]16162;S;cmd$E\`,
		`$E]16162;P;$P$E\`,
		`$E]16162;A$E\`,
		`$P$G`,
	}
	requireSnippetsInOrder(t, "cmd", CmdStartup_Wavecmd, required)
}

func TestCmdShellTypeDetection(t *testing.T) {
	for _, path := range []string{"cmd", "cmd.exe", "/Windows/System32/CMD.EXE"} {
		if got := GetShellTypeFromShellPath(path); got != ShellType_cmd {
			t.Errorf("GetShellTypeFromShellPath(%q) = %q, want %q", path, got, ShellType_cmd)
		}
	}
}

func requireSnippetsInOrder(t *testing.T, shell string, script string, snippets []string) {
	t.Helper()
	remaining := script
	for _, snippet := range snippets {
		index := strings.Index(remaining, snippet)
		if index == -1 {
			t.Fatalf("%s AI line editor is missing or misorders %q", shell, snippet)
		}
		remaining = remaining[index+len(snippet):]
	}
}
