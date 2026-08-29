package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleServiceRejectsOversizedBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/wave/service", strings.NewReader(strings.Repeat("x", MaxServiceRequestBodyBytes+1)))
	recorder := httptest.NewRecorder()
	handleService(recorder, req)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected status %d, got %d", http.StatusRequestEntityTooLarge, recorder.Code)
	}
}

func TestHandleServiceRejectsWrongMethodBeforeReadingBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/wave/service", strings.NewReader(strings.Repeat("x", MaxServiceRequestBodyBytes+1)))
	recorder := httptest.NewRecorder()
	handleService(recorder, req)
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}
}
