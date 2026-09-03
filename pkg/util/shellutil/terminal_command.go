// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

const MaxTerminalCommandSuggestionBytes = 8192

// ValidateTerminalCommandSuggestion removes provider-added boundary spaces and
// line endings, then validates text before it can enter a shell edit buffer.
func ValidateTerminalCommandSuggestion(response string) (string, error) {
	if !utf8.ValidString(response) {
		return "", fmt.Errorf("AI returned a terminal command containing invalid UTF-8")
	}
	if len(response) > MaxTerminalCommandSuggestionBytes {
		return "", fmt.Errorf("AI returned a terminal command longer than %d bytes", MaxTerminalCommandSuggestionBytes)
	}
	command := strings.Trim(response, " \r\n")
	if command == "" {
		return "", fmt.Errorf("AI returned an empty terminal command")
	}
	for byteIndex, r := range command {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return "", fmt.Errorf(
				"AI returned a terminal command containing control or line-separator character U+%04X at byte %d of %d",
				r,
				byteIndex,
				len(command),
			)
		}
	}
	if strings.HasPrefix(command, "```") || strings.HasPrefix(command, "~~~") ||
		(strings.HasPrefix(command, "`") && strings.HasSuffix(command, "`")) {
		return "", fmt.Errorf("AI returned a Markdown-wrapped terminal command")
	}
	if strings.Contains("{[\"", command[:1]) && json.Valid([]byte(command)) {
		return "", fmt.Errorf("AI returned a JSON-wrapped terminal command")
	}
	return command, nil
}
