// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestTerminalCommandSuggestCommandRejectsEmptyInput(t *testing.T) {
	_, err := WshServerImpl.TerminalCommandSuggestCommand(context.Background(), wshrpc.CommandTerminalCommandSuggestData{
		Command: " \t\n",
		Cwd:     "/repo",
		Shell:   "/bin/zsh",
	})
	if err == nil {
		t.Fatal("TerminalCommandSuggestCommand() error = nil, want empty-input error")
	}
}
