// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
	"github.com/wavetermdev/waveterm/pkg/wstore"
	"golang.org/x/net/idna"
)

const terminalCommandSystemPrompt = `You are a terminal command suggestion engine. Suggest a command for the user's stated command or intent, current working directory, and shell. Never execute a command or claim that you executed one. Return exactly one JSON object with exactly one string field named "command". Put the complete single-line shell command in that field. Do not return Markdown fences, commentary, additional fields, or control characters in the command.`

func buildTerminalCommandUserPrompt(command string, cwd string, shell string) string {
	prompt, _ := json.Marshal(struct {
		Command string `json:"command"`
		Cwd     string `json:"cwd"`
		Shell   string `json:"shell"`
	}{
		Command: command,
		Cwd:     cwd,
		Shell:   shell,
	})
	return string(prompt)
}

type terminalCommandResponseWriter struct {
	header http.Header
}

func (w *terminalCommandResponseWriter) Header() http.Header {
	return w.header
}

func (w *terminalCommandResponseWriter) Write(data []byte) (int, error) {
	return len(data), nil
}

func (w *terminalCommandResponseWriter) WriteHeader(int) {}
func (w *terminalCommandResponseWriter) Flush()          {}
func (w *terminalCommandResponseWriter) SetWriteDeadline(time.Time) error {
	return nil
}

func isWaveCloudEndpoint(endpoint string) (bool, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return false, fmt.Errorf("invalid terminal AI endpoint: %w", err)
	}
	hostname, err := idna.Lookup.ToASCII(parsed.Hostname())
	if err != nil || hostname == "" {
		return false, fmt.Errorf("invalid terminal AI endpoint hostname")
	}
	hostname = strings.TrimSuffix(strings.ToLower(hostname), ".")
	return hostname == "waveterm.dev" || strings.HasSuffix(hostname, ".waveterm.dev"), nil
}

func resolveTerminalCommandAIMode(fullConfig wconfig.FullConfigType) (string, *wconfig.AIModeConfigType, error) {
	mode := fullConfig.Settings.WaveAiDefaultMode
	if mode == "" || strings.HasPrefix(mode, "waveai@") {
		return "", nil, fmt.Errorf("terminal AI requires waveai:defaultmode to name a local or custom model")
	}
	modeConfig, ok := fullConfig.WaveAIModes[mode]
	if !ok {
		return "", nil, fmt.Errorf("terminal AI default mode %q is not configured", mode)
	}
	applyProviderDefaults(&modeConfig)
	waveCloudEndpoint, err := isWaveCloudEndpoint(modeConfig.Endpoint)
	if err != nil {
		return "", nil, err
	}
	if modeConfig.WaveAICloud || modeConfig.Provider == uctypes.AIProvider_Wave || waveCloudEndpoint {
		return "", nil, fmt.Errorf("terminal AI does not support Wave Cloud; configure a local or custom default model")
	}
	if modeConfig.APIType != uctypes.APIType_OpenAIChat && modeConfig.APIType != uctypes.APIType_OpenAIResponses {
		return "", nil, fmt.Errorf("terminal AI requires an OpenAI-compatible local or custom model")
	}
	return mode, &modeConfig, nil
}

func TerminalCommandSuggest(ctx context.Context, command string, cwd string, shell string) (string, error) {
	if strings.TrimSpace(command) == "" {
		return "", fmt.Errorf("terminal command input is empty")
	}
	aiMode, modeConfig, err := resolveTerminalCommandAIMode(wconfig.GetWatcher().GetFullConfig())
	if err != nil {
		return "", err
	}
	aiOpts, err := getWaveAISettingsFromResolvedMode(aiMode, modeConfig, false, waveobj.ObjRTInfo{})
	if err != nil {
		return "", err
	}
	backend, err := GetBackendByAPIType(aiOpts.APIType)
	if err != nil {
		return "", err
	}
	responseWriter := &terminalCommandResponseWriter{header: make(http.Header)}
	sseHandler := sse.MakeSSEHandlerCh(responseWriter, ctx)
	defer sseHandler.Close()
	return terminalCommandSuggestWithBackend(ctx, command, cwd, shell, aiOpts, backend, sseHandler)
}

func terminalCommandSuggestWithBackend(
	ctx context.Context,
	command string,
	cwd string,
	shell string,
	aiOpts *uctypes.AIOptsType,
	backend UseChatBackend,
	sseHandler *sse.SSEHandlerCh,
) (string, error) {
	chatID := uuid.NewString()
	defer chatstore.DefaultChatStore.Delete(chatID)

	terminalConfig := *aiOpts
	terminalConfig.Capabilities = slices.DeleteFunc(slices.Clone(aiOpts.Capabilities), func(capability string) bool {
		return capability == uctypes.AICapabilityTools
	})
	chatOpts := uctypes.WaveChatOpts{
		ChatId:               chatID,
		ClientId:             wstore.GetClientId(),
		Config:               terminalConfig,
		SystemPrompt:         []string{terminalCommandSystemPrompt},
		DisableProviderStore: true,
		DisableRedirects:     true,
	}
	message := uctypes.AIMessage{
		MessageId: uuid.NewString(),
		Parts: []uctypes.AIMessagePart{{
			Type: uctypes.AIMessagePartTypeText,
			Text: buildTerminalCommandUserPrompt(command, cwd, shell),
		}},
	}
	nativeMessage, err := backend.ConvertAIMessageToNativeChatMessage(message)
	if err != nil {
		return "", fmt.Errorf("converting terminal command prompt: %w", err)
	}
	if err := chatstore.DefaultChatStore.PostMessage(chatID, &chatOpts.Config, nativeMessage); err != nil {
		return "", fmt.Errorf("creating temporary terminal command chat: %w", err)
	}

	stopReason, responseMessages, _, err := backend.RunChatStep(ctx, sseHandler, chatOpts, nil)
	if err != nil {
		return "", fmt.Errorf("requesting terminal command suggestion: %w", err)
	}
	if stopReason == nil || stopReason.Kind != uctypes.StopKindDone {
		if stopReason == nil {
			return "", fmt.Errorf("AI returned no completion status for the terminal command")
		}
		return "", fmt.Errorf("AI terminal command request stopped with status %q", stopReason.Kind)
	}
	for _, responseMessage := range responseMessages {
		if responseMessage == nil {
			continue
		}
		if err := chatstore.DefaultChatStore.PostMessage(chatID, &chatOpts.Config, responseMessage); err != nil {
			return "", fmt.Errorf("storing terminal command response: %w", err)
		}
	}
	chat := chatstore.DefaultChatStore.Get(chatID)
	if chat == nil {
		return "", fmt.Errorf("temporary terminal command chat disappeared")
	}
	uiChat, err := backend.ConvertAIChatToUIChat(*chat)
	if err != nil {
		return "", fmt.Errorf("converting terminal command response: %w", err)
	}
	for i := len(uiChat.Messages) - 1; i >= 0; i-- {
		if uiChat.Messages[i].Role != "assistant" {
			continue
		}
		var textParts []string
		for _, part := range uiChat.Messages[i].Parts {
			if part.Type == "text" {
				textParts = append(textParts, part.Text)
			}
		}
		if len(textParts) != 1 {
			return "", fmt.Errorf("AI returned %d terminal command text parts; expected exactly one", len(textParts))
		}
		return parseTerminalCommandSuggestion(textParts[0])
	}
	return "", fmt.Errorf("AI returned no terminal command suggestion")
}

func parseTerminalCommandSuggestion(response string) (string, error) {
	if !utf8.ValidString(response) {
		return "", fmt.Errorf("AI returned a terminal command containing invalid UTF-8")
	}
	if len(response) > shellutil.MaxTerminalCommandSuggestionBytes {
		return "", fmt.Errorf("AI returned a terminal command response longer than %d bytes", shellutil.MaxTerminalCommandSuggestionBytes)
	}
	for _, r := range response {
		if r == '\r' || r == '\n' {
			continue
		}
		if r < 0x20 || (r >= 0x7f && r <= 0x9f) || r == '\u2028' || r == '\u2029' {
			return "", fmt.Errorf("AI returned a terminal command response containing control or line-separator characters")
		}
	}
	trimmed := strings.Trim(response, " \r\n")
	if strings.HasPrefix(trimmed, "{") {
		command, err := decodeStrictTerminalCommandEnvelope(trimmed)
		if err != nil {
			return "", fmt.Errorf("AI returned an invalid terminal command envelope: %w", err)
		}
		return shellutil.ValidateTerminalCommandSuggestion(command)
	}
	if fencedCommand, ok := extractSingleFencedTerminalCommand(trimmed); ok {
		fencedCommand = strings.Trim(fencedCommand, " \r\n")
		if strings.HasPrefix(fencedCommand, "{") {
			command, err := decodeStrictTerminalCommandEnvelope(fencedCommand)
			if err != nil {
				return "", fmt.Errorf("AI returned an invalid fenced terminal command envelope: %w", err)
			}
			return shellutil.ValidateTerminalCommandSuggestion(command)
		}
		return shellutil.ValidateTerminalCommandSuggestion(fencedCommand)
	}
	return "", fmt.Errorf("AI returned neither a terminal command envelope nor a single fenced command")
}

func decodeStrictTerminalCommandEnvelope(response string) (string, error) {
	decoder := json.NewDecoder(strings.NewReader(response))
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return "", fmt.Errorf("expected a JSON object")
	}
	var command string
	seenCommand := false
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return "", err
		}
		key, ok := keyToken.(string)
		if !ok || key != "command" {
			return "", fmt.Errorf("unexpected field %q", key)
		}
		if seenCommand {
			return "", fmt.Errorf("duplicate field %q", key)
		}
		seenCommand = true
		if err := decoder.Decode(&command); err != nil {
			return "", fmt.Errorf("decoding command field: %w", err)
		}
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') {
		return "", fmt.Errorf("expected the end of a JSON object")
	}
	if !seenCommand {
		return "", fmt.Errorf("missing field %q", "command")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return "", fmt.Errorf("trailing data after the JSON object")
	}
	return command, nil
}

func extractSingleFencedTerminalCommand(response string) (string, bool) {
	response = strings.ReplaceAll(response, "\r\n", "\n")
	if strings.Contains(response, "~~~") || strings.Count(response, "```") != 2 {
		return "", false
	}
	openIndex := strings.Index(response, "```")
	fenced := response[openIndex:]
	openingLineEnd := strings.IndexByte(fenced, '\n')
	if openingLineEnd < 0 {
		return "", false
	}
	language := fenced[3:openingLineEnd]
	for _, r := range language {
		if !(r >= 'a' && r <= 'z') && !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && r != '_' && r != '+' && r != '-' {
			return "", false
		}
	}
	bodyAndClose := fenced[openingLineEnd+1:]
	closeIndex := strings.Index(bodyAndClose, "\n```")
	if closeIndex < 0 {
		return "", false
	}
	suffix := bodyAndClose[closeIndex+4:]
	if strings.TrimSpace(suffix) != "" {
		return "", false
	}
	return bodyAndClose[:closeIndex], true
}
