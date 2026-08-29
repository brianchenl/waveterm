// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestBuildChatHTTPRequestIncludesThinkingParameters(t *testing.T) {
	req, err := buildChatHTTPRequest(context.Background(), []ChatRequestMessage{{Role: "user", Content: "hello"}}, uctypes.WaveChatOpts{
		Config: uctypes.AIOptsType{
			Provider:        uctypes.AIProvider_DeepSeek,
			APIType:         uctypes.APIType_OpenAIChat,
			Model:           "deepseek-v4-pro",
			Endpoint:        "https://example.com/chat/completions",
			APIToken:        "test-token",
			ThinkingType:    uctypes.ThinkingTypeEnabled,
			ReasoningEffort: uctypes.ReasoningEffortMax,
		},
	})
	if err != nil {
		t.Fatalf("buildChatHTTPRequest returned error: %v", err)
	}

	var body map[string]any
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	thinking, ok := body["thinking"].(map[string]any)
	if !ok || thinking["type"] != "enabled" {
		t.Fatalf("expected thinking.type=enabled, got %#v", body["thinking"])
	}
	if body["reasoning_effort"] != "max" {
		t.Fatalf("expected reasoning_effort=max, got %#v", body["reasoning_effort"])
	}
}

func TestBuildChatHTTPRequestIdentifiesWaveForKimiCode(t *testing.T) {
	req, err := buildChatHTTPRequest(context.Background(), []ChatRequestMessage{{Role: "user", Content: "hello"}}, uctypes.WaveChatOpts{
		Config: uctypes.AIOptsType{
			Provider: uctypes.AIProvider_Kimi,
			APIType:  uctypes.APIType_OpenAIChat,
			Model:    "kimi-for-coding",
			Endpoint: "https://api.kimi.com/coding/v1/chat/completions",
			APIToken: "test-token",
		},
	})
	if err != nil {
		t.Fatalf("buildChatHTTPRequest returned error: %v", err)
	}
	if req.Header.Get("User-Agent") == "" {
		t.Fatal("expected Kimi Code requests to identify Wave Terminal")
	}
}

func TestChatRequestMessagePreservesReasoningContent(t *testing.T) {
	original := ChatRequestMessage{
		Role:             "assistant",
		Content:          "final answer",
		ReasoningContent: "reasoning trace",
	}
	b, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal message: %v", err)
	}

	var decoded ChatRequestMessage
	if err := json.Unmarshal(b, &decoded); err != nil {
		t.Fatalf("unmarshal message: %v", err)
	}
	if decoded.ReasoningContent != original.ReasoningContent {
		t.Fatalf("expected reasoning content %q, got %q", original.ReasoningContent, decoded.ReasoningContent)
	}
}

func TestConvertAIChatToUIChatIncludesReasoning(t *testing.T) {
	uiChat, err := ConvertAIChatToUIChat(uctypes.AIChat{
		ChatId:  "chat-1",
		APIType: uctypes.APIType_OpenAIChat,
		Model:   "kimi-for-coding",
		NativeMessages: []uctypes.GenAIMessage{&StoredChatMessage{
			MessageId: "message-1",
			Message: ChatRequestMessage{
				Role:             "assistant",
				Content:          "final answer",
				ReasoningContent: "reasoning trace",
			},
		}},
	})
	if err != nil {
		t.Fatalf("ConvertAIChatToUIChat returned error: %v", err)
	}
	if len(uiChat.Messages) != 1 || len(uiChat.Messages[0].Parts) != 2 {
		t.Fatalf("expected one message with reasoning and text, got %#v", uiChat.Messages)
	}
	if uiChat.Messages[0].Parts[0].Type != "reasoning" || uiChat.Messages[0].Parts[0].Text != "reasoning trace" {
		t.Fatalf("expected reasoning part first, got %#v", uiChat.Messages[0].Parts[0])
	}
}
