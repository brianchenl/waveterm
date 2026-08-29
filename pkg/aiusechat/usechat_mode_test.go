// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestApplyProviderDefaultsGroq(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_Groq,
	}
	applyProviderDefaults(&config)
	if config.APIType != uctypes.APIType_OpenAIChat {
		t.Fatalf("expected API type %q, got %q", uctypes.APIType_OpenAIChat, config.APIType)
	}
	if config.Endpoint != GroqChatEndpoint {
		t.Fatalf("expected endpoint %q, got %q", GroqChatEndpoint, config.Endpoint)
	}
	if config.APITokenSecretName != GroqAPITokenSecretName {
		t.Fatalf("expected API token secret name %q, got %q", GroqAPITokenSecretName, config.APITokenSecretName)
	}
}

func TestApplyProviderDefaultsKeepsProxyURL(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_OpenAI,
		Model:    "gpt-5-mini",
		ProxyURL: "http://localhost:8080",
	}
	applyProviderDefaults(&config)
	if config.ProxyURL != "http://localhost:8080" {
		t.Fatalf("expected proxy URL to be preserved, got %q", config.ProxyURL)
	}
}

func TestApplyProviderDefaultsDeepSeek(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_DeepSeek,
		Model:    "deepseek-v4-pro",
	}
	applyProviderDefaults(&config)

	if config.APIType != uctypes.APIType_OpenAIChat {
		t.Fatalf("expected API type %q, got %q", uctypes.APIType_OpenAIChat, config.APIType)
	}
	if config.Endpoint != DeepSeekChatEndpoint {
		t.Fatalf("expected endpoint %q, got %q", DeepSeekChatEndpoint, config.Endpoint)
	}
	if config.APITokenSecretName != DeepSeekAPITokenSecretName {
		t.Fatalf("expected secret name %q, got %q", DeepSeekAPITokenSecretName, config.APITokenSecretName)
	}
	if len(config.SwitchCompat) != 1 || config.SwitchCompat[0] != "deepseek" {
		t.Fatalf("expected DeepSeek switch compatibility, got %#v", config.SwitchCompat)
	}
}

func TestApplyProviderDefaultsKimi(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_Kimi,
		Model:    "kimi-for-coding",
	}
	applyProviderDefaults(&config)

	if config.APIType != uctypes.APIType_OpenAIChat {
		t.Fatalf("expected API type %q, got %q", uctypes.APIType_OpenAIChat, config.APIType)
	}
	if config.Endpoint != KimiCodeChatEndpoint {
		t.Fatalf("expected endpoint %q, got %q", KimiCodeChatEndpoint, config.Endpoint)
	}
	if config.APITokenSecretName != KimiCodeAPITokenSecretName {
		t.Fatalf("expected secret name %q, got %q", KimiCodeAPITokenSecretName, config.APITokenSecretName)
	}
	if len(config.SwitchCompat) != 1 || config.SwitchCompat[0] != "kimi-code" {
		t.Fatalf("expected Kimi switch compatibility, got %#v", config.SwitchCompat)
	}
	if len(config.Capabilities) != 2 || config.Capabilities[0] != uctypes.AICapabilityTools || config.Capabilities[1] != uctypes.AICapabilityImages {
		t.Fatalf("expected tools and images capabilities, got %#v", config.Capabilities)
	}
	if config.Thinking == nil || config.Thinking.Type != uctypes.ThinkingTypeEnabled || config.Thinking.Keep != uctypes.ThinkingKeepAll {
		t.Fatalf("expected preserved thinking to be enabled, got %#v", config.Thinking)
	}
}
