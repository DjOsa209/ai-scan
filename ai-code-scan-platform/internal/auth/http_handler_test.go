package auth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"golang.org/x/crypto/bcrypt"
)

func TestAuthConfigReturnsCanonicalSSOLoginURL(t *testing.T) {
	handler := NewHandler(nil).WithSSO(SSOConfig{
		Enabled:     true,
		Provider:    "uac",
		FrontendURL: "http://localhost:8080/",
	}, http.DefaultClient)

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/api/v1/auth/config", nil)
	response := httptest.NewRecorder()
	handler.authConfig(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected auth config, got %d", response.Code)
	}
	var configuration struct {
		SSOEnabled  bool   `json:"ssoEnabled"`
		SSOLoginURL string `json:"ssoLoginUrl"`
	}
	if err := json.NewDecoder(response.Body).Decode(&configuration); err != nil {
		t.Fatal(err)
	}
	if !configuration.SSOEnabled || configuration.SSOLoginURL != "http://localhost:8080/api/v1/auth/sso/login" {
		t.Fatalf("unexpected auth config: %#v", configuration)
	}
}

func TestListUserAPIKeyStatusesIncludesInactiveUsers(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	createdAt := time.Now()
	mock.ExpectQuery("SELECT users.id, users.email, users.role, users.active").
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "role", "active", "created_at", "key_prefix", "key_encrypted", "updated_at", "display_name", "employee_no", "department", "auth_provider", "last_login_at"}).
			AddRow("user-1", "active@example.com", "user", true, createdAt, nil, nil, nil, "Local User", "", "", "local", nil).
			AddRow("user-2", "inactive@example.com", "user", false, createdAt, nil, nil, nil, "SSO User", "10001", "Security", "uac", createdAt))

	statuses, err := NewRepository(database).ListUserAPIKeyStatuses(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(statuses) != 2 || !statuses[0].Active || statuses[1].Active {
		t.Fatalf("expected active and inactive MySQL users, got %#v", statuses)
	}
	if statuses[1].AuthProvider != "uac" || statuses[1].EmployeeNo != "10001" {
		t.Fatalf("expected SSO profile in user management, got %#v", statuses[1])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRequireAdminRejectsRegularUser(t *testing.T) {
	handler := NewHandler(nil)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users/api-keys", nil)
	request = request.WithContext(WithUser(request.Context(), User{ID: "user-1", Role: "user"}))
	response := httptest.NewRecorder()

	handler.RequireAdmin(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("regular user reached administrator handler")
	})).ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", response.Code, response.Body.String())
	}
}

func TestAdminCanChangePassword(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	currentHash, err := bcrypt.GenerateFromPassword([]byte("current-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT id, email, role, created_at, password_hash FROM users WHERE id = \\?").
		WithArgs("admin-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "role", "created_at", "password_hash"}).
			AddRow("admin-1", "admin@example.com", "admin", time.Now(), string(currentHash)))
	mock.ExpectExec("UPDATE users SET password_hash = \\? WHERE id = \\? AND role = 'admin'").
		WithArgs(sqlmock.AnyArg(), "admin-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler := NewHandler(NewService(NewRepository(database)))
	request := httptest.NewRequest(http.MethodPut, "/api/v1/auth/password", bytes.NewBufferString(`{"currentPassword":"current-password","newPassword":"new-secure-password"}`))
	request = request.WithContext(WithUser(request.Context(), User{ID: "admin-1", Role: "admin"}))
	response := httptest.NewRecorder()

	handler.RequireAdmin(http.HandlerFunc(handler.changePassword)).ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAdminPasswordChangeRejectsIncorrectCurrentPassword(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	currentHash, err := bcrypt.GenerateFromPassword([]byte("current-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT id, email, role, created_at, password_hash FROM users WHERE id = \\?").
		WithArgs("admin-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "role", "created_at", "password_hash"}).
			AddRow("admin-1", "admin@example.com", "admin", time.Now(), string(currentHash)))

	handler := NewHandler(NewService(NewRepository(database)))
	request := httptest.NewRequest(http.MethodPut, "/api/v1/auth/password", bytes.NewBufferString(`{"currentPassword":"wrong-password","newPassword":"new-secure-password"}`))
	request = request.WithContext(WithUser(request.Context(), User{ID: "admin-1", Role: "admin"}))
	response := httptest.NewRecorder()

	handler.RequireAdmin(http.HandlerFunc(handler.changePassword)).ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAdminCanRotateUserAPIKey(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	mock.ExpectExec("INSERT INTO user_api_keys").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "", "user-42").
		WillReturnResult(sqlmock.NewResult(0, 1))
	handler := NewHandler(NewService(NewRepository(database)))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/user-42/api-key", nil)
	request.SetPathValue("id", "user-42")
	request = request.WithContext(WithUser(request.Context(), User{ID: "admin-1", Role: "admin"}))
	response := httptest.NewRecorder()

	handler.RequireAdmin(http.HandlerFunc(handler.rotateUserAPIKey)).ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	var body map[string]string
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if key := body["apiKey"]; len(key) < 24 || key[:8] != "sk_user_" {
		t.Fatalf("expected one-time plaintext user key, got %q", key)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSessionCookieSecurity(t *testing.T) {
	expiresAt := time.Now().Add(time.Hour)
	localCookie := sessionCookie(httptest.NewRequest("GET", "http://localhost/", nil), "token", expiresAt)
	if !localCookie.HttpOnly || localCookie.SameSite != 2 || localCookie.Secure {
		t.Fatalf("unexpected localhost cookie: %#v", localCookie)
	}
	productionCookie := sessionCookie(httptest.NewRequest("GET", "https://scan.example.com/", nil), "token", expiresAt)
	if !productionCookie.HttpOnly || !productionCookie.Secure || productionCookie.SameSite != 2 {
		t.Fatalf("unexpected production cookie: %#v", productionCookie)
	}
}

func TestSessionTokenUsesSHA256Hash(t *testing.T) {
	token, storedHash, err := newSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	expected := sha256.Sum256([]byte(token))
	if string(storedHash) != string(expected[:]) || string(storedHash) == token {
		t.Fatal("session storage value must be the SHA-256 hash of the opaque token")
	}
}

func TestAPIKeyAuthenticationUsesHashedKey(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	key := "sk_user_test"
	keyHash := sha256.Sum256([]byte(key))
	mock.ExpectQuery("SELECT users.id, users.email, users.role, users.created_at").
		WithArgs(keyHash[:]).
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "role", "created_at"}).
			AddRow("user-42", "user@example.com", "user", time.Now()))

	handler := NewHandler(NewService(NewRepository(database)))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/plugin/scans", nil)
	request.Header.Set("Authorization", "Bearer "+key)
	response := httptest.NewRecorder()
	handler.RequireAPIKey(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		user, ok := UserFromContext(request.Context())
		if !ok || user.ID != "user-42" {
			t.Fatalf("expected API key owner in context, got %#v", user)
		}
		response.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", response.Code, response.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSessionAndAPIKeyAuthenticationAreNotInterchangeable(t *testing.T) {
	database, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	handler := NewHandler(NewService(NewRepository(database)))
	next := http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	})

	platformRequest := httptest.NewRequest(http.MethodPost, "/api/v1/scans", nil)
	platformRequest.Header.Set("Authorization", "Bearer sk_user_test")
	platformResponse := httptest.NewRecorder()
	handler.RequireUser(next).ServeHTTP(platformResponse, platformRequest)
	if platformResponse.Code != http.StatusUnauthorized {
		t.Fatalf("platform endpoint must reject API key authentication, got %d", platformResponse.Code)
	}

	pluginRequest := httptest.NewRequest(http.MethodPost, "/api/v1/plugin/scans", nil)
	pluginRequest.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "session-token"})
	pluginResponse := httptest.NewRecorder()
	handler.RequireAPIKey(next).ServeHTTP(pluginResponse, pluginRequest)
	if pluginResponse.Code != http.StatusUnauthorized {
		t.Fatalf("plugin endpoint must reject session authentication, got %d", pluginResponse.Code)
	}
}
