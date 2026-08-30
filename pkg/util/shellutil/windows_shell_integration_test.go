// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package shellutil

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/creack/pty"
)

func TestCmdStartupEmitsIntegrationMarkersInConPTY(t *testing.T) {
	waveHome := t.TempDir()
	wshBinDir := t.TempDir()
	fakeWsh := []byte("@echo off\r\nif /I \"%~1\"==\"token\" echo set WAVETERM_JWT=jwt-test\r\n")
	if err := os.WriteFile(filepath.Join(wshBinDir, "wsh.cmd"), fakeWsh, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := initWindowsTestRcFiles(waveHome, wshBinDir); err != nil {
		t.Fatal(err)
	}
	scriptPath := filepath.Join(waveHome, CmdIntegrationDir, "wavecmd.cmd")
	cmd := exec.Command("cmd.exe")
	cmd.Args = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `cmd.exe /D /Q /V:OFF /K call "%WAVETERM_CMD_INIT%"`}
	cmd.Env = append(os.Environ(), "WAVETERM_SWAPTOKEN=test-swap", "WAVETERM_CMD_INIT="+scriptPath)
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 24, Cols: 100})
	if err != nil {
		t.Fatalf("starting cmd.exe in ConPTY: %v", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		// photostorm/pty owns the process Wait call on Windows. Closing the
		// pseudoconsole concurrently with that internal waiter can corrupt the
		// Windows heap, so let the test process release this short-lived handle.
	}()

	outputCh := make(chan []byte, 16)
	readErrCh := make(chan error, 1)
	go func() {
		buffer := make([]byte, 4096)
		for {
			n, readErr := ptmx.Read(buffer)
			if n > 0 {
				outputCh <- bytes.Clone(buffer[:n])
			}
			if readErr != nil {
				readErrCh <- readErr
				return
			}
		}
	}()

	var output []byte
	waitForOutput := func(marker []byte) {
		t.Helper()
		timer := time.NewTimer(10 * time.Second)
		defer timer.Stop()
		for !bytes.Contains(output, marker) {
			select {
			case chunk := <-outputCh:
				output = append(output, chunk...)
			case readErr := <-readErrCh:
				t.Fatalf("reading cmd.exe output before %q: %v; output=%q", marker, readErr, output)
			case <-timer.C:
				t.Fatalf("timed out waiting for CMD marker %q; output=%q", marker, output)
			}
		}
	}

	for _, marker := range [][]byte{
		[]byte("\x1b]16162;S;cmd\x1b\\"),
		[]byte("\x1b]16162;P;"),
		[]byte("\x1b]16162;A\x1b\\"),
	} {
		waitForOutput(marker)
	}

	resultDir := t.TempDir()
	waitForFile := func(path string) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for {
			if _, err := os.Stat(path); err == nil {
				return
			}
			if time.Now().After(deadline) {
				t.Fatalf("timed out waiting for %s", path)
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
	authPath := filepath.Join(resultDir, "token-applied")
	leakedTokenPath := filepath.Join(resultDir, "swap-token-leaked")
	authCheck := fmt.Sprintf(`if "%%WAVETERM_JWT%%"=="jwt-test" type nul > "%s"`, authPath)
	leakCheck := fmt.Sprintf(`if defined WAVETERM_SWAPTOKEN type nul > "%s"`, leakedTokenPath)
	if _, err := ptmx.Write([]byte(authCheck + "\r" + leakCheck + "\r")); err != nil {
		t.Fatalf("checking CMD token initialization: %v", err)
	}
	waitForFile(authPath)
	time.Sleep(200 * time.Millisecond)
	if _, err := os.Stat(leakedTokenPath); !os.IsNotExist(err) {
		t.Fatalf("CMD leaked WAVETERM_SWAPTOKEN into the interactive shell: %v", err)
	}

	badPath := filepath.Join(resultDir, "original-ran")
	goodPath := filepath.Join(resultDir, "replacement-ran")
	original := fmt.Sprintf(`type nul > "%s"`, badPath)
	replacement := fmt.Sprintf(`type nul > "%s"`, goodPath)
	if _, err := ptmx.Write([]byte(original + "\x1b" + replacement)); err != nil {
		t.Fatalf("editing CMD input through ConPTY: %v", err)
	}
	time.Sleep(300 * time.Millisecond)
	if _, err := os.Stat(badPath); !os.IsNotExist(err) {
		t.Fatalf("CMD executed the original line before Enter: %v", err)
	}
	if _, err := os.Stat(goodPath); !os.IsNotExist(err) {
		t.Fatalf("CMD executed the replacement before Enter: %v", err)
	}
	if _, err := ptmx.Write([]byte("\r")); err != nil {
		t.Fatalf("submitting edited CMD input: %v", err)
	}
	waitForFile(goodPath)
	if _, err := os.Stat(badPath); !os.IsNotExist(err) {
		t.Fatalf("CMD executed the cleared original command: %v", err)
	}
}

func TestPowerShellStartupParsesOnWindowsPowerShellAndPwsh(t *testing.T) {
	waveHome := t.TempDir()
	if err := initWindowsTestRcFiles(waveHome, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	scriptPath := filepath.Join(waveHome, PwshIntegrationDir, "wavepwsh.ps1")
	for _, executable := range []string{"powershell.exe", "pwsh.exe"} {
		if _, err := exec.LookPath(executable); err != nil {
			if executable == "pwsh.exe" {
				t.Log("pwsh.exe is not installed; Windows PowerShell 5.1 parser coverage remains active")
				continue
			}
			t.Fatalf("%s is unavailable: %v", executable, err)
		}
		t.Run(executable, func(t *testing.T) {
			parserCommand := `$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($env:WAVETERM_TEST_SCRIPT,[ref]$tokens,[ref]$errors) > $null; if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }`
			cmd := exec.Command(executable, "-NoLogo", "-NoProfile", "-Command", parserCommand)
			cmd.Env = append(os.Environ(), fmt.Sprintf("WAVETERM_TEST_SCRIPT=%s", scriptPath))
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("parsing generated PowerShell startup: %v\n%s", err, output)
			}
		})
	}
}

func TestPowerShellInlineAIReceivesUnicodeThroughPSReadLine(t *testing.T) {
	wshBinDir := t.TempDir()
	fakeWsh := []byte("@echo off\r\n" +
		"if /I not \"%~1\"==\"ai\" exit /b 0\r\n" +
		"powershell.exe -NoLogo -NoProfile -Command \"$s=[Console]::OpenStandardInput(); $m=New-Object IO.MemoryStream; $s.CopyTo($m); [IO.File]::WriteAllBytes($env:WAVETERM_CAPTURE,$m.ToArray()); $b=[Text.Encoding]::UTF8.GetBytes('Get-ChildItem'); $o=[Console]::OpenStandardOutput(); $o.Write($b,0,$b.Length)\"\r\n")
	if err := os.WriteFile(filepath.Join(wshBinDir, "wsh.cmd"), fakeWsh, 0o600); err != nil {
		t.Fatal(err)
	}
	waveHome := t.TempDir()
	if err := initWindowsTestRcFiles(waveHome, wshBinDir); err != nil {
		t.Fatal(err)
	}
	scriptPath := filepath.Join(waveHome, PwshIntegrationDir, "wavepwsh.ps1")
	for _, executable := range []string{"powershell.exe", "pwsh.exe"} {
		if _, err := exec.LookPath(executable); err != nil {
			if executable == "pwsh.exe" {
				t.Log("pwsh.exe is not installed; skipping PowerShell 7 PSReadLine smoke test")
				continue
			}
			t.Fatal(err)
		}
		t.Run(executable, func(t *testing.T) {
			capturePath := filepath.Join(t.TempDir(), "stdin.bin")
			cmd := exec.Command(executable, "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-File", scriptPath)
			cmd.Env = append(os.Environ(), "WAVETERM_CAPTURE="+capturePath)
			ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 24, Cols: 100})
			if err != nil {
				t.Fatalf("starting %s in ConPTY: %v", executable, err)
			}
			defer func() {
				_ = cmd.Process.Kill()
				// See TestCmdStartupEmitsIntegrationMarkersInConPTY: the Windows
				// PTY implementation performs its own asynchronous process cleanup.
			}()

			outputCh := make(chan []byte, 16)
			readErrCh := make(chan error, 1)
			go func() {
				buffer := make([]byte, 4096)
				for {
					n, readErr := ptmx.Read(buffer)
					if n > 0 {
						outputCh <- bytes.Clone(buffer[:n])
					}
					if readErr != nil {
						readErrCh <- readErr
						return
					}
				}
			}()
			var output []byte
			readyMarker := []byte("\x1b]16162;A\a")
			timer := time.NewTimer(15 * time.Second)
			defer timer.Stop()
			for !bytes.Contains(output, readyMarker) {
				select {
				case chunk := <-outputCh:
					output = append(output, chunk...)
				case readErr := <-readErrCh:
					t.Fatalf("reading %s before ready: %v; output=%q", executable, readErr, output)
				case <-timer.C:
					t.Fatalf("timed out waiting for %s prompt; output=%q", executable, output)
				}
			}

			input := "列出当前目录文件"
			if _, err := ptmx.Write([]byte(input + "\x1b[24;2~")); err != nil {
				t.Fatalf("triggering inline AI in %s: %v", executable, err)
			}
			deadline := time.Now().Add(10 * time.Second)
			for {
				captured, readErr := os.ReadFile(capturePath)
				if readErr == nil {
					if !bytes.Contains(captured, []byte(input)) {
						t.Fatalf("%s corrupted Unicode AI input: %q", executable, captured)
					}
					break
				}
				if !os.IsNotExist(readErr) {
					t.Fatal(readErr)
				}
				if time.Now().After(deadline) {
					t.Fatalf("%s did not invoke the PSReadLine inline AI binding", executable)
				}
				time.Sleep(50 * time.Millisecond)
			}
		})
	}
}

func initWindowsTestRcFiles(waveHome string, wshBinDir string) error {
	for _, integrationDir := range []string{
		ZshIntegrationDir,
		BashIntegrationDir,
		FishIntegrationDir,
		PwshIntegrationDir,
		CmdIntegrationDir,
	} {
		if err := os.MkdirAll(filepath.Join(waveHome, integrationDir), 0o755); err != nil {
			return err
		}
	}
	return InitRcFiles(waveHome, wshBinDir)
}
