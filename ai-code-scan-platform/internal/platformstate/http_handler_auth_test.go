package platformstate

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"ai-code-scan-platform/internal/auth"
)

func TestRequireAdminRejectsMissingToken(t *testing.T) {
	handler := NewHandler(nil, "admin-secret")
	protected := handler.requireAdmin(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	}))
	response := httptest.NewRecorder()
	protected.ServeHTTP(response, httptest.NewRequest(http.MethodPut, "/api/v1/platform/state", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
}

func TestRequireAdminAllowsAdminSession(t *testing.T) {
	handler := NewHandler(nil, "admin-secret", withTestUser(auth.User{ID: "admin-1", Role: "admin"}))
	protected := handler.requireAdmin(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	}))
	response := httptest.NewRecorder()
	protected.ServeHTTP(response, httptest.NewRequest(http.MethodPut, "/api/v1/platform/state", nil))
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", response.Code)
	}
}

func TestRequireAdminRejectsRegularUserSession(t *testing.T) {
	handler := NewHandler(nil, "admin-secret", withTestUser(auth.User{ID: "user-1", Role: "user"}))
	protected := handler.requireAdmin(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	}))
	response := httptest.NewRecorder()
	protected.ServeHTTP(response, httptest.NewRequest(http.MethodPut, "/api/v1/platform/state", nil))
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", response.Code)
	}
}

func TestRequireAdminAllowsAdminToken(t *testing.T) {
	handler := NewHandler(nil, "admin-secret")
	protected := handler.requireAdmin(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodPut, "/api/v1/platform/state", nil)
	request.Header.Set("Authorization", "Bearer admin-secret")
	response := httptest.NewRecorder()
	protected.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", response.Code)
	}
}

func TestGetRejectsRegularUserSession(t *testing.T) {
	handler := NewHandler(nil, "admin-secret", withTestUser(auth.User{ID: "user-1", Role: "user"}))
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/platform/state", nil))
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", response.Code)
	}
}

func withTestUser(user auth.User) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), user)))
		})
	}
}
