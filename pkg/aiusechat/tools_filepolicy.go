package aiusechat

import (
	"fmt"
	"os"
	"path/filepath"
)

// resolvePathForPolicy returns the canonical path used both for policy checks
// and the eventual file operation. When the target does not exist, it resolves
// the nearest existing ancestor so parent-directory symlinks cannot hide the
// real destination.
func resolvePathForPolicy(path string, allowMissing bool) (string, error) {
	cleanPath := filepath.Clean(path)
	resolvedPath, err := filepath.EvalSymlinks(cleanPath)
	if err == nil {
		return resolvedPath, nil
	}
	if !allowMissing || !os.IsNotExist(err) {
		return "", err
	}

	probe := cleanPath
	var missingParts []string
	for {
		parent := filepath.Dir(probe)
		if parent == probe {
			return "", fmt.Errorf("unable to resolve an existing ancestor for %s", cleanPath)
		}
		missingParts = append(missingParts, filepath.Base(probe))
		probe = parent
		resolvedParent, resolveErr := filepath.EvalSymlinks(probe)
		if resolveErr != nil {
			if os.IsNotExist(resolveErr) {
				continue
			}
			return "", resolveErr
		}
		for i := len(missingParts) - 1; i >= 0; i-- {
			resolvedParent = filepath.Join(resolvedParent, missingParts[i])
		}
		return filepath.Clean(resolvedParent), nil
	}
}

func checkCanonicalPathPolicy(path string, allowMissing bool) (string, error) {
	resolvedPath, err := resolvePathForPolicy(path, allowMissing)
	if err != nil {
		return "", fmt.Errorf("failed to resolve real path: %w", err)
	}
	if blocked, reason := isBlockedFile(resolvedPath); blocked {
		return "", fmt.Errorf("access denied: potentially sensitive file: %s", reason)
	}
	return resolvedPath, nil
}
