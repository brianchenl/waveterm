package aiusechat

import "testing"

func TestParseReadTextFileInputEnforcesResourceLimits(t *testing.T) {
	tests := []struct {
		name  string
		input map[string]any
	}{
		{name: "offset", input: map[string]any{"filename": "/tmp/file", "offset": ReadFileMaxOffset + 1}},
		{name: "count", input: map[string]any{"filename": "/tmp/file", "count": ReadFileMaxLineCount + 1}},
		{name: "max bytes", input: map[string]any{"filename": "/tmp/file", "max_bytes": ReadFileMaxBytes + 1}},
		{name: "negative max bytes", input: map[string]any{"filename": "/tmp/file", "max_bytes": -1}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := parseReadTextFileInput(test.input); err == nil {
				t.Fatal("expected resource limit validation error")
			}
		})
	}
}
