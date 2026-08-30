// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const terminalCommandSuggestRPCTimeout = 120000

var aiStdinFlag bool
var aiShellFlag string

var aiCmd = &cobra.Command{
	Use:   "ai --stdin",
	Short: "Suggest an enhanced terminal command from stdin",
	Long: `Suggest a terminal command without executing it.

Input is read only from stdin. Piped stdin is detected automatically; --stdin
can be used to state the stdin contract explicitly. The suggestion is printed
as a single line on stdout.`,
	Args:                  cobra.NoArgs,
	RunE:                  aiRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

func init() {
	rootCmd.AddCommand(aiCmd)
	aiCmd.Flags().BoolVar(&aiStdinFlag, "stdin", false, "read the command to enhance from stdin")
	aiCmd.Flags().StringVar(&aiShellFlag, "shell", "", "shell syntax for the suggestion (defaults to $SHELL)")
}

func resolveAIShell(explicitShell string, environmentShell string) string {
	if shell := strings.TrimSpace(explicitShell); shell != "" {
		return shell
	}
	return strings.TrimSpace(environmentShell)
}

func readAICommandInput(stdin io.Reader, stdinAvailable bool, stdinRequested bool) (string, error) {
	if !stdinAvailable && !stdinRequested {
		return "", fmt.Errorf("no stdin input; pipe a command or use --stdin")
	}
	data, err := io.ReadAll(stdin)
	if err != nil {
		return "", fmt.Errorf("reading command from stdin: %w", err)
	}
	command := strings.TrimSpace(string(data))
	if command == "" {
		return "", fmt.Errorf("stdin command input is empty")
	}
	return command, nil
}

func isAIStdinAvailable() bool {
	info, err := os.Stdin.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice == 0
}

func aiRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("ai", rtnErr == nil)
	}()

	command, err := readAICommandInput(os.Stdin, isAIStdinAvailable(), aiStdinFlag)
	if err != nil {
		return err
	}
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("getting current working directory: %w", err)
	}
	request := wshrpc.CommandTerminalCommandSuggestData{
		Command: command,
		Cwd:     cwd,
		Shell:   resolveAIShell(aiShellFlag, os.Getenv("SHELL")),
	}
	response, err := RpcClient.SendRpcRequest("terminalcommandsuggest", request, &wshrpc.RpcOpts{
		Route:   wshutil.DefaultRoute,
		Timeout: terminalCommandSuggestRPCTimeout,
	})
	if err != nil {
		return fmt.Errorf("requesting terminal command suggestion: %w", err)
	}
	var suggestion string
	if err := utilfn.ReUnmarshal(&suggestion, response); err != nil {
		return fmt.Errorf("decoding terminal command suggestion: %w", err)
	}
	if suggestion == "" {
		return fmt.Errorf("terminal command suggestion is empty")
	}
	suggestion, err = shellutil.ValidateTerminalCommandSuggestion(suggestion)
	if err != nil {
		return fmt.Errorf("validating terminal command suggestion: %w", err)
	}
	WriteStdout("%s\n", suggestion)
	return nil
}
