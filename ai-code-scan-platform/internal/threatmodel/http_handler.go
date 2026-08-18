package threatmodel

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
)

type Application interface {
	Create(context.Context, CreateModelInput) (Model, error)
	List(context.Context) ([]Model, error)
	Get(context.Context, string) (Model, error)
	StartRun(context.Context, string) (Model, error)
	UpdateThreat(context.Context, string, string, UpdateThreatInput) (Model, error)
	CreateThreat(context.Context, string, CreateThreatInput) (Model, error)
}

type Handler struct {
	application Application
	requireUser func(http.Handler) http.Handler
}

func NewHandler(application Application, requireUser func(http.Handler) http.Handler) *Handler {
	return &Handler{application: application, requireUser: requireUser}
}

func (handler *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/threat-models", handler.requireUser(http.HandlerFunc(handler.list)))
	mux.Handle("POST /api/v1/threat-models", handler.requireUser(http.HandlerFunc(handler.create)))
	mux.Handle("GET /api/v1/threat-models/{id}", handler.requireUser(http.HandlerFunc(handler.get)))
	mux.Handle("POST /api/v1/threat-models/{id}/runs", handler.requireUser(http.HandlerFunc(handler.startRun)))
	mux.Handle("PATCH /api/v1/threat-models/{id}/threats/{threatId}", handler.requireUser(http.HandlerFunc(handler.updateThreat)))
	mux.Handle("POST /api/v1/threat-models/{id}/threats", handler.requireUser(http.HandlerFunc(handler.createThreat)))
}

func (handler *Handler) list(response http.ResponseWriter, request *http.Request) {
	models, err := handler.application.List(request.Context())
	if err != nil {
		log.Printf("list threat models: %v", err)
		writeError(response, http.StatusInternalServerError, "threat_model_list_failed", "failed to list threat models")
		return
	}
	for index := range models {
		models[index] = publicModel(models[index])
	}
	writeJSON(response, http.StatusOK, models)
}

func (handler *Handler) create(response http.ResponseWriter, request *http.Request) {
	var input CreateModelInput
	if err := decodeJSON(response, request, 8*1024*1024, &input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	model, err := handler.application.Create(request.Context(), input)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "threat_model_creation_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusCreated, publicModel(model))
}

func (handler *Handler) get(response http.ResponseWriter, request *http.Request) {
	model, err := handler.application.Get(request.Context(), request.PathValue("id"))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeError(response, http.StatusNotFound, "threat_model_not_found", "threat model not found")
			return
		}
		writeError(response, http.StatusUnprocessableEntity, "threat_model_load_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusOK, publicModel(model))
}

func (handler *Handler) startRun(response http.ResponseWriter, request *http.Request) {
	model, err := handler.application.StartRun(request.Context(), request.PathValue("id"))
	if err != nil {
		status := http.StatusUnprocessableEntity
		code := "threat_model_run_failed"
		if errors.Is(err, ErrNotFound) {
			status, code = http.StatusNotFound, "threat_model_not_found"
		} else if errors.Is(err, ErrAlreadyRunning) {
			status, code = http.StatusConflict, "threat_model_already_running"
		}
		writeError(response, status, code, err.Error())
		return
	}
	writeJSON(response, http.StatusOK, publicModel(model))
}

func (handler *Handler) updateThreat(response http.ResponseWriter, request *http.Request) {
	var input UpdateThreatInput
	if err := decodeJSON(response, request, 16*1024, &input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	model, err := handler.application.UpdateThreat(request.Context(), request.PathValue("id"), request.PathValue("threatId"), input)
	if err != nil {
		status := http.StatusUnprocessableEntity
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		}
		writeError(response, status, "threat_update_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusOK, publicModel(model))
}

func (handler *Handler) createThreat(response http.ResponseWriter, request *http.Request) {
	var input CreateThreatInput
	if err := decodeJSON(response, request, 128*1024, &input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	model, err := handler.application.CreateThreat(request.Context(), request.PathValue("id"), input)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "threat_creation_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusCreated, publicModel(model))
}

// publicModel keeps uploaded design contents server-side. The browser only needs
// document names after creation; returning multi-megabyte inputs on every list or
// triage request would unnecessarily expose and duplicate the analysis payload.
func publicModel(model Model) Model {
	model.Configuration.ScopeDocuments = publicDocuments(model.Configuration.ScopeDocuments)
	if model.LatestRun != nil {
		run := *model.LatestRun
		run.Configuration.ScopeDocuments = publicDocuments(run.Configuration.ScopeDocuments)
		model.LatestRun = &run
	}
	return model
}

func publicDocuments(documents []Document) []Document {
	result := make([]Document, len(documents))
	for index, document := range documents {
		result[index] = Document{Name: document.Name}
	}
	return result
}

func decodeJSON(response http.ResponseWriter, request *http.Request, limit int64, output any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, limit))
	decoder.DisallowUnknownFields()
	return decoder.Decode(output)
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, map[string]string{"code": code, "message": message})
}
