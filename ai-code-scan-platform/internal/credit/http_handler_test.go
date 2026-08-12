package credit

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"ai-code-scan-platform/internal/auth"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestAdminCanGrantCredits(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT available FROM credit_accounts").WithArgs("user-42").
		WillReturnRows(sqlmock.NewRows([]string{"available"}).AddRow(69))
	mock.ExpectExec("UPDATE credit_accounts").WithArgs(uint64(202), "user-42").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO credit_transactions").
		WithArgs(sqlmock.AnyArg(), "user-42", int64(133), uint64(202), "Administrator admin-1: Scan allowance").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	handler := NewHandler(NewRepository(database), withUser(auth.User{ID: "admin-1", Role: "admin"}), auth.NewHandler(nil).RequireAdmin)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/user-42/credits", bytes.NewBufferString(`{"amount":133,"description":"Scan allowance"}`))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"available":202`)) {
		t.Fatalf("expected updated balance, got %d: %s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAdminCanListCreditAccounts(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	now := time.Now()
	mock.ExpectQuery("SELECT credit_accounts.user_id, users.email").WillReturnRows(
		sqlmock.NewRows([]string{"user_id", "email", "role", "active", "created_at", "available", "frozen", "lifetime_used", "updated_at"}).
			AddRow("user-42", "user@example.com", "user", true, now, 69, 0, 31, now))

	handler := NewHandler(NewRepository(database), withUser(auth.User{ID: "admin-1", Role: "admin"}), auth.NewHandler(nil).RequireAdmin)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/admin/credits/accounts", nil))

	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"email":"user@example.com"`)) {
		t.Fatalf("expected account list, got %d: %s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRegularUserCannotGrantCredits(t *testing.T) {
	handler := NewHandler(nil, withUser(auth.User{ID: "user-1", Role: "user"}), auth.NewHandler(nil).RequireAdmin)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/user-42/credits", bytes.NewBufferString(`{"amount":133}`))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", response.Code, response.Body.String())
	}
}

func TestGrantCreditsRejectsInvalidAmount(t *testing.T) {
	handler := NewHandler(nil, withUser(auth.User{ID: "admin-1", Role: "admin"}), auth.NewHandler(nil).RequireAdmin)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/user-42/credits", bytes.NewBufferString(`{"amount":0}`))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
}

func withUser(user auth.User) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(context.Background(), user)))
		})
	}
}
