package wshserver

import (
	"context"
	"strings"
	"testing"
)

func TestSecretCommandsDenyRequestsWithoutCapability(t *testing.T) {
	server := &WshServer{}
	if _, err := server.GetSecretsCommand(context.Background(), []string{"TEST_SECRET"}); err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected secret read to be denied before storage access, got %v", err)
	}
	value := "secret"
	if err := server.SetSecretsCommand(context.Background(), map[string]*string{"TEST_SECRET": &value}); err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected secret write to be denied before storage access, got %v", err)
	}
}
