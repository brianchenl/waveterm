// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openai

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestBuildOpenAIHTTPRequestExplicitlyDisablesProviderStorage(t *testing.T) {
	chatOpts := uctypes.WaveChatOpts{
		ClientId:             "test-client",
		DisableProviderStore: true,
		Config: uctypes.AIOptsType{
			Model:    "test-model",
			Endpoint: "https://example.com/responses",
		},
	}
	req, err := buildOpenAIHTTPRequest(context.Background(), nil, chatOpts, nil)
	if err != nil {
		t.Fatalf("buildOpenAIHTTPRequest() error = %v", err)
	}
	body, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatalf("reading request body: %v", err)
	}
	if !strings.Contains(string(body), `"store":false`) {
		t.Fatalf("request body does not explicitly disable storage: %s", body)
	}
}
