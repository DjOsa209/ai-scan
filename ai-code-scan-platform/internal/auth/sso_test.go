package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestUACIdentityRetainsTokensForProductCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/uac-auth-service/v2/api/uac-auth/utoken/getUserInfo" {
			t.Fatalf("unexpected path %q", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "" || request.Header.Get("P-Auth") != "request-token" || request.Header.Get("P-Rtoken") != "user-token" || request.Header.Get("P-AppId") != "app-id" {
			t.Fatalf("unexpected UAC headers: %#v", request.Header)
		}
		var body map[string]string
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["rtoken"] != "request-token" || body["utoken"] != "user-token" || body["appId"] != "app-id" || len(body) != 3 {
			t.Fatalf("unexpected UAC body keys: %#v", body)
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"data": map[string]any{"userInfo": map[string]any{
			"userId": "uac-user", "email": "user@example.com", "userName": "Test User",
			"employeeNo": "10001", "departmentName": "Security Engineering",
		}}})
	}))
	defer server.Close()

	client := &ssoClient{
		configuration: SSOConfig{Provider: "uac", UACGateway: server.URL, UACAppID: "app-id"},
		httpClient:    &http.Client{Timeout: time.Second},
	}
	callback := httptest.NewRequest(http.MethodGet, "/callback?token=request-token&rtoken=user-token&employeeNo=10001", nil)
	identity, err := client.uacIdentity(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if identity.Subject != "uac-user" || identity.Name != "Test User" || identity.EmployeeNo != "10001" || identity.Department != "Security Engineering" || identity.RequestToken != "request-token" || identity.RefreshToken != "user-token" {
		t.Fatalf("unexpected identity: %#v", identity)
	}
}

func TestUACIdentityAcceptsBrowserCallbackAliases(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("P-Auth") != "request-token" || request.Header.Get("P-Rtoken") != "user-token" {
			t.Fatalf("unexpected UAC headers")
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"data": map[string]any{
			"uid": "uac-user", "email": "user@example.com", "employeeNo": "10001",
		}})
	}))
	defer server.Close()

	client := &ssoClient{
		configuration: SSOConfig{Provider: "uac", UACGateway: server.URL, UACAppID: "app-id"},
		httpClient:    &http.Client{Timeout: time.Second},
	}
	identity, err := client.uacIdentityFromInput(context.Background(), UACCallbackInput{Params: map[string]string{
		"token=request-token&rtoken=user-token&employeeNo=10001&lang=zh": "",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if identity.Subject != "uac-user" || identity.EmployeeNo != "10001" || identity.RequestToken != "request-token" || identity.RefreshToken != "user-token" {
		t.Fatalf("unexpected identity: %#v", identity)
	}
}

func TestUACIdentityIncludesSanitizedUpstreamError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(response).Encode(map[string]string{
			"code":    "TOKEN_INVALID",
			"message": "expired token user-token",
		})
	}))
	defer server.Close()

	client := &ssoClient{
		configuration: SSOConfig{Provider: "uac", UACGateway: server.URL, UACAppID: "app-id"},
		httpClient:    &http.Client{Timeout: time.Second},
	}
	_, err := client.uacIdentityFromInput(context.Background(), UACCallbackInput{Token: "request-token", RToken: "user-token"})
	if err == nil || !strings.Contains(err.Error(), "TOKEN_INVALID: expired token [REDACTED]") {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(err.Error(), "user-token") || strings.Contains(err.Error(), "request-token") {
		t.Fatalf("UAC error leaked callback tokens: %v", err)
	}
}
