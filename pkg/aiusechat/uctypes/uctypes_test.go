// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package uctypes

import "testing"

func TestAreModelsCompatibleForDirectReasoningProviders(t *testing.T) {
	tests := []struct {
		name   string
		model1 string
		model2 string
	}{
		{name: "DeepSeek", model1: "deepseek-v4-flash", model2: "deepseek-v4-pro"},
		{name: "Kimi Platform", model1: "kimi-k2.6", model2: "kimi-k3"},
		{name: "Kimi Code", model1: "k3-256k", model2: "kimi-for-coding"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if !AreModelsCompatible(APIType_OpenAIChat, tc.model1, tc.model2) {
				t.Fatalf("expected %s and %s to be switch-compatible", tc.model1, tc.model2)
			}
		})
	}
}
