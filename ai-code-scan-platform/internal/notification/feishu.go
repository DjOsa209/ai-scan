package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type FeishuClient struct {
	appID        string
	appSecret    string
	baseURL      string
	httpClient   *http.Client
	tokenMu      sync.Mutex
	tenantToken  string
	tokenExpires time.Time
}

func NewFeishuClient(appID, appSecret, baseURL string, client *http.Client) *FeishuClient {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &FeishuClient{
		appID: strings.TrimSpace(appID), appSecret: strings.TrimSpace(appSecret),
		baseURL: strings.TrimRight(baseURL, "/"), httpClient: client,
	}
}

func (client *FeishuClient) ApplicationConfigured() bool {
	return client.appID != "" && client.appSecret != "" && client.baseURL != ""
}

func (client *FeishuClient) SendToEmail(ctx context.Context, email, text string) error {
	if !client.ApplicationConfigured() {
		return fmt.Errorf("Feishu application bot is not configured")
	}
	token, err := client.tenantAccessToken(ctx)
	if err != nil {
		return err
	}
	content, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return err
	}
	payload := map[string]string{"receive_id": strings.TrimSpace(email), "msg_type": "text", "content": string(content)}
	endpoint := client.baseURL + "/open-apis/im/v1/messages?receive_id_type=email"
	return client.postJSON(ctx, endpoint, payload, token)
}

func (client *FeishuClient) SendWebhook(ctx context.Context, webhookURL, text string) error {
	if err := validateWebhookURL(webhookURL); err != nil {
		return err
	}
	payload := map[string]any{"msg_type": "text", "content": map[string]string{"text": text}}
	return client.postJSON(ctx, webhookURL, payload, "")
}

func (client *FeishuClient) tenantAccessToken(ctx context.Context) (string, error) {
	client.tokenMu.Lock()
	defer client.tokenMu.Unlock()
	if client.tenantToken != "" && time.Now().Before(client.tokenExpires) {
		return client.tenantToken, nil
	}
	payload := map[string]string{"app_id": client.appID, "app_secret": client.appSecret}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+"/open-apis/auth/v3/tenant_access_token/internal", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.httpClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("request Feishu tenant access token: %w", err)
	}
	defer response.Body.Close()
	var result struct {
		Code              int    `json:"code"`
		Message           string `json:"msg"`
		TenantAccessToken string `json:"tenant_access_token"`
		Expire            int    `json:"expire"`
	}
	if err := decodeFeishuResponse(response, &result); err != nil {
		return "", fmt.Errorf("request Feishu tenant access token: %w", err)
	}
	if result.Code != 0 || result.TenantAccessToken == "" {
		return "", fmt.Errorf("request Feishu tenant access token: code %d: %s", result.Code, result.Message)
	}
	client.tenantToken = result.TenantAccessToken
	expiresIn := time.Duration(result.Expire) * time.Second
	if expiresIn <= time.Minute {
		expiresIn = 2 * time.Hour
	}
	client.tokenExpires = time.Now().Add(expiresIn - time.Minute)
	return client.tenantToken, nil
}

func (client *FeishuClient) postJSON(ctx context.Context, endpoint string, payload any, token string) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("send Feishu message: %w", err)
	}
	defer response.Body.Close()
	var result struct {
		Code    int    `json:"code"`
		Message string `json:"msg"`
	}
	if err := decodeFeishuResponse(response, &result); err != nil {
		return fmt.Errorf("send Feishu message: %w", err)
	}
	if result.Code != 0 {
		return fmt.Errorf("send Feishu message: code %d: %s", result.Code, result.Message)
	}
	return nil
}

func decodeFeishuResponse(response *http.Response, target any) error {
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4*1024))
		return fmt.Errorf("HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(target); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

func validateWebhookURL(value string) error {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "open.feishu.cn" || !strings.HasPrefix(parsed.Path, "/open-apis/bot/v2/hook/") {
		return fmt.Errorf("invalid Feishu webhook URL")
	}
	return nil
}
