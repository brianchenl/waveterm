// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"
)

func TestReadAICommandInputReadsPipedStdin(t *testing.T) {
	got, err := readAICommandInput(strings.NewReader("from stdin\n"), true, false)
	if err != nil {
		t.Fatalf("readAICommandInput() error = %v", err)
	}
	if got != "from stdin" {
		t.Fatalf("readAICommandInput() = %q, want %q", got, "from stdin")
	}
}

func TestReadAICommandInputReadsExplicitStdin(t *testing.T) {
	got, err := readAICommandInput(strings.NewReader("from explicit stdin"), false, true)
	if err != nil {
		t.Fatalf("readAICommandInput() error = %v", err)
	}
	if got != "from explicit stdin" {
		t.Fatalf("readAICommandInput() = %q, want %q", got, "from explicit stdin")
	}
}

func TestReadAICommandInputRejectsMissingStdin(t *testing.T) {
	if _, err := readAICommandInput(strings.NewReader("ignored"), false, false); err == nil {
		t.Fatal("readAICommandInput() error = nil, want missing-stdin error")
	}
}

func TestReadAICommandInputRejectsEmptyStdin(t *testing.T) {
	if _, err := readAICommandInput(strings.NewReader(" \n\t"), true, false); err == nil {
		t.Fatal("readAICommandInput() error = nil, want empty-stdin error")
	}
}

func TestAICommandRejectsArguments(t *testing.T) {
	if aiCmd.Args == nil {
		t.Fatal("ai command has no argument validator; want stdin-only arguments contract")
	}
	if err := aiCmd.Args(aiCmd, []string{"sensitive shell buffer"}); err == nil {
		t.Fatal("ai command accepted argv input, want stdin-only error")
	}
}

func TestAICommandShellFlagOverridesEnvironment(t *testing.T) {
	if aiCmd.Flags().Lookup("shell") == nil {
		t.Fatal("ai command does not register --shell")
	}
	if got := resolveAIShell("zsh", "/bin/bash"); got != "zsh" {
		t.Fatalf("resolveAIShell() = %q, want explicit shell %q", got, "zsh")
	}
}

func TestResolveAIShellFallsBackToEnvironment(t *testing.T) {
	if got := resolveAIShell("", "/bin/fish"); got != "/bin/fish" {
		t.Fatalf("resolveAIShell() = %q, want environment shell %q", got, "/bin/fish")
	}
}
