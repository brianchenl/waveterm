// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

type terminalCommandTestMessage struct {
	id   string
	role string
}

func (m *terminalCommandTestMessage) GetMessageId() string       { return m.id }
func (m *terminalCommandTestMessage) GetUsage() *uctypes.AIUsage { return nil }
func (m *terminalCommandTestMessage) GetRole() string            { return m.role }

type terminalCommandTestBackend struct {
	t              *testing.T
	runCount       int
	chatID         string
	wantUserPrompt string
	assistantParts []uctypes.UIMessagePart
	stopReason     *uctypes.WaveStopReason
	omitStopReason bool
}

func (b *terminalCommandTestBackend) RunChatStep(
	_ context.Context,
	_ *sse.SSEHandlerCh,
	opts uctypes.WaveChatOpts,
	_ *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	b.runCount++
	b.chatID = opts.ChatId
	if len(opts.Tools) != 0 || len(opts.TabTools) != 0 || opts.AllowNativeWebSearch {
		b.t.Fatalf("terminal command chat enabled tools or web search: %+v", opts)
	}
	if opts.Config.HasCapability(uctypes.AICapabilityTools) {
		b.t.Fatal("terminal command chat retained the tools capability")
	}
	if opts.TabStateGenerator != nil || opts.BuilderAppGenerator != nil {
		b.t.Fatal("terminal command chat configured a history/context generator")
	}
	if !opts.DisableProviderStore {
		b.t.Fatal("terminal command chat did not disable provider storage")
	}
	if !opts.DisableRedirects {
		b.t.Fatal("terminal command chat did not disable HTTP redirects")
	}
	if len(opts.SystemPrompt) != 1 || opts.SystemPrompt[0] != terminalCommandSystemPrompt {
		b.t.Fatalf("SystemPrompt = %#v, want dedicated terminal prompt", opts.SystemPrompt)
	}
	chat := chatstore.DefaultChatStore.Get(opts.ChatId)
	if chat == nil || len(chat.NativeMessages) != 1 {
		b.t.Fatalf("temporary chat has %#v messages, want exactly current request", chat)
	}
	stopReason := b.stopReason
	if stopReason == nil && !b.omitStopReason {
		stopReason = &uctypes.WaveStopReason{Kind: uctypes.StopKindDone}
	}
	return stopReason, []uctypes.GenAIMessage{&terminalCommandTestMessage{id: "assistant", role: "assistant"}}, nil, nil
}

func (b *terminalCommandTestBackend) UpdateToolUseData(string, string, uctypes.UIMessageDataToolUse) error {
	return nil
}
func (b *terminalCommandTestBackend) RemoveToolUseCall(string, string) error { return nil }
func (b *terminalCommandTestBackend) ConvertToolResultsToNativeChatMessage([]uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	return nil, nil
}
func (b *terminalCommandTestBackend) ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	if len(message.Parts) != 1 || message.Parts[0].Text != b.wantUserPrompt {
		b.t.Fatalf("user prompt = %#v, want %q", message.Parts, b.wantUserPrompt)
	}
	return &terminalCommandTestMessage{id: message.MessageId, role: "user"}, nil
}
func (b *terminalCommandTestBackend) GetFunctionCallInputByToolCallId(uctypes.AIChat, string) *uctypes.AIFunctionCallInput {
	return nil
}
func (b *terminalCommandTestBackend) ConvertAIChatToUIChat(chat uctypes.AIChat) (*uctypes.UIChat, error) {
	parts := b.assistantParts
	if parts == nil {
		parts = []uctypes.UIMessagePart{{Type: "text", Text: `{"command":"git status"}`}}
	}
	return &uctypes.UIChat{
		ChatId: chat.ChatId,
		Messages: []uctypes.UIMessage{{
			Role:  "assistant",
			Parts: parts,
		}},
	}, nil
}

func TestResolveTerminalCommandAIModeUsesConfiguredCustomDefault(t *testing.T) {
	config := &wconfig.FullConfigType{
		Settings: wconfig.SettingsType{WaveAiDefaultMode: "ollama-coder"},
		WaveAIModes: map[string]wconfig.AIModeConfigType{
			"ollama-coder": {
				Provider: uctypes.AIProvider_Custom,
				Endpoint: "http://127.0.0.1:11434/v1/chat/completions",
			},
		},
	}

	got, _, err := resolveTerminalCommandAIMode(*config)
	if err != nil {
		t.Fatalf("resolveTerminalCommandAIMode() error = %v", err)
	}
	if got != "ollama-coder" {
		t.Fatalf("resolveTerminalCommandAIMode() = %q, want %q", got, "ollama-coder")
	}
}

func TestResolveTerminalCommandAIModeRejectsWaveCloudAndMissingCustomMode(t *testing.T) {
	tests := []struct {
		name   string
		config *wconfig.FullConfigType
	}{
		{name: "no default", config: &wconfig.FullConfigType{}},
		{
			name: "wave default",
			config: &wconfig.FullConfigType{
				Settings: wconfig.SettingsType{WaveAiDefaultMode: uctypes.AIModeQuick},
				WaveAIModes: map[string]wconfig.AIModeConfigType{
					uctypes.AIModeQuick: {Provider: uctypes.AIProvider_Wave, WaveAICloud: true},
				},
			},
		},
		{
			name: "unknown custom default",
			config: &wconfig.FullConfigType{
				Settings:    wconfig.SettingsType{WaveAiDefaultMode: "missing-local-mode"},
				WaveAIModes: map[string]wconfig.AIModeConfigType{},
			},
		},
		{
			name: "custom key backed by wave provider",
			config: &wconfig.FullConfigType{
				Settings: wconfig.SettingsType{WaveAiDefaultMode: "misleading-custom-key"},
				WaveAIModes: map[string]wconfig.AIModeConfigType{
					"misleading-custom-key": {Provider: uctypes.AIProvider_Wave},
				},
			},
		},
		{
			name: "custom provider pointing at Wave Cloud",
			config: &wconfig.FullConfigType{
				Settings: wconfig.SettingsType{WaveAiDefaultMode: "masked-wave-cloud"},
				WaveAIModes: map[string]wconfig.AIModeConfigType{
					"masked-wave-cloud": {
						Provider: uctypes.AIProvider_Custom,
						APIType:  uctypes.APIType_OpenAIResponses,
						Endpoint: uctypes.DefaultAIEndpoint,
					},
				},
			},
		},
		{
			name: "custom provider pointing at trailing-dot Wave Cloud",
			config: &wconfig.FullConfigType{
				Settings: wconfig.SettingsType{WaveAiDefaultMode: "masked-wave-cloud-dot"},
				WaveAIModes: map[string]wconfig.AIModeConfigType{
					"masked-wave-cloud-dot": {
						Provider: uctypes.AIProvider_Custom,
						APIType:  uctypes.APIType_OpenAIResponses,
						Endpoint: "https://cfapi.waveterm.dev./api/waveai",
					},
				},
			},
		},
		{
			name: "unsupported provider protocol",
			config: &wconfig.FullConfigType{
				Settings: wconfig.SettingsType{WaveAiDefaultMode: "custom-gemini"},
				WaveAIModes: map[string]wconfig.AIModeConfigType{
					"custom-gemini": {
						Provider: uctypes.AIProvider_Custom,
						APIType:  uctypes.APIType_GoogleGemini,
						Endpoint: "http://127.0.0.1:9000/gemini",
					},
				},
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := resolveTerminalCommandAIMode(*tc.config); err == nil {
				t.Fatal("resolveTerminalCommandAIMode() error = nil, want local/custom model requirement")
			}
		})
	}
}

func TestResolveTerminalCommandAIModeRejectsIDNAWaveCloudSeparators(t *testing.T) {
	for _, separator := range []string{"。", "．", "｡"} {
		mode := "masked-idna-wave-cloud"
		config := wconfig.FullConfigType{
			Settings: wconfig.SettingsType{WaveAiDefaultMode: mode},
			WaveAIModes: map[string]wconfig.AIModeConfigType{
				mode: {
					Provider: uctypes.AIProvider_Custom,
					APIType:  uctypes.APIType_OpenAIResponses,
					Endpoint: "https://cfapi" + separator + "waveterm" + separator + "dev/api/waveai",
				},
			},
		}
		if _, _, err := resolveTerminalCommandAIMode(config); err == nil {
			t.Fatalf("resolveTerminalCommandAIMode() accepted Wave Cloud with separator %q", separator)
		}
	}
}

func TestParseTerminalCommandSuggestionRejectsPlainCommand(t *testing.T) {
	for _, response := range []string{"git status", "Run this: git status", "\t{\"command\":\"git status\"}"} {
		if _, err := parseTerminalCommandSuggestion(response); err == nil {
			t.Fatalf("parseTerminalCommandSuggestion(%q) accepted a plain-text response", response)
		}
	}
}

func TestParseTerminalCommandSuggestionAcceptsStrictJSONEnvelope(t *testing.T) {
	got, err := parseTerminalCommandSuggestion("{\n  \"command\": \"git status\"\n}\n")
	if err != nil {
		t.Fatalf("parseTerminalCommandSuggestion() error = %v", err)
	}
	if got != "git status" {
		t.Fatalf("parseTerminalCommandSuggestion() = %q, want %q", got, "git status")
	}
}

func TestParseTerminalCommandSuggestionAcceptsSingleFencedProviderFallback(t *testing.T) {
	response := "I cannot run commands here. Run this in your terminal:\n\n```bash\npwd\n```\n"
	got, err := parseTerminalCommandSuggestion(response)
	if err != nil {
		t.Fatalf("parseTerminalCommandSuggestion() error = %v", err)
	}
	if got != "pwd" {
		t.Fatalf("parseTerminalCommandSuggestion() = %q, want %q", got, "pwd")
	}
}

func TestParseTerminalCommandSuggestionAcceptsSingleFencedStrictJSONEnvelope(t *testing.T) {
	response := "```json\n{\n  \"command\": \"pwd\"\n}\n```"
	got, err := parseTerminalCommandSuggestion(response)
	if err != nil {
		t.Fatalf("parseTerminalCommandSuggestion() error = %v", err)
	}
	if got != "pwd" {
		t.Fatalf("parseTerminalCommandSuggestion() = %q, want %q", got, "pwd")
	}
}

func TestParseTerminalCommandSuggestionRejectsUnsafeFencedJSONEnvelope(t *testing.T) {
	for _, response := range []string{
		"```json\n{\"command\":\"pwd\",\"explanation\":\"safe\"}\n```",
		"```json\n{\"command\":\"pwd\\nwhoami\"}\n```",
	} {
		if _, err := parseTerminalCommandSuggestion(response); err == nil {
			t.Fatalf("parseTerminalCommandSuggestion(%q) error = nil, want strict fenced JSON rejection", response)
		}
	}
}

func TestParseTerminalCommandSuggestionRejectsUnsafeFencedProviderFallback(t *testing.T) {
	tests := []string{
		"Run:\n```bash\npwd\nwhoami\n```",
		"Run one:\n```bash\npwd\n```\nor two:\n```bash\nwhoami\n```",
		"Run:\n```bash\npwd\n```\nthen press Enter",
		"Run:\n```bash script\npwd\n```",
		"Run either:\n~~~bash\nwhoami\n~~~\nOr:\n```bash\npwd\n```",
		"\tRun:\n```bash\npwd\n```",
		"\x1b[31mRun:\n```bash\npwd\n```",
		"Run:\u2028```bash\npwd\n```",
	}
	for _, response := range tests {
		if _, err := parseTerminalCommandSuggestion(response); err == nil {
			t.Fatalf("parseTerminalCommandSuggestion(%q) error = nil, want fenced fallback rejection", response)
		}
	}
}

func TestParseTerminalCommandSuggestionAcceptsProviderTrailingLineEndings(t *testing.T) {
	for _, response := range []string{
		`{"command":"git status"}` + "\n",
		`{"command":"git status"}` + "\r\n",
		"\n" + `{"command":"git status"}` + "\n",
		"\r\n " + `{"command":"git status"}` + "\n ",
	} {
		got, err := parseTerminalCommandSuggestion(response)
		if err != nil || got != "git status" {
			t.Fatalf("parseTerminalCommandSuggestion(%q) = %q, %v", response, got, err)
		}
	}
}

func TestParseTerminalCommandSuggestionRejectsUnicodeLineSeparators(t *testing.T) {
	for _, separator := range []rune{'\u2028', '\u2029'} {
		response, _ := json.Marshal(map[string]string{"command": "git status" + string(separator)})
		if _, err := parseTerminalCommandSuggestion(string(response)); err == nil {
			t.Fatalf("parseTerminalCommandSuggestion() error = nil for %U, want line-separator rejection", separator)
		}
	}
}

func TestParseTerminalCommandSuggestionRejectsMarkdownFence(t *testing.T) {
	response, _ := json.Marshal(map[string]string{"command": "```git status```"})
	if _, err := parseTerminalCommandSuggestion(string(response)); err == nil {
		t.Fatal("parseTerminalCommandSuggestion() error = nil, want Markdown fence rejection")
	}
}

func TestParseTerminalCommandSuggestionRejectsInvalidJSONEnvelope(t *testing.T) {
	tests := []string{
		`{"command":"git status","explanation":"safe"}`,
		`{"command":"git status"} {"command":"pwd"}`,
		`{"command":"git status\nrm -rf /tmp/example"}`,
		`{"COMMAND":"git status"}`,
		`{"command":"git status","command":"pwd"}`,
		`{}`,
	}
	for _, response := range tests {
		if _, err := parseTerminalCommandSuggestion(response); err == nil {
			t.Fatalf("parseTerminalCommandSuggestion(%q) error = nil, want envelope rejection", response)
		}
	}
}

func TestParseTerminalCommandSuggestionRejectsMultilineCommand(t *testing.T) {
	response, _ := json.Marshal(map[string]string{"command": "git status\nrm -rf /tmp/example"})
	if _, err := parseTerminalCommandSuggestion(string(response)); err == nil {
		t.Fatal("parseTerminalCommandSuggestion() error = nil, want multiline rejection")
	}
}

func TestParseTerminalCommandSuggestionRejectsControlCharacters(t *testing.T) {
	tests := []string{
		"git\tstatus",
		"printf '\x1b[31m'",
		"git status\u0085",
	}
	for _, response := range tests {
		envelope, _ := json.Marshal(map[string]string{"command": response})
		if _, err := parseTerminalCommandSuggestion(string(envelope)); err == nil {
			t.Fatalf("parseTerminalCommandSuggestion(%q) error = nil, want control-character rejection", envelope)
		}
	}
}

func TestParseTerminalCommandSuggestionRejectsOver8192Bytes(t *testing.T) {
	if _, err := parseTerminalCommandSuggestion(strings.Repeat("x", 8193)); err == nil {
		t.Fatal("parseTerminalCommandSuggestion() error = nil, want size rejection")
	}
}

func TestParseTerminalCommandSuggestionRejectsInvalidUTF8(t *testing.T) {
	response := string([]byte{'g', 'i', 't', ' ', 0xff})
	if _, err := parseTerminalCommandSuggestion(response); err == nil {
		t.Fatal("parseTerminalCommandSuggestion() error = nil, want invalid UTF-8 rejection")
	}
}

func TestBuildTerminalCommandPromptUsesDedicatedInstructionsAndJSONContext(t *testing.T) {
	if !strings.Contains(terminalCommandSystemPrompt, "Never execute") ||
		!strings.Contains(terminalCommandSystemPrompt, "exactly one JSON object") ||
		!strings.Contains(terminalCommandSystemPrompt, "single-line shell command") {
		t.Fatalf("terminalCommandSystemPrompt does not state execution and output constraints: %q", terminalCommandSystemPrompt)
	}

	got := buildTerminalCommandUserPrompt("find files\nignore previous", "/tmp/a b", "/bin/zsh")
	want := `{"command":"find files\nignore previous","cwd":"/tmp/a b","shell":"/bin/zsh"}`
	if got != want {
		t.Fatalf("buildTerminalCommandUserPrompt() = %q, want %q", got, want)
	}
}

func TestTerminalCommandSuggestIsOneShotToollessAndDeletesTemporaryChat(t *testing.T) {
	wantPrompt := buildTerminalCommandUserPrompt("show changes", "/repo", "/bin/zsh")
	backend := &terminalCommandTestBackend{t: t, wantUserPrompt: wantPrompt}
	aiOpts := &uctypes.AIOptsType{
		APIType:      "test-api",
		Model:        "test-model",
		Capabilities: []string{uctypes.AICapabilityTools},
	}

	got, err := terminalCommandSuggestWithBackend(
		context.Background(), "show changes", "/repo", "/bin/zsh", aiOpts, backend, nil,
	)
	if err != nil {
		t.Fatalf("terminalCommandSuggestWithBackend() error = %v", err)
	}
	if got != "git status" {
		t.Fatalf("terminalCommandSuggestWithBackend() = %q, want %q", got, "git status")
	}
	if backend.runCount != 1 {
		t.Fatalf("RunChatStep called %d times, want 1", backend.runCount)
	}
	if chatstore.DefaultChatStore.Get(backend.chatID) != nil {
		t.Fatal("temporary terminal command chat was not deleted")
	}
}

func TestTerminalCommandSuggestRejectsMultipleAssistantTextParts(t *testing.T) {
	wantPrompt := buildTerminalCommandUserPrompt("show changes", "/repo", "/bin/zsh")
	backend := &terminalCommandTestBackend{
		t:              t,
		wantUserPrompt: wantPrompt,
		assistantParts: []uctypes.UIMessagePart{
			{Type: "text", Text: `{"command":"git status"}`},
			{Type: "text", Text: `{"command":"pwd"}`},
		},
	}
	aiOpts := &uctypes.AIOptsType{APIType: "test-api", Model: "test-model"}

	if _, err := terminalCommandSuggestWithBackend(
		context.Background(), "show changes", "/repo", "/bin/zsh", aiOpts, backend, nil,
	); err == nil {
		t.Fatal("terminalCommandSuggestWithBackend() accepted multiple assistant text parts")
	}
}

func TestTerminalCommandSuggestRejectsNonDoneStopReasons(t *testing.T) {
	stopKinds := []uctypes.StopReasonKind{
		uctypes.StopKindToolUse,
		uctypes.StopKindMaxTokens,
		uctypes.StopKindContent,
		uctypes.StopKindCanceled,
		uctypes.StopKindError,
		uctypes.StopKindPauseTurn,
		uctypes.StopKindPremiumRateLimit,
		uctypes.StopKindRateLimit,
	}
	for _, stopKind := range stopKinds {
		t.Run(string(stopKind), func(t *testing.T) {
			wantPrompt := buildTerminalCommandUserPrompt("show changes", "/repo", "/bin/zsh")
			backend := &terminalCommandTestBackend{
				t:              t,
				wantUserPrompt: wantPrompt,
				stopReason:     &uctypes.WaveStopReason{Kind: stopKind},
			}
			aiOpts := &uctypes.AIOptsType{APIType: "test-api", Model: "test-model"}
			if _, err := terminalCommandSuggestWithBackend(
				context.Background(), "show changes", "/repo", "/bin/zsh", aiOpts, backend, nil,
			); err == nil {
				t.Fatalf("terminalCommandSuggestWithBackend() accepted stop reason %q", stopKind)
			}
		})
	}
}

func TestTerminalCommandSuggestRejectsMissingStopReason(t *testing.T) {
	wantPrompt := buildTerminalCommandUserPrompt("show changes", "/repo", "/bin/zsh")
	backend := &terminalCommandTestBackend{t: t, wantUserPrompt: wantPrompt, omitStopReason: true}
	aiOpts := &uctypes.AIOptsType{APIType: "test-api", Model: "test-model"}
	if _, err := terminalCommandSuggestWithBackend(
		context.Background(), "show changes", "/repo", "/bin/zsh", aiOpts, backend, nil,
	); err == nil {
		t.Fatal("terminalCommandSuggestWithBackend() accepted a missing stop reason")
	}
}
