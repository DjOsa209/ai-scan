package modelproxy

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"ai-code-scan-platform/internal/review"
)

type Handler struct {
	service      *Service
	adminToken   string
	maxBodyBytes int64
}

func NewHandler(service *Service, adminToken string, maxBodyBytes int64) *Handler {
	return &Handler{service: service, adminToken: adminToken, maxBodyBytes: maxBodyBytes}
}

func (handler *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/admin/scans/{id}/model-session", handler.requireAdmin(http.HandlerFunc(handler.issue)))
	mux.HandleFunc("POST /api/v1/model-proxy/completions", handler.complete)
}

func (handler *Handler) issue(response http.ResponseWriter, request *http.Request) {
	session, err := handler.service.Issue(request.Context(), request.PathValue("id"))
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "model_session_failed")
		return
	}
	writeJSON(response, http.StatusCreated, session)
}

func (handler *Handler) complete(response http.ResponseWriter, request *http.Request) {
	token := strings.TrimSpace(strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer "))
	if token == "" {
		writeError(response, http.StatusUnauthorized, "model_session_required")
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, handler.maxBodyBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var input PromptInput
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_prompt_request")
		return
	}
	result, err := handler.service.Complete(request.Context(), token, input)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidSession):
			writeError(response, http.StatusUnauthorized, "invalid_model_session")
		case errors.Is(err, review.ErrBusy):
			writeError(response, http.StatusTooManyRequests, "model_proxy_busy")
		default:
			writeError(response, http.StatusBadGateway, "model_proxy_failed")
		}
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *Handler) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if handler.adminToken == "" || request.Header.Get("Authorization") != "Bearer "+handler.adminToken {
			writeError(response, http.StatusUnauthorized, "administrator_token_required")
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

func writeError(response http.ResponseWriter, status int, code string) {
	writeJSON(response, status, map[string]string{"code": code})
}
