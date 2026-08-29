// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package windowssetup

import (
	"context"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestParseSSHConfig(t *testing.T) {
	config := []byte("Host dev\n  HostName 192.0.2.1\nHost *.internal\n  User admin\nMatch user root\n  Port 2200\n")
	hosts, hasMatch, err := parseSSHConfig(config)
	if err != nil {
		t.Fatalf("parseSSHConfig: %v", err)
	}
	if !reflect.DeepEqual(hosts, []string{"dev"}) {
		t.Fatalf("unexpected hosts: %#v", hosts)
	}
	if !hasMatch {
		t.Fatal("expected Match directive to be detected")
	}
}

func TestBuildShellList(t *testing.T) {
	lookup := func(binary string) (string, error) {
		if binary == "pwsh.exe" {
			return `C:\\Program Files\\PowerShell\\7\\pwsh.exe`, nil
		}
		return "", errNotFound(binary)
	}
	shells := buildShellList(lookup, `C:\\Program Files\\Git\\bin\\bash.exe`)
	if !shells[0].Available || !shells[0].Recommended {
		t.Fatalf("PowerShell 7 should be available and recommended: %#v", shells[0])
	}
	if !shells[3].Available {
		t.Fatalf("Git Bash should be available: %#v", shells[3])
	}
}

type errNotFound string

func (e errNotFound) Error() string { return string(e) + " not found" }

func TestModelsEndpoint(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("authorization header was not set")
		}
		if r.Header.Get("User-Agent") == "" {
			t.Fatalf("user agent was not set")
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"data":[{"id":"model-b"},{"id":"model-a"}]}`)),
		}, nil
	})}

	rtn, err := testModelsEndpoint(context.Background(), client, "https://example.invalid/models", "test-key", false)
	if err != nil {
		t.Fatalf("testModelsEndpoint: %v", err)
	}
	if !rtn.Success || !reflect.DeepEqual(rtn.Models, []string{"model-a", "model-b"}) {
		t.Fatalf("unexpected response: %#v", rtn)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return fn(req) }
