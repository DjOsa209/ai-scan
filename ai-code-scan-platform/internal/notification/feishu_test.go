package notification

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSendToEmailUsesApplicationBotEmailRecipient(t *testing.T) {
	var messageRequest map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/open-apis/auth/v3/tenant_access_token/internal":
			_, _ = response.Write([]byte(`{"code":0,"tenant_access_token":"tenant-token","expire":7200}`))
		case "/open-apis/im/v1/messages":
			if request.URL.Query().Get("receive_id_type") != "email" || request.Header.Get("Authorization") != "Bearer tenant-token" {
				t.Fatalf("unexpected application message request: %s %#v", request.URL.String(), request.Header)
			}
			if err := json.NewDecoder(request.Body).Decode(&messageRequest); err != nil {
				t.Fatal(err)
			}
			_, _ = response.Write([]byte(`{"code":0}`))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := NewFeishuClient("app-id", "app-secret", server.URL, server.Client())
	if err := client.SendToEmail(context.Background(), "user@example.com", "扫描完成"); err != nil {
		t.Fatal(err)
	}
	if messageRequest["receive_id"] != "user@example.com" || !strings.Contains(messageRequest["content"], "扫描完成") {
		t.Fatalf("unexpected message payload: %#v", messageRequest)
	}
}

func TestValidateWebhookURLRejectsNonFeishuHosts(t *testing.T) {
	if err := validateWebhookURL("https://example.com/open-apis/bot/v2/hook/token"); err == nil {
		t.Fatal("expected non-Feishu webhook host to be rejected")
	}
	if err := validateWebhookURL("https://open.feishu.cn/open-apis/bot/v2/hook/token"); err != nil {
		t.Fatalf("expected Feishu webhook URL to be accepted: %v", err)
	}
}
