package platformclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ai-scan-engine/internal/message"
	"ai-scan-engine/internal/report"
)

func TestClientSendsAuthenticatedCallbacks(t *testing.T) {
	t.Helper()
	requests := make(chan *http.Request, 2)
	bodies := make(chan map[string]any, 2)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		requests <- request.Clone(request.Context())
		bodies <- body
		response.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client := New("test-token", server.URL, time.Second, time.Second)
	callbacks := message.Callbacks{StatusURL: "/status", ReportURL: "/report"}
	if err := client.Update(context.Background(), callbacks, StatusUpdate{Status: "analyzing", Progress: 70}); err != nil {
		t.Fatal(err)
	}
	task := message.Task{ID: "task-1", ProjectName: "example", GitRef: "main", Callbacks: callbacks}
	value := report.New("example@main", nil, []string{"main.go"}, nil)
	value.EvidenceFiles = []report.EvidenceFile{{Path: "main.go", Content: "package main\n"}}
	value.AITokenUsage = report.TokenUsage{InputTokens: 120, OutputTokens: 30, TotalTokens: 150, Estimated: true}
	if err := client.Upload(context.Background(), task, value); err != nil {
		t.Fatal(err)
	}

	statusRequest, statusBody := <-requests, <-bodies
	if statusRequest.Method != http.MethodPatch || statusRequest.URL.Path != "/status" {
		t.Fatalf("unexpected status request: %s %s", statusRequest.Method, statusRequest.URL.Path)
	}
	if statusRequest.Header.Get("Authorization") != "Bearer test-token" || statusBody["status"] != "analyzing" {
		t.Fatalf("unexpected status callback: headers=%v body=%v", statusRequest.Header, statusBody)
	}

	reportRequest, reportBody := <-requests, <-bodies
	if reportRequest.Method != http.MethodPut || reportRequest.URL.Path != "/report" {
		t.Fatalf("unexpected report request: %s %s", reportRequest.Method, reportRequest.URL.Path)
	}
	if reportRequest.Header.Get("Authorization") != "Bearer test-token" || reportBody["schemaVersion"] != "2.0" {
		t.Fatalf("unexpected report callback: headers=%v body=%v", reportRequest.Header, reportBody)
	}
	tokenUsage := reportBody["aiTokenUsage"].(map[string]any)
	if tokenUsage["inputTokens"] != float64(120) || tokenUsage["outputTokens"] != float64(30) || tokenUsage["totalTokens"] != float64(150) || tokenUsage["estimated"] != true {
		t.Fatalf("report did not include token usage: %v", tokenUsage)
	}
	var embedded map[string]any
	if err := json.Unmarshal([]byte(reportBody["reportJson"].(string)), &embedded); err != nil {
		t.Fatalf("decode embedded report: %v", err)
	}
	if embedded["schemaVersion"] != "2.0" || embedded["result"] != "pass" {
		t.Fatalf("unexpected embedded report: %v", embedded)
	}
	snapshot := reportBody["sourceSnapshot"].(map[string]any)
	files := snapshot["files"].([]any)
	if snapshot["gitStatus"] != "?? main.go" || len(files) != 1 || files[0].(map[string]any)["path"] != "main.go" || files[0].(map[string]any)["kind"] != "evidence" || files[0].(map[string]any)["content"] != "package main\n" {
		t.Fatalf("report did not include the scanned file manifest: %v", snapshot)
	}
}

func TestUploadRedactsSensitiveReportAndSnapshotContent(t *testing.T) {
	var body ReportUpload
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		response.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client := New("test-token", server.URL, time.Second, time.Second)
	task := message.Task{ID: "task-1", ProjectName: "example", GitRef: "main", Callbacks: message.Callbacks{ReportURL: "/report"}}
	value := report.New("example@main", []report.Finding{{
		ID: "SEC-SECRET-001", Title: "secret", Severity: "high", Rule: "7.2",
		Locations: []report.Location{{Path: "config.yaml", Line: 1}}, Confidence: "high",
		Evidence: `password: "production-password"`, Impact: "impact", Remediation: "remediation", Verification: "verification",
	}}, []string{"config.yaml"}, nil)
	value.EvidenceFiles = []report.EvidenceFile{{Path: "config.yaml", Content: "password: production-password\nauthorization: Bearer live-access-token\n"}}

	if err := client.Upload(context.Background(), task, value); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	requestBody := string(encoded)
	for _, secret := range []string{"production-password", "live-access-token"} {
		if strings.Contains(requestBody, secret) {
			t.Fatalf("upload contains unredacted secret %q: %s", secret, requestBody)
		}
	}
	if strings.Count(requestBody, "[REDACTED]") < 3 {
		t.Fatalf("expected report and snapshot values to be redacted: %s", requestBody)
	}
	if value.Findings[0].Evidence != `password: "production-password"` || value.EvidenceFiles[0].Content != "password: production-password\nauthorization: Bearer live-access-token\n" {
		t.Fatal("upload redaction mutated the original report")
	}
}

func TestCompletePromptUsesModelTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/model-proxy/completions" {
			t.Fatalf("unexpected request path: %s", request.URL.Path)
		}
		<-time.After(40 * time.Millisecond)
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"output":"analysis complete","inputTokens":120,"outputTokens":30,"totalTokens":150,"estimated":true}`))
	}))
	defer server.Close()

	client := New("admin-token", server.URL, 10*time.Millisecond, 200*time.Millisecond)
	output, usage, err := client.CompletePrompt(context.Background(), "session-token", "system", "user")
	if err != nil {
		t.Fatal(err)
	}
	if output != "analysis complete" {
		t.Fatalf("unexpected model output: %q", output)
	}
	if usage.InputTokens != 120 || usage.OutputTokens != 30 || usage.TotalTokens != 150 || !usage.Estimated {
		t.Fatalf("unexpected token usage: %#v", usage)
	}
}

func TestCompletePromptRetriesTransientFailure(t *testing.T) {
	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if requestCount.Add(1) == 1 {
			<-time.After(40 * time.Millisecond)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"output":"analysis complete","inputTokens":120,"outputTokens":30,"totalTokens":150,"estimated":true}`))
	}))
	defer server.Close()

	client := New("admin-token", server.URL, time.Second, 20*time.Millisecond)
	client.modelRetryWait = func(int) time.Duration { return 0 }
	output, _, err := client.CompletePrompt(context.Background(), "session-token", "system", "user")
	if err != nil {
		t.Fatal(err)
	}
	if requestCount.Load() != 2 || output != "analysis complete" {
		t.Fatalf("expected one retry followed by success, requests=%d output=%q", requestCount.Load(), output)
	}
}

func TestCompletePromptDoesNotRetryPermanentFailure(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestCount++
		http.Error(response, "invalid request", http.StatusBadRequest)
	}))
	defer server.Close()

	client := New("admin-token", server.URL, time.Second, time.Second)
	client.modelRetryWait = func(int) time.Duration { return 0 }
	if _, _, err := client.CompletePrompt(context.Background(), "session-token", "system", "user"); err == nil {
		t.Fatal("expected permanent model failure")
	}
	if requestCount != 1 {
		t.Fatalf("permanent failure must not be retried, requests=%d", requestCount)
	}
}

func TestCompletePromptStopsAfterMaximumAttempts(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestCount++
		http.Error(response, "temporarily unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	client := New("admin-token", server.URL, time.Second, time.Second)
	client.modelRetryWait = func(int) time.Duration { return 0 }
	if _, _, err := client.CompletePrompt(context.Background(), "session-token", "system", "user"); err == nil {
		t.Fatal("expected transient model failure after retries")
	}
	if requestCount != modelRequestAttempts {
		t.Fatalf("expected %d attempts, requests=%d", modelRequestAttempts, requestCount)
	}
}
