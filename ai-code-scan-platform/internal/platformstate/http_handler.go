package platformstate

import (
	"encoding/json"
	"errors"
	"net/http"

	"ai-code-scan-platform/internal/auth"
)

const workspaceID = "default"

type Handler struct {
	service     *Service
	adminToken  string
	requireUser func(http.Handler) http.Handler
}

func NewHandler(service *Service, adminToken string, requireUser ...func(http.Handler) http.Handler) *Handler {
	handler := &Handler{service: service, adminToken: adminToken, requireUser: func(http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			writeError(response, http.StatusUnauthorized, "unauthorized", "valid user session required")
		})
	}}
	if len(requireUser) > 0 {
		handler.requireUser = requireUser[0]
	}
	return handler
}

func (handler *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/platform/state", handler.requireAdmin(http.HandlerFunc(handler.get)))
	mux.Handle("PUT /api/v1/platform/state", handler.requireAdmin(http.HandlerFunc(handler.save)))
}

func (handler *Handler) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if handler.adminToken != "" && request.Header.Get("Authorization") == "Bearer "+handler.adminToken {
			next.ServeHTTP(response, request)
			return
		}
		handler.requireUser(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			user, _ := auth.UserFromContext(request.Context())
			if user.Role != "admin" {
				writeError(response, http.StatusForbidden, "forbidden", "administrator role required")
				return
			}
			next.ServeHTTP(response, request)
		})).ServeHTTP(response, request)
	})
}

func (handler *Handler) get(response http.ResponseWriter, request *http.Request) {
	snapshot, err := handler.service.GetPublic(request.Context(), workspaceID)
	if errors.Is(err, ErrNotFound) {
		writeError(response, http.StatusNotFound, "state_not_initialized", "platform state has not been initialized")
		return
	}
	if err != nil {
		writeError(response, http.StatusInternalServerError, "state_read_failed", "failed to read platform state")
		return
	}
	writeJSON(response, http.StatusOK, snapshot)
}

func (handler *Handler) save(response http.ResponseWriter, request *http.Request) {
	var input Snapshot
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 4<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	snapshot, err := handler.service.Save(request.Context(), workspaceID, input.Revision, input.State)
	if err != nil {
		writeError(response, http.StatusConflict, "state_save_failed", err.Error())
		return
	}
	snapshot.State, err = redactModelSecrets(snapshot.State)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "state_redaction_failed", "failed to redact platform state")
		return
	}
	writeJSON(response, http.StatusOK, snapshot)
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, map[string]string{"code": code, "message": message})
}
