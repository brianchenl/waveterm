// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"strings"
	"testing"
)

func TestValidateTerminalCommandSuggestionAcceptsPlainLineAndProviderLineEndings(t *testing.T) {
	for _, response := range []string{" git status ", "git status\n", "git status\r\n", "git status\n\n", "\ngit status\n", "\r\n git status\n "} {
		got, err := ValidateTerminalCommandSuggestion(response)
		if err != nil {
			t.Fatalf("ValidateTerminalCommandSuggestion(%q) error = %v", response, err)
		}
		if got != "git status" {
			t.Fatalf("ValidateTerminalCommandSuggestion(%q) = %q", response, got)
		}
	}
}

func TestValidateTerminalCommandSuggestionRejectsUnsafeOutput(t *testing.T) {
	tests := []string{
		"",
		"git status\nrm -rf /tmp/example",
		"git\tstatus",
		"printf '\x1b[31m'",
		"git status\u0085",
		"git status\u2028",
		"```sh\ngit status\n```",
		"~~~sh\ngit status\n~~~",
		"`git status`",
		`{"command":"git status"}`,
		string([]byte{0xff, 0xfe}),
		strings.Repeat("x", MaxTerminalCommandSuggestionBytes+1),
	}
	for _, response := range tests {
		if _, err := ValidateTerminalCommandSuggestion(response); err == nil {
			t.Fatalf("ValidateTerminalCommandSuggestion(%q) error = nil", response)
		}
	}
}

func TestValidateTerminalCommandSuggestionCountsSurroundingWhitespaceInLimit(t *testing.T) {
	response := " " + strings.Repeat("x", MaxTerminalCommandSuggestionBytes) + " "
	if _, err := ValidateTerminalCommandSuggestion(response); err == nil {
		t.Fatal("ValidateTerminalCommandSuggestion() accepted an oversized raw response")
	}
}
