package platformclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"ai-scan-engine/internal/message"
	"ai-scan-engine/internal/report"
)

type Client struct {
	token, baseURL string
	callbackHTTP   *http.Client
	modelHTTP      *http.Client
	modelRetryWait func(int) time.Duration
}

const modelRequestAttempts = 3

type responseError struct {
	statusCode int
	body       string
}

func (err *responseError) Error() string {
	return fmt.Sprintf("platform request returned %d: %s", err.statusCode, err.body)
}

type StatusUpdate struct {
	Status        string `json:"status"`
	Stage         string `json:"stage"`
	Progress      int    `json:"progress"`
	StatusMessage string `json:"statusMessage"`
}
type ReportUpload struct {
	SchemaVersion  string         `json:"schemaVersion"`
	ReportID       string         `json:"reportId"`
	GeneratedAt    string         `json:"generatedAt"`
	WorkspaceLabel string         `json:"workspaceLabel"`
	ReportJSON     string         `json:"reportJson"`
	SourceSnapshot SourceSnapshot `json:"sourceSnapshot"`
	AITokenUsage   TokenUsage     `json:"aiTokenUsage"`
}
type SourceSnapshot struct {
	GitStatus string               `json:"gitStatus"`
	Diff      string               `json:"diff"`
	Files     []SourceSnapshotFile `json:"files"`
}
type SourceSnapshotFile struct {
	Path    string `json:"path"`
	Kind    string `json:"kind"`
	Content string `json:"content"`
}
type TokenUsage struct {
	InputTokens  uint64 `json:"inputTokens"`
	OutputTokens uint64 `json:"outputTokens"`
	TotalTokens  uint64 `json:"totalTokens"`
	Estimated    bool   `json:"estimated"`
}

type ModelSession struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type RepositoryCredential struct {
	AuthorizationHeader string `json:"authorizationHeader"`
}

type promptInput struct {
	System string `json:"system"`
	User   string `json:"user"`
}

type promptOutput struct {
	Output       string `json:"output"`
	InputTokens  uint64 `json:"inputTokens"`
	OutputTokens uint64 `json:"outputTokens"`
	TotalTokens  uint64 `json:"totalTokens"`
	Estimated    bool   `json:"estimated"`
}

var sensitiveTextPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|passwd|pwd|token|secret)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]\r\n]+)`),
	regexp.MustCompile(`(?i)(\b(?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)?\s*)[^\s"',;}\]]+`),
	regexp.MustCompile(`(?i)(https?://[^\s:/@]+:)[^\s@/]+@`),
	regexp.MustCompile(`(?i)\b(?:AKIA[0-9A-Z]{16}|(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,})\b`),
	regexp.MustCompile(`(?s)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----`),
}

func New(token, baseURL string, callbackTimeout, modelTimeout time.Duration) *Client {
	return &Client{
		token: token, baseURL: strings.TrimRight(baseURL, "/"),
		callbackHTTP: &http.Client{Timeout: callbackTimeout},
		modelHTTP:    &http.Client{Timeout: modelTimeout},
		modelRetryWait: func(attempt int) time.Duration {
			return time.Duration(1<<(attempt-1)) * time.Second
		},
	}
}

func (client *Client) Update(ctx context.Context, callbacks message.Callbacks, update StatusUpdate) error {
	return client.send(ctx, http.MethodPatch, client.resolve(callbacks.StatusURL), update)
}

func (client *Client) Upload(ctx context.Context, task message.Task, value report.Report) error {
	sanitized := value
	sanitized.Findings = append([]report.Finding(nil), value.Findings...)
	for index := range sanitized.Findings {
		sanitized.Findings[index].Evidence = redactSensitiveText(sanitized.Findings[index].Evidence)
	}
	reportJSON, err := json.Marshal(sanitized)
	if err != nil {
		return err
	}
	evidenceContent := make(map[string]string, len(value.EvidenceFiles))
	for _, file := range value.EvidenceFiles {
		evidenceContent[file.Path] = redactSensitiveText(file.Content)
	}
	snapshot := SourceSnapshot{Files: make([]SourceSnapshotFile, 0, len(value.Coverage.Checked))}
	statusLines := make([]string, 0, len(value.Coverage.Checked))
	for _, filePath := range value.Coverage.Checked {
		snapshot.Files = append(snapshot.Files, SourceSnapshotFile{Path: filePath, Kind: "evidence", Content: evidenceContent[filePath]})
		statusLines = append(statusLines, "?? "+filePath)
	}
	snapshot.GitStatus = strings.Join(statusLines, "\n")
	upload := ReportUpload{SchemaVersion: "2.0", ReportID: "engine-" + task.ID, GeneratedAt: value.Metadata.GeneratedAt, WorkspaceLabel: task.ProjectName + "@" + task.GitRef, ReportJSON: string(reportJSON), SourceSnapshot: snapshot, AITokenUsage: TokenUsage{InputTokens: value.AITokenUsage.InputTokens, OutputTokens: value.AITokenUsage.OutputTokens, TotalTokens: value.AITokenUsage.TotalTokens, Estimated: true}}
	return client.send(ctx, http.MethodPut, client.resolve(task.Callbacks.ReportURL), upload)
}

func redactSensitiveText(value string) string {
	for _, pattern := range sensitiveTextPatterns {
		value = pattern.ReplaceAllString(value, `${1}[REDACTED]`)
	}
	return value
}

func (client *Client) IssueModelSession(ctx context.Context, taskID string) (string, time.Time, error) {
	var session ModelSession
	if err := client.sendAndDecode(ctx, http.MethodPost, client.baseURL+"/api/v1/admin/scans/"+url.PathEscape(taskID)+"/model-session", client.token, struct{}{}, &session); err != nil {
		return "", time.Time{}, err
	}
	if strings.TrimSpace(session.Token) == "" {
		return "", time.Time{}, fmt.Errorf("platform returned an empty model session")
	}
	return session.Token, session.ExpiresAt, nil
}

func (client *Client) GetRepositoryCredential(ctx context.Context, endpoint string) (string, error) {
	if strings.TrimSpace(endpoint) == "" {
		return "", nil
	}
	var credential RepositoryCredential
	if err := client.sendAndDecode(ctx, http.MethodGet, client.resolve(endpoint), client.token, nil, &credential); err != nil {
		return "", err
	}
	if strings.TrimSpace(credential.AuthorizationHeader) == "" {
		return "", fmt.Errorf("platform returned an empty repository credential")
	}
	return credential.AuthorizationHeader, nil
}

func (client *Client) GetArchive(ctx context.Context, endpoint string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.resolve(endpoint), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+client.token)
	response, err := client.callbackHTTP.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("platform archive download returned HTTP %d", response.StatusCode)
	}
	const maxArchiveBytes = 64 * 1024 * 1024
	content, err := io.ReadAll(io.LimitReader(response.Body, maxArchiveBytes+1))
	if err != nil {
		return nil, err
	}
	if len(content) > maxArchiveBytes {
		return nil, fmt.Errorf("source archive exceeds 64 MiB")
	}
	return content, nil
}

func (client *Client) CompletePrompt(ctx context.Context, sessionToken, systemPrompt, userPrompt string) (string, report.TokenUsage, error) {
	for attempt := 1; attempt <= modelRequestAttempts; attempt++ {
		var output promptOutput
		err := client.sendAndDecodeWith(client.modelHTTP, ctx, http.MethodPost, client.baseURL+"/api/v1/model-proxy/completions", sessionToken, promptInput{System: systemPrompt, User: userPrompt}, &output)
		if err == nil {
			return output.Output, report.TokenUsage{InputTokens: output.InputTokens, OutputTokens: output.OutputTokens, TotalTokens: output.TotalTokens, Estimated: output.Estimated}, nil
		}
		if attempt == modelRequestAttempts || !retryableModelError(ctx, err) {
			return "", report.TokenUsage{}, err
		}
		timer := time.NewTimer(client.modelRetryWait(attempt))
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", report.TokenUsage{}, ctx.Err()
		case <-timer.C:
		}
	}
	return "", report.TokenUsage{}, errors.New("model request attempts exhausted")
}

func retryableModelError(ctx context.Context, err error) bool {
	if ctx.Err() != nil {
		return false
	}
	var responseErr *responseError
	if errors.As(err, &responseErr) {
		return responseErr.statusCode == http.StatusTooManyRequests || responseErr.statusCode >= http.StatusInternalServerError
	}
	var networkErr net.Error
	return errors.As(err, &networkErr) && (networkErr.Timeout() || networkErr.Temporary())
}

func (client *Client) resolve(value string) string {
	parsed, err := url.Parse(value)
	if err == nil && parsed.IsAbs() {
		return value
	}
	return client.baseURL + "/" + strings.TrimLeft(value, "/")
}

func (client *Client) send(ctx context.Context, method, endpoint string, input any) error {
	return client.sendAndDecode(ctx, method, endpoint, client.token, input, nil)
}

func (client *Client) sendAndDecode(ctx context.Context, method, endpoint, token string, input, output any) error {
	return client.sendAndDecodeWith(client.callbackHTTP, ctx, method, endpoint, token, input, output)
}

func (client *Client) sendAndDecodeWith(httpClient *http.Client, ctx context.Context, method, endpoint, token string, input, output any) error {
	payload, err := json.Marshal(input)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("platform callback: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return &responseError{statusCode: response.StatusCode, body: strings.TrimSpace(string(body))}
	}
	if output != nil {
		if err := json.NewDecoder(io.LimitReader(response.Body, 4*1024*1024)).Decode(output); err != nil {
			return fmt.Errorf("decode platform response: %w", err)
		}
	}
	return nil
}
