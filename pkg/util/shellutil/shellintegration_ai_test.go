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
