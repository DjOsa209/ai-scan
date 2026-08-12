package review

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"ai-code-scan-platform/internal/skill"
)

type stubSkills struct{}

type stubDecrypter struct{}

func (stubDecrypter) Decrypt(value string) (string, error) { return "decrypted-" + value, nil }

func (stubSkills) Resolve(context.Context) (skill.ResolvedSkill, error) {
	return skill.ResolvedSkill{Version: "skill-v1", Content: "security instructions", ExpiresAt: time.Now()}, nil
}

type recordingModelClient struct {
	model   ModelConfig
	skill   string
	context string
	report  string
}

const validStructuredReport = `{
	"schemaVersion":"2.0","metadata":{"baseline":"sec-baseline.md","scope":"changed files","generatedAt":"unavailable"},"result":"pass",
	"summary":{"critical":0,"high":0,"medium":0,"low":0,"manualReview":0},
	"findings":[],"manualReview":[],
	"coverage":{"checked":["authentication"],"notChecked":[],"tools":["workspace search"]}
}`

func (client *recordingModelClient) Complete(_ context.Context, model ModelConfig, skillContent, reviewContext string) (string, error) {
	client.model = model
	client.skill = skillContent
	client.context = reviewContext
	if client.report != "" {
		return client.report, nil
	}
	return validStructuredReport, nil
}

func TestRunRejectsNonJSONReport(t *testing.T) {
	state := json.RawMessage(`{"aiModels":[{"id":"external","enabled":true,"endpoint":"https://models.example.com/v1","modelId":"secure-model","apiKeyEncrypted":"ciphertext"}]}`)
	client := &recordingModelClient{report: "## Review findings\n\n- **Critical — Secrets exposed:** credentials were committed."}
	service := NewService(func(context.Context) (json.RawMessage, error) { return state, nil }, stubSkills{}, client, stubDecrypter{}, 1)

	if _, err := service.Run(context.Background(), Input{Context: ContextBundle{Diff: "diff"}}); err == nil {
		t.Fatal("expected a non-JSON report to be rejected")
	}
}

func TestRunSelectsConfiguredModelAndInjectsContext(t *testing.T) {
	state := json.RawMessage(`{"aiModels":[
		{"id":"builtin","name":"Built in","enabled":true,"modelId":"internal"},
		{"id":"external","name":"Custom","enabled":true,"endpoint":"https://models.example.com/v1","modelId":"secure-model","apiKeyEncrypted":"ciphertext"}
	]}`)
	client := &recordingModelClient{}
	service := NewService(func(context.Context) (json.RawMessage, error) { return state, nil }, stubSkills{}, client, stubDecrypter{}, 2)

	result, err := service.Run(context.Background(), Input{WorkspaceLabel: "payments", Context: ContextBundle{Diff: "diff and related files"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.ModelID != "secure-model" || client.model.ID != "external" {
		t.Fatalf("unexpected model selection: %#v", client.model)
	}
	if client.model.APIKey != "decrypted-ciphertext" {
		t.Fatalf("API key was not decrypted: %#v", client.model)
	}
	if client.skill != "security instructions" || client.context != `{"gitStatus":"","diff":"diff and related files","files":null}` {
		t.Fatalf("review context was not forwarded: %#v", client)
	}
}

func TestRunRejectsMissingExternalModel(t *testing.T) {
	state := json.RawMessage(`{"aiModels":[{"id":"builtin","enabled":true,"modelId":"internal"}]}`)
	service := NewService(func(context.Context) (json.RawMessage, error) { return state, nil }, stubSkills{}, &recordingModelClient{}, stubDecrypter{}, 1)
	if _, err := service.Run(context.Background(), Input{Context: ContextBundle{Diff: "diff"}}); err != ErrModelNotConfigured {
		t.Fatalf("expected ErrModelNotConfigured, got %v", err)
	}
}

func TestConnectionUsesProvidedAPIKey(t *testing.T) {
	client := &recordingModelClient{}
	service := NewService(func(context.Context) (json.RawMessage, error) {
		t.Fatal("state should not be loaded when an API key is provided")
		return nil, nil
	}, stubSkills{}, client, stubDecrypter{}, 1)

	result, err := service.TestConnection(context.Background(), ConnectionInput{
		ID: "new-model", Endpoint: "https://models.example.com/v1", ModelID: "secure-model", APIKey: "temporary-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK || client.model.APIKey != "temporary-secret" || client.model.MaxTokens != 8 {
		t.Fatalf("unexpected connection test: result=%#v model=%#v", result, client.model)
	}
}

func TestConnectionReusesSavedAPIKey(t *testing.T) {
	state := json.RawMessage(`{"aiModels":[{"id":"saved-model","apiKeyEncrypted":"ciphertext"}]}`)
	client := &recordingModelClient{}
	service := NewService(func(context.Context) (json.RawMessage, error) { return state, nil }, stubSkills{}, client, stubDecrypter{}, 1)

	_, err := service.TestConnection(context.Background(), ConnectionInput{
		ID: "saved-model", Endpoint: "https://models.example.com/v1", ModelID: "secure-model",
	})
	if err != nil {
		t.Fatal(err)
	}
	if client.model.APIKey != "decrypted-ciphertext" {
		t.Fatalf("saved API key was not reused: %#v", client.model)
	}
}
