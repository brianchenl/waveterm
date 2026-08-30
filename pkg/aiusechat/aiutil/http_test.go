// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiutil

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestMakeHTTPClientCanDisableRedirectsWithoutReplayingPost(t *testing.T) {
	var destinationRequests atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		destinationRequests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer destination.Close()

	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer origin.Close()

	client, err := MakeHTTPClient("", true)
	if err != nil {
		t.Fatalf("MakeHTTPClient() error = %v", err)
	}
	resp, err := client.Post(origin.URL, "application/json", nil)
	if err != nil {
		t.Fatalf("Post() error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusTemporaryRedirect)
	}
	if got := destinationRequests.Load(); got != 0 {
		t.Fatalf("redirect destination received %d requests, want 0", got)
	}
}
