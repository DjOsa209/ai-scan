package review

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlerReportsMissingModelConfiguration(t *testing.T) {
	service := NewService(func(context.Context) (json.RawMessage, error) {
		return json.RawMessage(`{"aiModels":[]}`), nil
	}, stubSkills{}, &recordingModelClient{}, stubDecrypter{}, 1)
	mux := http.NewServeMux()
	NewHandler(service, 1024).RegisterRoutes(mux)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/plugin/reviews", bytes.NewBufferString(`{"context":{"diff":"change"}}`))
	response := httptest.NewRecorder()

	mux.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !bytes.Contains(response.Body.Bytes(), []byte("no enabled external model")) {
		t.Fatalf("unexpected response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHandlerRejectsOversizedRequest(t *testing.T) {
	service := NewService(func(context.Context) (json.RawMessage, error) {
		return json.RawMessage(`{"aiModels":[]}`), nil
	}, stubSkills{}, &recordingModelClient{}, stubDecrypter{}, 1)
	mux := http.NewServeMux()
	NewHandler(service, 16).RegisterRoutes(mux)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/plugin/reviews", bytes.NewBufferString(`{"context":{"diff":"too large"}}`))
	response := httptest.NewRecorder()

	mux.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected HTTP 400, got %d", response.Code)
	}
}
