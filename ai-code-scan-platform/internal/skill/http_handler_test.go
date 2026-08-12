package skill

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type stubApplication struct {
	resolved ResolvedSkill
}

func (application stubApplication) Register(context.Context, CreateSourceInput) (Source, Version, error) {
	return Source{}, Version{}, nil
}
func (application stubApplication) Refresh(context.Context, int64) (Version, error) {
	return Version{}, nil
}
func (application stubApplication) Resolve(context.Context) (ResolvedSkill, error) {
	return application.resolved, nil
}

func TestResolveSupportsETag(t *testing.T) {
	mux := http.NewServeMux()
	NewHandler(stubApplication{resolved: ResolvedSkill{SkillID: 1, SHA256: "abc", Content: "skill"}}, "admin").RegisterRoutes(mux)

	first := httptest.NewRecorder()
	mux.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/api/v1/plugin/skills/resolve", nil))
	if first.Code != http.StatusOK || first.Header().Get("ETag") != `"abc"` {
		t.Fatalf("unexpected first response: %d %s", first.Code, first.Body.String())
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/plugin/skills/resolve", nil)
	request.Header.Set("If-None-Match", `"abc"`)
	cached := httptest.NewRecorder()
	mux.ServeHTTP(cached, request)
	if cached.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", cached.Code)
	}
}

func TestAdminRoutesRequireToken(t *testing.T) {
	mux := http.NewServeMux()
	NewHandler(stubApplication{}, "admin-secret").RegisterRoutes(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/admin/skills", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
}
