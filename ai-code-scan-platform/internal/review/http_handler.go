package review

import (
	"encoding/json"
	"errors"
	"net/http"
)

type Handler struct {
	service      *Service
	maxBodyBytes int64
}

func NewHandler(service *Service, maxBodyBytes int64) *Handler {
	return &Handler{service: service, maxBodyBytes: maxBodyBytes}
}

func (handler *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/plugin/reviews", handler.review)
	mux.HandleFunc("POST /api/v1/models/test-connection", handler.testConnection)
}

func (handler *Handler) testConnection(response http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(response, request.Body, 64*1024)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var input ConnectionInput
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid model connection request")
		return
	}
	result, err := handler.service.TestConnection(request.Context(), input)
	if err != nil {
		writeError(response, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (handler *Handler) review(response http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(response, request.Body, handler.maxBodyBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var input Input
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid review request")
		return
	}
	result, err := handler.service.Run(request.Context(), input)
	if err != nil {
		switch {
		case errors.Is(err, ErrBusy):
			writeError(response, http.StatusTooManyRequests, err.Error())
		case errors.Is(err, ErrModelNotConfigured):
			writeError(response, http.StatusServiceUnavailable, err.Error())
		default:
			writeError(response, http.StatusBadGateway, err.Error())
		}
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func writeError(response http.ResponseWriter, status int, message string) {
	writeJSON(response, status, map[string]string{"error": message})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
