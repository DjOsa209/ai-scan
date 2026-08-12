package notification

import (
	"encoding/json"
	"errors"
	"net/http"

	"ai-code-scan-platform/internal/auth"
)

type Handler struct {
	service     *Service
	requireUser func(http.Handler) http.Handler
}

func NewHandler(service *Service, requireUser func(http.Handler) http.Handler) *Handler {
	return &Handler{service: service, requireUser: requireUser}
}

func (handler *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/notifications/preferences", handler.requireUser(http.HandlerFunc(handler.getPreference)))
	mux.Handle("PUT /api/v1/notifications/preferences", handler.requireUser(http.HandlerFunc(handler.updatePreference)))
	mux.Handle("POST /api/v1/notifications/webhook/test", handler.requireUser(http.HandlerFunc(handler.testWebhook)))
}

func (handler *Handler) getPreference(response http.ResponseWriter, request *http.Request) {
	user, _ := auth.UserFromContext(request.Context())
	preference, err := handler.service.Preference(request.Context(), user.ID)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "notification_preferences_failed", "failed to load notification preferences")
		return
	}
	writeJSON(response, http.StatusOK, preference)
}

func (handler *Handler) updatePreference(response http.ResponseWriter, request *http.Request) {
	var input struct {
		ApplicationEnabled bool   `json:"applicationEnabled"`
		WebhookEnabled     bool   `json:"webhookEnabled"`
		WebhookURL         string `json:"webhookUrl"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", "invalid notification preference payload")
		return
	}
	user, _ := auth.UserFromContext(request.Context())
	preference, err := handler.service.UpdatePreference(request.Context(), user.ID, input.ApplicationEnabled, input.WebhookEnabled, input.WebhookURL)
	if errors.Is(err, ErrWebhookRequired) {
		writeError(response, http.StatusBadRequest, "webhook_required", "启用 Webhook 前请先填写飞书 Webhook 地址")
		return
	}
	if err != nil {
		writeError(response, http.StatusBadRequest, "notification_preferences_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusOK, preference)
}

func (handler *Handler) testWebhook(response http.ResponseWriter, request *http.Request) {
	user, _ := auth.UserFromContext(request.Context())
	if err := handler.service.TestWebhook(request.Context(), user.ID); err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, ErrWebhookNotConfigured) {
			status = http.StatusBadRequest
		}
		writeError(response, status, "webhook_test_failed", err.Error())
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, map[string]string{"code": code, "message": message})
}
