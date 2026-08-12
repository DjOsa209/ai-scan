package modelproxy

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"ai-code-scan-platform/internal/review"
	"ai-code-scan-platform/internal/scan"
)

type testTaskReader struct {
	task scan.Task
}

func (reader testTaskReader) Get(_ context.Context, id string) (scan.Task, error) {
	if id != reader.task.ID {
		return scan.Task{}, errors.New("task not found")
	}
	return reader.task, nil
}

type testModelGateway struct {
	resolvedID string
	modelID    string
	system     string
	user       string
}

func (gateway *testModelGateway) ResolveModelID(_ context.Context, requestedID string) (string, error) {
	if requestedID != "configured-model" {
		return "", errors.New("unexpected requested model")
	}
	return gateway.resolvedID, nil
}

func (gateway *testModelGateway) CompletePrompt(_ context.Context, modelID, system, user string) (review.PromptResult, error) {
	gateway.modelID = modelID
	gateway.system = system
	gateway.user = user
	return review.PromptResult{Output: `{"findings":[]}`, InputTokens: 1200, OutputTokens: 300, TotalTokens: 1500}, nil
}

type testCipher struct{}

func (testCipher) Encrypt(value string) (string, error) {
	return "sealed." + base64.RawURLEncoding.EncodeToString([]byte(value)), nil
}

func (testCipher) Decrypt(value string) (string, error) {
	encoded, ok := strings.CutPrefix(value, "sealed.")
	if !ok {
		return "", errors.New("invalid ciphertext")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	return string(decoded), err
}

func TestSessionBindsTaskAndResolvedModel(t *testing.T) {
	now := time.Date(2026, 8, 10, 9, 0, 0, 0, time.UTC)
	gateway := &testModelGateway{resolvedID: "resolved-model"}
	service := NewService(testTaskReader{task: scan.Task{
		ID:                "task-1",
		ScanConfiguration: scan.ScanConfiguration{AIModelID: "configured-model"},
	}}, gateway, testCipher{}, 10*time.Minute)
	service.now = func() time.Time { return now }

	session, err := service.Issue(context.Background(), "task-1")
	if err != nil {
		t.Fatal(err)
	}
	if session.Token == "" || session.ExpiresAt != now.Add(10*time.Minute) {
		t.Fatalf("unexpected session: %#v", session)
	}
	if strings.Contains(session.Token, "resolved-model") {
		t.Fatal("session token exposes model configuration ID")
	}

	result, err := service.Complete(context.Background(), session.Token, PromptInput{System: "policy", User: "source"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Output != `{"findings":[]}` || result.InputTokens != 1200 || result.OutputTokens != 300 || result.TotalTokens != 1500 || gateway.modelID != "resolved-model" || gateway.system != "policy" || gateway.user != "source" {
		t.Fatalf("unexpected proxy result or gateway call: %#v %#v", result, gateway)
	}
}

func TestExpiredSessionIsRejectedBeforeModelCall(t *testing.T) {
	now := time.Date(2026, 8, 10, 9, 0, 0, 0, time.UTC)
	gateway := &testModelGateway{resolvedID: "resolved-model"}
	service := NewService(testTaskReader{task: scan.Task{
		ID:                "task-1",
		ScanConfiguration: scan.ScanConfiguration{AIModelID: "configured-model"},
	}}, gateway, testCipher{}, time.Minute)
	service.now = func() time.Time { return now }
	session, err := service.Issue(context.Background(), "task-1")
	if err != nil {
		t.Fatal(err)
	}

	service.now = func() time.Time { return now.Add(2 * time.Minute) }
	_, err = service.Complete(context.Background(), session.Token, PromptInput{System: "policy", User: "source"})
	if !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("expected invalid session, got %v", err)
	}
	if gateway.modelID != "" {
		t.Fatal("expired session reached model gateway")
	}
}
