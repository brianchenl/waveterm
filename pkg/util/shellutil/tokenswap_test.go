// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"strings"
	"testing"
)

func TestEncodeEnvVarsForCmdEscapesBatchMetacharacters(t *testing.T) {
	got, err := EncodeEnvVarsForShell(ShellType_cmd, map[string]string{
		"WAVETERM_JWT": `a%b!c&d|e<f>g(h)i^j"k`,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, snippet := range []string{`set WAVETERM_JWT=`, `%%`, `^&`, `^|`, `^<`, `^>`, `^(`, `^)`, `^^`, `^"`} {
		if !strings.Contains(got, snippet) {
			t.Errorf("encoded CMD environment is missing %q: %q", snippet, got)
		}
	}
}

func TestEncodeEnvVarsForCmdRejectsMultilineValues(t *testing.T) {
	if _, err := EncodeEnvVarsForShell(ShellType_cmd, map[string]string{"BAD": "one\r\ntwo"}); err == nil {
		t.Fatal("EncodeEnvVarsForShell(cmd) accepted a multiline environment value")
	}
}
