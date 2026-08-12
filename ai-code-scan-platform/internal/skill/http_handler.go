package skill

import (
	"context"
	"encoding/json"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Application interface {
	Register(context.Context, CreateSourceInput) (Source, Version, error)
	Refresh(context.Context, int64) (Version, error)
	Resolve(context.Context) (ResolvedSkill, error)
}

type Handler struct {
	application Application
	adminToken  string
	builtInRoot string
}

func NewHandler(application Application, adminToken string) *Handler {
	return &Handler{application: application, adminToken: adminToken}
}

func (handler *Handler) WithBuiltInRoot(root string) *Handler {
	handler.builtInRoot = root
	return handler
}

func (handler *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/plugin/skills/resolve", handler.resolve)
	mux.HandleFunc("GET /api/v1/plugin/skills/security-baseline-review/{path...}", handler.builtInAsset)
	mux.Handle("POST /api/v1/admin/skills", handler.requireAdmin(http.HandlerFunc(handler.register)))
	mux.Handle("POST /api/v1/admin/skills/{id}/refresh", handler.requireAdmin(http.HandlerFunc(handler.refresh)))
}

func (handler *Handler) builtInAsset(response http.ResponseWriter, request *http.Request) {
	relativePath := filepath.Clean(request.PathValue("path"))
	if relativePath == "." {
		relativePath = "SKILL.md"
	}
	if handler.builtInRoot == "" || filepath.IsAbs(relativePath) || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		writeError(response, http.StatusNotFound, "skill_asset_not_found", "Skill asset not found")
		return
	}
	content, err := os.ReadFile(filepath.Join(handler.builtInRoot, relativePath))
	if err != nil {
		writeError(response, http.StatusNotFound, "skill_asset_not_found", "Skill asset not found")
		return
	}
	contentType := mime.TypeByExtension(filepath.Ext(relativePath))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	response.Header().Set("Content-Type", contentType)
	response.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = response.Write(content)
}

func (handler *Handler) resolve(response http.ResponseWriter, request *http.Request) {
	resolved, err := handler.application.Resolve(request.Context())
	if err != nil {
		writeError(response, http.StatusNotFound, "default_skill_not_found", err.Error())
		return
	}
	etag := `"` + resolved.SHA256 + `"`
	response.Header().Set("ETag", etag)
	response.Header().Set("Cache-Control", "private, max-age=300")
	if request.Header.Get("If-None-Match") == etag {
		response.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(response, http.StatusOK, resolved)
}

func (handler *Handler) register(response http.ResponseWriter, request *http.Request) {
	var input CreateSourceInput
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	source, version, err := handler.application.Register(request.Context(), input)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "skill_registration_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusCreated, map[string]any{"source": source, "version": version})
}

func (handler *Handler) refresh(response http.ResponseWriter, request *http.Request) {
	sourceID, err := strconv.ParseInt(request.PathValue("id"), 10, 64)
	if err != nil || sourceID <= 0 {
		writeError(response, http.StatusBadRequest, "invalid_skill_id", "skill id must be a positive integer")
		return
	}
	version, err := handler.application.Refresh(request.Context(), sourceID)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "skill_refresh_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusOK, version)
}

func (handler *Handler) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if handler.adminToken == "" || request.Header.Get("Authorization") != "Bearer "+handler.adminToken {
			writeError(response, http.StatusUnauthorized, "unauthorized", "valid administrator token required")
			return
		}
		next.ServeHTTP(response, request)
	})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, map[string]string{"code": code, "message": message})
}
