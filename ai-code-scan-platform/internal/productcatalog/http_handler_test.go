package productcatalog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHandlerRequiresFreshUACLoginTokens(t *testing.T) {
	handler := NewHandler(
		NewClient("https://catalog.example", &http.Client{Timeout: time.Second}),
		func(next http.Handler) http.Handler { return next },
		func(context.Context) (Tokens, bool) { return Tokens{}, false },
	)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/products", nil)
	response := httptest.NewRecorder()

	handler.list(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
}
