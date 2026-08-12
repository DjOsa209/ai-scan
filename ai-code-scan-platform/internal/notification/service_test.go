package notification

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"ai-code-scan-platform/internal/scan"

	"github.com/DATA-DOG/go-sqlmock"
)

type staticCipher struct{}

func (staticCipher) Encrypt(value string) (string, error) { return "encrypted:" + value, nil }
func (staticCipher) Decrypt(value string) (string, error) {
	return strings.TrimPrefix(value, "encrypted:"), nil
}

type recordingTransport struct {
	applicationMessages int
	webhookMessages     int
}

func (transport *recordingTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	body := `{"code":0}`
	switch request.URL.Path {
	case "/open-apis/auth/v3/tenant_access_token/internal":
		body = `{"code":0,"tenant_access_token":"token","expire":7200}`
	case "/open-apis/im/v1/messages":
		transport.applicationMessages++
	case "/open-apis/bot/v2/hook/user-hook":
		transport.webhookMessages++
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    request,
	}, nil
}

func TestNotifyCompletionUsesConfiguredChannels(t *testing.T) {
	for _, test := range []struct {
		name               string
		applicationEnabled bool
		webhookEnabled     bool
		webhookCiphertext  any
		wantApplications   int
		wantWebhooks       int
	}{
		{name: "application bot only", applicationEnabled: true, wantApplications: 1},
		{name: "application bot and webhook", applicationEnabled: true, webhookEnabled: true, webhookCiphertext: "encrypted:https://open.feishu.cn/open-apis/bot/v2/hook/user-hook", wantApplications: 1, wantWebhooks: 1},
		{name: "webhook only", webhookEnabled: true, webhookCiphertext: "encrypted:https://open.feishu.cn/open-apis/bot/v2/hook/user-hook", wantWebhooks: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			database, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			mock.ExpectQuery("SELECT users.email").WithArgs("user-1").WillReturnRows(
				sqlmock.NewRows([]string{"email", "application_enabled", "webhook_enabled", "webhook_url_ciphertext"}).
					AddRow("user@example.com", test.applicationEnabled, test.webhookEnabled, test.webhookCiphertext),
			)

			transport := &recordingTransport{}
			client := NewFeishuClient("app-id", "app-secret", "https://open.feishu.cn", &http.Client{Transport: transport})
			service := NewService(NewRepository(database), staticCipher{}, client, "https://scan.example.com")
			actorID := "user-1"
			task := scan.Task{
				ID: "scan-1", ProjectName: "payments", ActorType: scan.ActorUser, ActorID: &actorID,
				Status: scan.StatusCompleted, FindingCount: 3, ChargedCredits: 12,
			}

			if err := service.NotifyCompletion(context.Background(), task); err != nil {
				t.Fatal(err)
			}
			if transport.applicationMessages != test.wantApplications || transport.webhookMessages != test.wantWebhooks {
				t.Fatalf("got %d application messages and %d webhooks", transport.applicationMessages, transport.webhookMessages)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestUpdatePreferenceEncryptsWebhookWithoutReturningIt(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	mock.ExpectQuery("SELECT users.email").WithArgs("user-1").WillReturnRows(
		sqlmock.NewRows([]string{"email", "application_enabled", "webhook_enabled", "webhook_url_ciphertext"}).
			AddRow("user@example.com", true, false, nil),
	)
	webhookURL := "https://open.feishu.cn/open-apis/bot/v2/hook/user-hook"
	mock.ExpectExec("INSERT INTO user_notification_preferences").
		WithArgs("user-1", false, true, "encrypted:"+webhookURL).
		WillReturnResult(sqlmock.NewResult(1, 1))
	service := NewService(NewRepository(database), staticCipher{}, NewFeishuClient("", "", "", nil), "")

	preference, err := service.UpdatePreference(context.Background(), "user-1", false, true, webhookURL)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(preference)
	if err != nil {
		t.Fatal(err)
	}
	if preference.ApplicationEnabled || !preference.WebhookEnabled || !preference.WebhookConfigured || strings.Contains(string(payload), webhookURL) {
		t.Fatalf("unexpected preference response: %s", payload)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
