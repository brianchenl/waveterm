package aiusechat

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWaveAIPostMessageRejectsOversizedBody(t *testing.T) {
	body := `{"padding":"` + strings.Repeat("x", MaxAIPostMessageBodyBytes) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/post-chat-message", strings.NewReader(body))
	recorder := httptest.NewRecorder()
	WaveAIPostMessageHandler(recorder, req)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected status %d, got %d", http.StatusRequestEntityTooLarge, recorder.Code)
	}
}

func TestWaveAIPostMessageRejectsOversizedTrailingWhitespace(t *testing.T) {
	body := `{}` + strings.Repeat(" ", MaxAIPostMessageBodyBytes)
	req := httptest.NewRequest(http.MethodPost, "/api/post-chat-message", strings.NewReader(body))
	recorder := httptest.NewRecorder()

	WaveAIPostMessageHandler(recorder, req)

	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected status %d, got %d", http.StatusRequestEntityTooLarge, recorder.Code)
	}
}

func TestWaveAIPostMessageRejectsMultipleJSONObjects(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/post-chat-message", strings.NewReader(`{} {}`))
	recorder := httptest.NewRecorder()

	WaveAIPostMessageHandler(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, recorder.Code)
	}
}
