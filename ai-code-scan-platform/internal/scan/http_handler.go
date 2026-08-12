package scan

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
)

type Application interface {
	CreatePlatform(context.Context, CreateTaskInput) (Task, error)
	CreatePlatformArchive(context.Context, CreateTaskInput, string, []byte) (Task, error)
	ListRepositoryBranches(context.Context, string, string) ([]string, error)
	RescanForUser(context.Context, string) (Task, error)
	CreatePlugin(context.Context, CreateTaskInput) (Task, error)
	Get(context.Context, string) (Task, error)
	GetForUser(context.Context, string) (Task, error)
	DeleteForUser(context.Context, string) error
	GetDetailForUser(context.Context, string) (TaskDetail, error)
	ListForUser(context.Context, int, int) ([]Task, error)
	StatisticsForUser(context.Context, int) (Statistics, error)
	ListPlugin(context.Context, int, int) ([]Task, error)
	Update(context.Context, string, UpdateTaskInput) (Task, error)
	UpdateForUser(context.Context, string, UpdateTaskInput) (Task, error)
	UploadReport(context.Context, string, UploadReportInput) (Task, error)
	UploadReportForUser(context.Context, string, UploadReportInput) (Task, error)
	GetRepositoryCredential(context.Context, string) (RepositoryCredential, error)
	GetSourceArchive(context.Context, string) ([]byte, string, error)
}

type Handler struct {
	application       Application
	adminToken        string
	requireUser       func(http.Handler) http.Handler
	requirePluginUser func(http.Handler) http.Handler
}

func (handler *Handler) WithPluginAuthentication(requireUser func(http.Handler) http.Handler) *Handler {
	handler.requirePluginUser = requireUser
	return handler
}

func NewHandler(application Application, adminToken string, requireUser ...func(http.Handler) http.Handler) *Handler {
	unauthorized := func(http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			writeError(response, http.StatusUnauthorized, "unauthorized", "valid user authentication required")
		})
	}
	handler := &Handler{application: application, adminToken: adminToken, requireUser: unauthorized, requirePluginUser: unauthorized}
	if len(requireUser) > 0 {
		handler.requireUser = requireUser[0]
	}
	return handler
}

func (handler *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/scans", handler.requireUser(http.HandlerFunc(handler.createPlatform)))
	mux.Handle("POST /api/v1/scans/archive", handler.requireUser(http.HandlerFunc(handler.createPlatformArchive)))
	mux.Handle("POST /api/v1/repositories/branches", handler.requireUser(http.HandlerFunc(handler.listRepositoryBranches)))
	mux.Handle("POST /api/v1/scans/{id}/rescan", handler.requireUser(http.HandlerFunc(handler.rescanPlatform)))
	mux.Handle("GET /api/v1/scans", handler.requireUser(http.HandlerFunc(handler.listPlatform)))
	mux.Handle("GET /api/v1/scans/statistics", handler.requireUser(http.HandlerFunc(handler.statistics)))
	mux.Handle("GET /api/v1/scans/{id}", handler.requireUser(http.HandlerFunc(handler.getPlatform)))
	mux.Handle("DELETE /api/v1/scans/{id}", handler.requireUser(http.HandlerFunc(handler.deletePlatform)))
	mux.Handle("GET /api/v1/plugin/scans", handler.requirePluginUser(http.HandlerFunc(handler.listPlugin)))
	mux.Handle("POST /api/v1/plugin/scans", handler.requirePluginUser(http.HandlerFunc(handler.createPlugin)))
	mux.Handle("PATCH /api/v1/plugin/scans/{id}", handler.requirePluginUser(http.HandlerFunc(handler.update)))
	mux.Handle("PUT /api/v1/plugin/scans/{id}/report", handler.requirePluginUser(http.HandlerFunc(handler.uploadReport)))
	mux.Handle("PUT /api/v1/admin/scans/{id}/report", handler.requireAdmin(http.HandlerFunc(handler.uploadPlatformReport)))
	mux.Handle("PATCH /api/v1/admin/scans/{id}", handler.requireAdmin(http.HandlerFunc(handler.updatePlatform)))
	mux.Handle("GET /api/v1/admin/scans/{id}/repository-credential", handler.requireAdmin(http.HandlerFunc(handler.getRepositoryCredential)))
	mux.Handle("GET /api/v1/admin/scans/{id}/source-archive", handler.requireAdmin(http.HandlerFunc(handler.getSourceArchive)))
}

func (handler *Handler) getSourceArchive(response http.ResponseWriter, request *http.Request) {
	content, filename, err := handler.application.GetSourceArchive(request.Context(), request.PathValue("id"))
	if err != nil {
		writeError(response, http.StatusNotFound, "source_archive_not_found", "source archive not found")
		return
	}
	response.Header().Set("Content-Type", "application/zip")
	response.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(filename, `"`, "")+`"`)
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(content)
}

func (handler *Handler) listRepositoryBranches(response http.ResponseWriter, request *http.Request) {
	var input struct {
		RepositoryURL   string `json:"repositoryUrl"`
		RepositoryToken string `json:"repositoryToken"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 8*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	branches, err := handler.application.ListRepositoryBranches(request.Context(), input.RepositoryURL, input.RepositoryToken)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "repository_access_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusOK, struct {
		Branches []string `json:"branches"`
	}{Branches: branches})
}

func (handler *Handler) rescanPlatform(response http.ResponseWriter, request *http.Request) {
	task, err := handler.application.RescanForUser(request.Context(), request.PathValue("id"))
	if err != nil {
		if errors.Is(err, ErrInsufficientCredits) {
			writeError(response, http.StatusPaymentRequired, "insufficient_credits", err.Error())
			return
		}
		writeError(response, http.StatusUnprocessableEntity, "scan_rescan_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusAccepted, task)
}

func (handler *Handler) deletePlatform(response http.ResponseWriter, request *http.Request) {
	if err := handler.application.DeleteForUser(request.Context(), request.PathValue("id")); err != nil {
		writeError(response, http.StatusNotFound, "scan_not_found", "completed scan task not found")
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) getRepositoryCredential(response http.ResponseWriter, request *http.Request) {
	credential, err := handler.application.GetRepositoryCredential(request.Context(), request.PathValue("id"))
	if err != nil {
		writeError(response, http.StatusNotFound, "repository_credential_not_found", "repository credential not found")
		return
	}
	response.Header().Set("Cache-Control", "no-store")
	writeJSON(response, http.StatusOK, credential)
}

func (handler *Handler) statistics(response http.ResponseWriter, request *http.Request) {
	offset := 0
	if value := request.URL.Query().Get("timezoneOffsetMinutes"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(response, http.StatusBadRequest, "invalid_timezone_offset", "timezoneOffsetMinutes must be an integer")
			return
		}
		offset = parsed
	}
	statistics, err := handler.application.StatisticsForUser(request.Context(), offset)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "scan_statistics_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusOK, statistics)
}

func (handler *Handler) listPlatform(response http.ResponseWriter, request *http.Request) {
	limit, offset, err := scanListPage(request)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid_pagination", err.Error())
		return
	}
	tasks, err := handler.application.ListForUser(request.Context(), limit, offset)
	if err != nil {
		log.Printf("list scan tasks: %v", err)
		writeError(response, http.StatusInternalServerError, "scan_list_failed", "failed to list scan tasks")
		return
	}
	writeJSON(response, http.StatusOK, tasks)
}

func (handler *Handler) listPlugin(response http.ResponseWriter, request *http.Request) {
	limit, offset, err := scanListPage(request)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid_pagination", err.Error())
		return
	}
	tasks, err := handler.application.ListForUser(request.Context(), limit, offset)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "scan_list_failed", "failed to list plugin scan tasks")
		return
	}
	writeJSON(response, http.StatusOK, tasks)
}

func scanListPage(request *http.Request) (int, int, error) {
	limit := 20
	offset := 0
	var err error
	if value := request.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil || limit < 1 || limit > 100 {
			return 0, 0, errors.New("limit must be between 1 and 100")
		}
	}
	if value := request.URL.Query().Get("offset"); value != "" {
		offset, err = strconv.Atoi(value)
		if err != nil || offset < 0 {
			return 0, 0, errors.New("offset must be a non-negative integer")
		}
	}
	return limit, offset, nil
}

func (handler *Handler) update(response http.ResponseWriter, request *http.Request) {
	handler.decodeAndUpdate(response, request, true)
}

func (handler *Handler) updatePlatform(response http.ResponseWriter, request *http.Request) {
	handler.decodeAndUpdate(response, request, false)
}

func (handler *Handler) decodeAndUpdate(response http.ResponseWriter, request *http.Request, forUser bool) {
	var input UpdateTaskInput
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	var task Task
	var err error
	if forUser {
		task, err = handler.application.UpdateForUser(request.Context(), request.PathValue("id"), input)
	} else {
		task, err = handler.application.Update(request.Context(), request.PathValue("id"), input)
	}
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "scan_update_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusOK, task)
}

func decodeCreateTask(response http.ResponseWriter, request *http.Request) (CreateTaskInput, error) {
	var input CreateTaskInput
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return CreateTaskInput{}, err
	}
	return input, nil
}

func (handler *Handler) createPlatform(response http.ResponseWriter, request *http.Request) {
	input, err := decodeCreateTask(response, request)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	task, err := handler.application.CreatePlatform(request.Context(), input)
	if err != nil {
		if errors.Is(err, ErrInsufficientCredits) {
			writeError(response, http.StatusPaymentRequired, "insufficient_credits", err.Error())
			return
		}
		writeError(response, http.StatusUnprocessableEntity, "scan_creation_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusAccepted, task)
}

func (handler *Handler) createPlatformArchive(response http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(response, request.Body, 65*1024*1024)
	if err := request.ParseMultipartForm(65 * 1024 * 1024); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_archive_request", err.Error())
		return
	}
	file, header, err := request.FormFile("archive")
	if err != nil {
		writeError(response, http.StatusBadRequest, "archive_required", "archive ZIP file is required")
		return
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, 64*1024*1024+1))
	if err != nil {
		writeError(response, http.StatusBadRequest, "archive_read_failed", err.Error())
		return
	}
	if len(content) > 64*1024*1024 {
		writeError(response, http.StatusRequestEntityTooLarge, "archive_too_large", "archive must not exceed 64 MiB")
		return
	}
	if _, err := zip.NewReader(bytes.NewReader(content), int64(len(content))); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_zip", "archive must be a valid ZIP file")
		return
	}
	var input CreateTaskInput
	decoder := json.NewDecoder(strings.NewReader(request.FormValue("metadata")))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	task, err := handler.application.CreatePlatformArchive(request.Context(), input, header.Filename, content)
	if err != nil {
		if errors.Is(err, ErrInsufficientCredits) {
			writeError(response, http.StatusPaymentRequired, "insufficient_credits", err.Error())
			return
		}
		writeError(response, http.StatusUnprocessableEntity, "scan_creation_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusAccepted, task)
}

func (handler *Handler) createPlugin(response http.ResponseWriter, request *http.Request) {
	input, err := decodeCreateTask(response, request)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	task, err := handler.application.CreatePlugin(request.Context(), input)
	if err != nil {
		if errors.Is(err, ErrInsufficientCredits) {
			writeError(response, http.StatusPaymentRequired, "insufficient_credits", err.Error())
			return
		}
		writeError(response, http.StatusUnprocessableEntity, "scan_creation_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusAccepted, task)
}

func (handler *Handler) uploadReport(response http.ResponseWriter, request *http.Request) {
	handler.decodeAndUploadReport(response, request, true)
}

func (handler *Handler) uploadPlatformReport(response http.ResponseWriter, request *http.Request) {
	handler.decodeAndUploadReport(response, request, false)
}

func (handler *Handler) decodeAndUploadReport(response http.ResponseWriter, request *http.Request, forUser bool) {
	var input UploadReportInput
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 32*1024*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	var task Task
	var err error
	if forUser {
		task, err = handler.application.UploadReportForUser(request.Context(), request.PathValue("id"), input)
	} else {
		task, err = handler.application.UploadReport(request.Context(), request.PathValue("id"), input)
	}
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "report_upload_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusOK, task)
}

func (handler *Handler) getPlatform(response http.ResponseWriter, request *http.Request) {
	task, err := handler.application.GetDetailForUser(request.Context(), request.PathValue("id"))
	if err != nil {
		writeError(response, http.StatusNotFound, "scan_not_found", err.Error())
		return
	}
	writeJSON(response, http.StatusOK, task)
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
