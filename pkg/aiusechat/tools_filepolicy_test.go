package aiusechat

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestReadTextFileRejectsSymlinkToSensitiveFile(t *testing.T) {
	tempDir := t.TempDir()
	sensitiveDir := filepath.Join(tempDir, ".ssh")
	if err := os.MkdirAll(sensitiveDir, 0700); err != nil {
		t.Fatal(err)
	}
	sensitivePath := filepath.Join(sensitiveDir, "id_rsa")
	if err := os.WriteFile(sensitivePath, []byte("private-key"), 0600); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(tempDir, "notes.txt")
	if err := os.Symlink(sensitivePath, linkPath); err != nil {
		t.Skipf("symlinks are not available on this platform: %v", err)
	}

	input := map[string]any{"filename": linkPath}
	toolUseData := &uctypes.UIMessageDataToolUse{}
	if err := verifyReadTextFileInput(input, toolUseData); err == nil || !strings.Contains(err.Error(), "sensitive") {
		t.Fatalf("expected sensitive symlink to be rejected, got %v", err)
	}
	if _, err := readTextFileCallback(input, toolUseData); err == nil || !strings.Contains(err.Error(), "sensitive") {
		t.Fatalf("callback must re-check sensitive symlink, got %v", err)
	}
}

func TestWriteTextFileRejectsSensitiveParentSymlink(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)
	sensitiveDir := filepath.Join(tempDir, ".secrets")
	if err := os.MkdirAll(sensitiveDir, 0700); err != nil {
		t.Fatal(err)
	}
	linkDir := filepath.Join(tempDir, "workspace")
	if err := os.Symlink(sensitiveDir, linkDir); err != nil {
		t.Skipf("symlinks are not available on this platform: %v", err)
	}

	input := map[string]any{
		"filename": filepath.Join(linkDir, "innocent.txt"),
		"contents": "must not be written",
	}
	toolUseData := &uctypes.UIMessageDataToolUse{}
	if err := verifyWriteTextFileInput(input, toolUseData); err == nil || !strings.Contains(err.Error(), "sensitive") {
		t.Fatalf("expected sensitive parent symlink to be rejected, got %v", err)
	}
	if _, err := writeTextFileCallback(input, toolUseData); err == nil || !strings.Contains(err.Error(), "sensitive") {
		t.Fatalf("callback must re-check sensitive parent symlink, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(sensitiveDir, "innocent.txt")); !os.IsNotExist(err) {
		t.Fatalf("sensitive target was unexpectedly created: %v", err)
	}
}
