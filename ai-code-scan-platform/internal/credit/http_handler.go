package credit

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"ai-code-scan-platform/internal/auth"
)

type Handler struct {
	repository   *Repository
	requireUser  func(http.Handler) http.Handler
	requireAdmin func(http.Handler) http.Handler
}

func NewHandler(repository *Repository, requireUser, requireAdmin func(http.Handler) http.Handler) *Handler {
	return &Handler{repository: repository, requireUser: requireUser, requireAdmin: requireAdmin}
}

func (handler *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/credits", handler.requireUser(http.HandlerFunc(handler.account)))
	mux.Handle("GET /api/v1/credits/transactions", handler.requireUser(http.HandlerFunc(handler.transactions)))
	mux.Handle("GET /api/v1/admin/credits/accounts", handler.requireUser(handler.requireAdmin(http.HandlerFunc(handler.adminAccounts))))
	mux.Handle("POST /api/v1/admin/users/{id}/credits", handler.requireUser(handler.requireAdmin(http.HandlerFunc(handler.grant))))
}

func (handler *Handler) adminAccounts(response http.ResponseWriter, request *http.Request) {
	accounts, err := handler.repository.AdminAccounts(request.Context())
	if err != nil {
		writeError(response, http.StatusInternalServerError, "credit_accounts_failed", "failed to load credit accounts")
		return
	}
	writeJSON(response, http.StatusOK, accounts)
}

func (handler *Handler) account(response http.ResponseWriter, request *http.Request) {
	user, _ := auth.UserFromContext(request.Context())
	account, err := handler.repository.Account(request.Context(), user.ID)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "credit_account_failed", "failed to read credit account")
		return
	}
	writeJSON(response, http.StatusOK, account)
}

func (handler *Handler) transactions(response http.ResponseWriter, request *http.Request) {
	user, _ := auth.UserFromContext(request.Context())
	transactions, err := handler.repository.Transactions(request.Context(), user.ID, 100)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "credit_transactions_failed", "failed to read credit transactions")
		return
	}
	writeJSON(response, http.StatusOK, transactions)
}

func (handler *Handler) grant(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Amount      int64  `json:"amount"`
		Description string `json:"description"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if input.Amount <= 0 || input.Amount > 1_000_000_000 {
		writeError(response, http.StatusBadRequest, "invalid_amount", "amount must be between 1 and 1000000000")
		return
	}
	userID := request.PathValue("id")
	if userID == "" || len(userID) > 36 {
		writeError(response, http.StatusBadRequest, "invalid_user", "valid user id required")
		return
	}
	administrator, _ := auth.UserFromContext(request.Context())
	description := strings.TrimSpace(input.Description)
	if description == "" {
		description = "Administrator credit grant"
	}
	if len(description) > 400 {
		writeError(response, http.StatusBadRequest, "invalid_description", "description must not exceed 400 characters")
		return
	}
	newBalance, err := handler.repository.Grant(request.Context(), userID, uint64(input.Amount), "Administrator "+administrator.ID+": "+description)
	if err == sql.ErrNoRows {
		writeError(response, http.StatusNotFound, "credit_account_not_found", "credit account not found")
		return
	}
	if err != nil {
		writeError(response, http.StatusInternalServerError, "credit_grant_failed", "failed to grant credits")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"userId": userID, "available": newBalance})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, map[string]string{"code": code, "message": message})
}
