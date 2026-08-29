// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore_test

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
)

const expectedStarterWebURL = "https://codeup.aliyun.com/"

func TestFreshInstallWebDefaults(t *testing.T) {
	settings, configErrs := wconfig.ReadDefaultsConfigFile(wconfig.SettingsFile)
	if len(configErrs) != 0 {
		t.Fatalf("read embedded default settings: %v", configErrs)
	}
	if got := settings.GetString("web:defaulturl", ""); got != expectedStarterWebURL {
		t.Fatalf("default web URL = %q, want %q", got, expectedStarterWebURL)
	}

	for _, item := range wcore.GetStarterLayout() {
		if item.BlockDef == nil || item.BlockDef.Meta.GetString(waveobj.MetaKey_View, "") != "web" {
			continue
		}
		if got := item.BlockDef.Meta.GetString(waveobj.MetaKey_Url, ""); got != expectedStarterWebURL {
			t.Fatalf("starter workspace web URL = %q, want %q", got, expectedStarterWebURL)
		}
		return
	}

	t.Fatal("starter workspace does not contain a web block")
}
