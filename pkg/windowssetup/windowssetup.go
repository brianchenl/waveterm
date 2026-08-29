// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package windowssetup

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/kevinburke/ssh_config"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const windowsOpenSSHAgentPipe = `\\.\pipe\openssh-ssh-agent`

const kimiCodeModelsEndpoint = "https://api.kimi.com/coding/v1/models"

func trimSSHValue(value string) string {
	return strings.Trim(strings.TrimSpace(value), `"'`)
}

func parseSSHConfig(data []byte) ([]string, bool, error) {
	cfg, err := ssh_config.Decode(bytes.NewReader(data), true)
	if err != nil {
		return nil, false, err
	}
	hostSet := make(map[string]struct{})
	for _, host := range cfg.Hosts {
		for _, pattern := range host.Patterns {
			name := pattern.String()
			if name == "" || strings.ContainsAny(name, "*?!") {
				continue
			}
			hostSet[name] = struct{}{}
		}
	}
	hosts := make([]string, 0, len(hostSet))
	for host := range hostSet {
		hosts = append(hosts, host)
	}
	sort.Strings(hosts)

	hasMatch := false
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(strings.ToLower(line), "match ") {
			hasMatch = true
			break
		}
	}
	return hosts, hasMatch, scanner.Err()
}

func resolveSSHHost(host string) (*wshrpc.SSHHostDiagnostics, error) {
	if host == "" {
		return nil, nil
	}
	settings := remote.WaveSshConfigUserSettings()
	settings.ReloadConfigs()
	getStrict := func(key string) (string, error) {
		value, err := settings.GetStrict(host, key)
		return trimSSHValue(value), err
	}
	userName, err := getStrict("User")
	if err != nil {
		return nil, err
	}
	if userName == "" {
		if currentUser, userErr := user.Current(); userErr == nil {
			userName = currentUser.Username
		}
	}
	hostName, err := getStrict("HostName")
	if err != nil {
		return nil, err
	}
	if hostName == "" {
		hostName = host
	}
	port, err := getStrict("Port")
	if err != nil {
		return nil, err
	}
	identityFiles := settings.GetAll(host, "IdentityFile")
	for idx := range identityFiles {
		identityFiles[idx] = trimSSHValue(identityFiles[idx])
	}
	proxyJumpRaw, err := getStrict("ProxyJump")
	if err != nil {
		return nil, err
	}
	var proxyJump []string
	for _, item := range strings.Split(proxyJumpRaw, ",") {
		item = strings.TrimSpace(item)
		if item != "" && !strings.EqualFold(item, "none") {
			proxyJump = append(proxyJump, item)
		}
	}
	return &wshrpc.SSHHostDiagnostics{
		Alias:         host,
		HostName:      hostName,
		User:          userName,
		Port:          port,
		IdentityFiles: identityFiles,
		ProxyJump:     proxyJump,
	}, nil
}

type pathLookup func(string) (string, error)

func buildShellList(lookup pathLookup, gitBashPath string) []wshrpc.WindowsShellInfo {
	candidates := []struct {
		id          string
		name        string
		binary      string
		recommended bool
	}{
		{id: "pwsh", name: "PowerShell 7", binary: "pwsh.exe", recommended: true},
		{id: "powershell", name: "Windows PowerShell 5.1", binary: "powershell.exe"},
		{id: "cmd", name: "Command Prompt", binary: "cmd.exe"},
	}
	shells := make([]wshrpc.WindowsShellInfo, 0, 4)
	for _, candidate := range candidates {
		path, err := lookup(candidate.binary)
		shells = append(shells, wshrpc.WindowsShellInfo{
			Id:          candidate.id,
			Name:        candidate.name,
			Path:        path,
			Available:   err == nil && path != "",
			Recommended: candidate.recommended,
		})
	}
	shells = append(shells, wshrpc.WindowsShellInfo{
		Id:        "gitbash",
		Name:      "Git Bash",
		Path:      gitBashPath,
		Available: gitBashPath != "",
	})
	return shells
}

func Diagnostics(sshHost string) (*wshrpc.CommandWindowsDiagnosticsRtnData, error) {
	sshConfigPath := filepath.Join(wavebase.GetHomeDir(), ".ssh", "config")
	rtn := &wshrpc.CommandWindowsDiagnosticsRtnData{
		Platform:      runtime.GOOS,
		SSHConfigPath: sshConfigPath,
		SSHAgentPath:  windowsOpenSSHAgentPipe,
		Shells:        []wshrpc.WindowsShellInfo{},
	}

	data, err := os.ReadFile(sshConfigPath)
	if err == nil {
		rtn.SSHConfigExists = true
		rtn.SSHConfigReadable = true
		rtn.SSHHosts, rtn.SSHConfigHasMatch, err = parseSSHConfig(data)
		if err != nil {
			rtn.SSHConfigError = err.Error()
		}
	} else if os.IsNotExist(err) {
		rtn.SSHConfigError = "not-found"
	} else {
		rtn.SSHConfigExists = true
		rtn.SSHConfigError = err.Error()
	}

	if sshHost != "" {
		rtn.SelectedSSHHost, err = resolveSSHHost(sshHost)
		if err != nil {
			rtn.SSHConfigError = err.Error()
		}
	}

	fullConfig := wconfig.GetWatcher().GetFullConfig()
	rtn.CurrentLocalShellPath = fullConfig.Settings.TermLocalShellPath
	if runtime.GOOS == "windows" {
		rtn.Shells = buildShellList(exec.LookPath, shellutil.FindGitBash(&fullConfig, true))
		agentStatus, agentErr := remote.InspectIdentityAgent(windowsOpenSSHAgentPipe)
		if agentErr != nil {
			rtn.SSHAgentError = agentErr.Error()
		} else {
			rtn.SSHAgentAvailable = agentStatus.Available
			rtn.SSHAgentKeyCount = agentStatus.KeyCount
		}
	}
	return rtn, nil
}

type ollamaModelsResponse struct {
	Models []struct {
		Name string `json:"name"`
	} `json:"models"`
}

type openAIModelsResponse struct {
	Data []struct {
		Id string `json:"id"`
	} `json:"data"`
}

func testModelsEndpoint(ctx context.Context, client *http.Client, endpoint string, apiToken string, ollama bool) (*wshrpc.CommandAIProviderTestRtnData, error) {
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	if apiToken != "" {
		req.Header.Set("Authorization", "Bearer "+apiToken)
	}
	req.Header.Set("User-Agent", "WaveTerminal/"+wavebase.WaveVersion)
	resp, err := client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return &wshrpc.CommandAIProviderTestRtnData{Success: false, LatencyMs: latency, Error: err.Error()}, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &wshrpc.CommandAIProviderTestRtnData{
			Success: false, LatencyMs: latency, Error: fmt.Sprintf("HTTP %d", resp.StatusCode),
		}, nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return nil, err
	}
	var models []string
	if ollama {
		var parsed ollamaModelsResponse
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, err
		}
		for _, model := range parsed.Models {
			if model.Name != "" {
				models = append(models, model.Name)
			}
		}
	} else {
		var parsed openAIModelsResponse
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, err
		}
		for _, model := range parsed.Data {
			if model.Id != "" {
				models = append(models, model.Id)
			}
		}
	}
	sort.Strings(models)
	return &wshrpc.CommandAIProviderTestRtnData{Success: true, Models: models, LatencyMs: latency}, nil
}

func TestAIProvider(ctx context.Context, data wshrpc.CommandAIProviderTestData) (*wshrpc.CommandAIProviderTestRtnData, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	if data.Provider != "ollama" && data.ProxyURL != "" {
		proxyURL, err := url.Parse(data.ProxyURL)
		if err != nil || (proxyURL.Scheme != "http" && proxyURL.Scheme != "https" && proxyURL.Scheme != "socks5") {
			return &wshrpc.CommandAIProviderTestRtnData{Error: "invalid-proxy-url"}, nil
		}
		client.Transport = &http.Transport{Proxy: http.ProxyURL(proxyURL)}
	}
	switch data.Provider {
	case "ollama":
		return testModelsEndpoint(ctx, client, "http://127.0.0.1:11434/api/tags", "", true)
	case "deepseek":
		if data.APIToken == "" {
			return &wshrpc.CommandAIProviderTestRtnData{Error: "api-token-required"}, nil
		}
		return testModelsEndpoint(ctx, client, "https://api.deepseek.com/models", data.APIToken, false)
	case "kimi":
		if data.APIToken == "" {
			return &wshrpc.CommandAIProviderTestRtnData{Error: "api-token-required"}, nil
		}
		return testModelsEndpoint(ctx, client, kimiCodeModelsEndpoint, data.APIToken, false)
	default:
		return nil, fmt.Errorf("unsupported AI provider %q", data.Provider)
	}
}
