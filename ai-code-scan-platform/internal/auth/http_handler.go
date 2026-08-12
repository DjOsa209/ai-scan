package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type userContextKey struct{}

type Handler struct {
	service   *Service
	sso       *ssoClient
	frontend  string
	tokenMu   sync.RWMutex
	uacTokens map[string]UACTokens
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service, uacTokens: make(map[string]UACTokens)}
}

func (handler *Handler) WithSSO(configuration SSOConfig, client *http.Client) *Handler {
	if configuration.Enabled {
		handler.sso = &ssoClient{configuration: configuration, httpClient: client}
		handler.frontend = strings.TrimRight(configuration.FrontendURL, "/")
	}
	return handler
}

func (handler *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/login", handler.login)
	mux.HandleFunc("POST /api/v1/auth/logout", handler.logout)
	mux.HandleFunc("GET /api/v1/auth/config", handler.authConfig)
	mux.HandleFunc("GET /api/v1/auth/sso/login", handler.ssoLogin)
	mux.HandleFunc("GET /api/v1/auth/sso/callback", handler.ssoCallback)
	mux.HandleFunc("POST /api/v1/auth/sso/uac/callback", handler.ssoUACCallback)
	mux.Handle("GET /api/v1/auth/me", handler.RequireUser(http.HandlerFunc(handler.me)))
	mux.Handle("PUT /api/v1/auth/password", handler.RequireUser(handler.RequireAdmin(http.HandlerFunc(handler.changePassword))))
	mux.Handle("GET /api/v1/auth/api-key", handler.RequireUser(http.HandlerFunc(handler.getAPIKey)))
	mux.Handle("POST /api/v1/auth/api-key", handler.RequireUser(http.HandlerFunc(handler.rotateAPIKey)))
	mux.Handle("GET /api/v1/admin/users/api-keys", handler.RequireUser(handler.RequireAdmin(http.HandlerFunc(handler.listUserAPIKeys))))
	mux.Handle("POST /api/v1/admin/users/{id}/api-key", handler.RequireUser(handler.RequireAdmin(http.HandlerFunc(handler.rotateUserAPIKey))))
}

func (handler *Handler) authConfig(response http.ResponseWriter, _ *http.Request) {
	loginURL := ""
	if handler.sso != nil {
		loginURL = handler.frontend + "/api/v1/auth/sso/login"
	}
	writeJSON(response, http.StatusOK, map[string]any{"ssoEnabled": handler.sso != nil, "ssoLoginUrl": loginURL})
}

func (handler *Handler) ssoLogin(response http.ResponseWriter, request *http.Request) {
	if handler.sso == nil {
		writeError(response, http.StatusNotFound, "sso_disabled", "SSO login is not enabled")
		return
	}
	state, _, err := newSessionToken()
	if err != nil {
		writeError(response, http.StatusInternalServerError, "sso_state_failed", "failed to create SSO state")
		return
	}
	expires := time.Now().Add(10 * time.Minute)
	loginURL, err := handler.sso.authorizationURL(state)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "sso_login_failed", "failed to build SSO login URL")
		return
	}
	http.SetCookie(response, ssoStateCookie(request, state, expires))
	http.Redirect(response, request, loginURL, http.StatusFound)
}

func (handler *Handler) ssoCallback(response http.ResponseWriter, request *http.Request) {
	if handler.sso == nil {
		writeError(response, http.StatusNotFound, "sso_disabled", "SSO login is not enabled")
		return
	}
	stateCookie, err := request.Cookie(ssoStateCookieName)
	if err != nil || !statesMatch(stateCookie.Value, request.URL.Query().Get("state")) {
		writeError(response, http.StatusBadRequest, "invalid_sso_state", "SSO state is invalid or expired")
		return
	}
	identity, err := handler.sso.identity(request.Context(), request)
	if err != nil {
		writeError(response, http.StatusBadGateway, "sso_callback_failed", err.Error())
		return
	}
	handler.completeSSO(response, request, identity, true)
}

func (handler *Handler) ssoUACCallback(response http.ResponseWriter, request *http.Request) {
	if handler.sso == nil || handler.sso.configuration.Provider != "uac" {
		writeError(response, http.StatusNotFound, "sso_disabled", "UAC SSO login is not enabled")
		return
	}
	var input UACCallbackInput
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 64*1024))
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", "invalid UAC callback payload")
		return
	}
	stateCookie, err := request.Cookie(ssoStateCookieName)
	if err != nil || !statesMatch(stateCookie.Value, input.State) {
		writeError(response, http.StatusBadRequest, "invalid_sso_state", "SSO state is invalid or expired")
		return
	}
	identity, err := handler.sso.uacIdentityFromInput(request.Context(), input)
	if err != nil {
		writeError(response, http.StatusBadGateway, "sso_callback_failed", err.Error())
		return
	}
	handler.completeSSO(response, request, identity, false)
}

func (handler *Handler) completeSSO(response http.ResponseWriter, request *http.Request, identity SSOIdentity, redirect bool) {
	user, token, expiresAt, err := handler.service.LoginSSO(request.Context(), identity)
	if errors.Is(err, ErrInvalidIdentity) {
		writeError(response, http.StatusForbidden, "invalid_sso_identity", "SSO identity must include a stable ID and email")
		return
	}
	if err != nil {
		writeError(response, http.StatusInternalServerError, "sso_login_failed", "failed to create SSO user session")
		return
	}
	handler.rememberUACTokens(user.ID, identity)
	http.SetCookie(response, sessionCookie(request, token, expiresAt))
	http.SetCookie(response, ssoStateCookie(request, "", time.Unix(0, 0)))
	target := handler.frontend
	if target == "" {
		target = "/"
	}
	if redirect {
		http.Redirect(response, request, target, http.StatusFound)
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"next": target})
}

func (handler *Handler) RequireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		cookie, err := request.Cookie(SessionCookieName)
		if err != nil {
			writeError(response, http.StatusUnauthorized, "unauthorized", "valid user session required")
			return
		}
		user, err := handler.service.UserForToken(request.Context(), cookie.Value)
		if err != nil {
			writeError(response, http.StatusUnauthorized, "unauthorized", "valid user session required")
			return
		}
		next.ServeHTTP(response, request.WithContext(WithUser(request.Context(), user)))
	})
}

func (handler *Handler) RequireAPIKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		authorization := request.Header.Get("Authorization")
		if !strings.HasPrefix(authorization, "Bearer ") {
			writeError(response, http.StatusUnauthorized, "unauthorized", "valid user API key required")
			return
		}
		user, err := handler.service.UserForAPIKey(request.Context(), strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer ")))
		if err != nil {
			writeError(response, http.StatusUnauthorized, "unauthorized", "valid user API key required")
			return
		}
		next.ServeHTTP(response, request.WithContext(WithUser(request.Context(), user)))
	})
}

func (handler *Handler) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		user, ok := UserFromContext(request.Context())
		if !ok || user.Role != "admin" {
			writeError(response, http.StatusForbidden, "forbidden", "administrator role required")
			return
		}
		next.ServeHTTP(response, request)
	})
}

func WithUser(ctx context.Context, user User) context.Context {
	return context.WithValue(ctx, userContextKey{}, user)
}

func UserFromContext(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(userContextKey{}).(User)
	return user, ok
}

func (handler *Handler) login(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user, token, expiresAt, err := handler.service.Login(request.Context(), input.Email, input.Password)
	if errors.Is(err, ErrInvalidCredentials) {
		writeError(response, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
		return
	}
	if err != nil {
		writeError(response, http.StatusInternalServerError, "login_failed", "failed to create user session")
		return
	}
	http.SetCookie(response, sessionCookie(request, token, expiresAt))
	writeJSON(response, http.StatusOK, user)
}

func (handler *Handler) logout(response http.ResponseWriter, request *http.Request) {
	if cookie, err := request.Cookie(SessionCookieName); err == nil {
		if user, userErr := handler.service.UserForToken(request.Context(), cookie.Value); userErr == nil {
			handler.forgetUACTokens(user.ID)
		}
		_ = handler.service.Logout(request.Context(), cookie.Value)
	}
	http.SetCookie(response, sessionCookie(request, "", time.Unix(0, 0)))
	response.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) UACTokensForUser(userID string) (UACTokens, bool) {
	handler.tokenMu.RLock()
	defer handler.tokenMu.RUnlock()
	tokens, ok := handler.uacTokens[userID]
	return tokens, ok
}

func (handler *Handler) rememberUACTokens(userID string, identity SSOIdentity) {
	if userID == "" || identity.Provider != "uac" || identity.RequestToken == "" || identity.RefreshToken == "" {
		return
	}
	handler.tokenMu.Lock()
	defer handler.tokenMu.Unlock()
	handler.uacTokens[userID] = UACTokens{RequestToken: identity.RequestToken, RefreshToken: identity.RefreshToken}
}

func (handler *Handler) forgetUACTokens(userID string) {
	handler.tokenMu.Lock()
	defer handler.tokenMu.Unlock()
	delete(handler.uacTokens, userID)
}

func (handler *Handler) me(response http.ResponseWriter, request *http.Request) {
	user, _ := UserFromContext(request.Context())
	writeJSON(response, http.StatusOK, user)
}

func (handler *Handler) changePassword(response http.ResponseWriter, request *http.Request) {
	user, _ := UserFromContext(request.Context())
	var input struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", "invalid password change payload")
		return
	}
	if err := handler.service.ChangeAdminPassword(request.Context(), user.ID, input.CurrentPassword, input.NewPassword); errors.Is(err, ErrInvalidCredentials) {
		writeError(response, http.StatusUnauthorized, "invalid_current_password", "current password is incorrect")
		return
	} else if errors.Is(err, ErrPasswordPolicy) {
		writeError(response, http.StatusBadRequest, "invalid_new_password", "new password must contain 12 to 128 characters")
		return
	} else if err != nil {
		writeError(response, http.StatusInternalServerError, "password_change_failed", "failed to change password")
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) rotateAPIKey(response http.ResponseWriter, request *http.Request) {
	user, _ := UserFromContext(request.Context())
	key, err := handler.service.RotateAPIKey(request.Context(), user.ID)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "api_key_rotation_failed", "failed to generate API key")
		return
	}
	writeJSON(response, http.StatusCreated, map[string]string{"apiKey": key})
}

func (handler *Handler) getAPIKey(response http.ResponseWriter, request *http.Request) {
	user, _ := UserFromContext(request.Context())
	status, err := handler.service.UserAPIKeyStatus(request.Context(), user.ID)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "api_key_status_failed", "failed to load API key")
		return
	}
	writeJSON(response, http.StatusOK, status)
}

func (handler *Handler) listUserAPIKeys(response http.ResponseWriter, request *http.Request) {
	statuses, err := handler.service.ListUserAPIKeyStatuses(request.Context())
	if err != nil {
		writeError(response, http.StatusInternalServerError, "api_key_status_failed", "failed to load API key status")
		return
	}
	writeJSON(response, http.StatusOK, statuses)
}

func (handler *Handler) rotateUserAPIKey(response http.ResponseWriter, request *http.Request) {
	userID := request.PathValue("id")
	key := ""
	var err error
	if request.ContentLength != 0 {
		var identity APIKeyIdentity
		decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 16*1024))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&identity); err != nil {
			writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		identity.ID = userID
		userID, key, err = handler.service.RotateManagedAPIKey(request.Context(), identity)
	} else {
		key, err = handler.service.RotateAPIKey(request.Context(), userID)
	}
	if errors.Is(err, ErrInvalidIdentity) {
		writeError(response, http.StatusBadRequest, "invalid_identity", "valid user email and role required")
		return
	}
	if errors.Is(err, ErrUserNotFound) {
		writeError(response, http.StatusNotFound, "user_not_found", "active user not found")
		return
	}
	if err != nil {
		writeError(response, http.StatusInternalServerError, "api_key_rotation_failed", "failed to generate API key")
		return
	}
	writeJSON(response, http.StatusCreated, map[string]string{"userId": userID, "apiKey": key})
}

func sessionCookie(request *http.Request, value string, expiresAt time.Time) *http.Cookie {
	maxAge := int(time.Until(expiresAt).Seconds())
	if value == "" {
		maxAge = -1
	}
	return &http.Cookie{Name: SessionCookieName, Value: value, Path: "/", HttpOnly: true, Secure: !isLocalhost(request.Host), SameSite: http.SameSiteLaxMode, Expires: expiresAt, MaxAge: maxAge}
}

func isLocalhost(hostPort string) bool {
	host := hostPort
	if parsed, _, err := net.SplitHostPort(hostPort); err == nil {
		host = parsed
	}
	host = strings.Trim(host, "[]")
	return strings.EqualFold(host, "localhost") || net.ParseIP(host).IsLoopback()
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, map[string]string{"code": code, "message": message})
}
