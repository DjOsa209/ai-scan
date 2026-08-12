package review

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAIClientCallsChatCompletions(t *testing.T) {
	var requestPath string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestPath = request.URL.Path
		if request.Header.Get("Authorization") != "Bearer test-secret" {
			t.Errorf("authorization header was not forwarded")
		}
		if request.Header.Get("x-user-no") != "18600000000" || request.Header.Get("x-user-name") != "%E9%99%88%20xx" || request.Header.Get("x-user-dept-name") != "AI%E5%88%9B%E6%96%B0%E9%83%A8" {
			t.Errorf("proxy identity headers were not forwarded: %#v", request.Header)
		}
		var payload struct {
			Model    string    `json:"model"`
			Messages []message `json:"messages"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Model != "secure-model" || len(payload.Messages) != 2 || payload.Messages[0].Content != "skill" {
			t.Fatalf("unexpected request: %#v", payload)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"# Report"}}],"usage":{"prompt_tokens":1200,"completion_tokens":300,"total_tokens":1500}}`))
	}))
	defer server.Close()
	client := NewOpenAIClient(server.Client())
	result, err := client.CompletePromptWithUsage(context.Background(), ModelConfig{
		Endpoint: server.URL + "/v1", ModelID: "secure-model", APIKey: "test-secret",
		ProxyUserNo: "18600000000", ProxyUserName: "陈 xx", ProxyUserDeptName: "AI创新部",
	}, "skill", `{"diff":"content"}`)
	if err != nil {
		t.Fatal(err)
	}
	if requestPath != "/v1/chat/completions" || result.Output != "# Report" || result.InputTokens != 1200 || result.OutputTokens != 300 {
		t.Fatalf("unexpected response path=%q result=%#v", requestPath, result)
	}
}

func TestOpenAIClientCallsResponsesAPI(t *testing.T) {
	var requestPath string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestPath = request.URL.Path
		var payload struct {
			Model           string `json:"model"`
			Instructions    string `json:"instructions"`
			Input           string `json:"input"`
			MaxOutputTokens int    `json:"max_output_tokens"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Model != "secure-model" || payload.Instructions != "skill" || !strings.Contains(payload.Input, "context") || payload.MaxOutputTokens != 64 {
			t.Fatalf("unexpected request: %#v", payload)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"output":[{"type":"message","content":[{"type":"output_text","text":"# Responses Report"}]}]}`))
	}))
	defer server.Close()

	client := NewOpenAIClient(server.Client())
	report, err := client.Complete(context.Background(), ModelConfig{
		APIProtocol: "responses", Endpoint: server.URL + "/v1", ModelID: "secure-model", APIKey: "test-secret", MaxTokens: 64,
	}, "skill", "context")
	if err != nil {
		t.Fatal(err)
	}
	if requestPath != "/v1/responses" || report != "# Responses Report" {
		t.Fatalf("unexpected response path=%q report=%q", requestPath, report)
	}
}

func TestChatCompletionsURLRejectsInsecureRemoteEndpoint(t *testing.T) {
	if _, err := chatCompletionsURL("http://models.example.com/v1"); err == nil {
		t.Fatal("expected insecure remote endpoint to be rejected")
	}
}

func TestOpenAIClientDoesNotReturnHTMLErrorPage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "text/html")
		response.WriteHeader(http.StatusMethodNotAllowed)
		_, _ = response.Write([]byte(`<!DOCTYPE html><html>sensitive proxy details</html>`))
	}))
	defer server.Close()

	client := NewOpenAIClient(server.Client())
	_, err := client.Complete(context.Background(), ModelConfig{
		Endpoint: server.URL, ModelID: "secure-model", APIKey: "test-secret",
	}, "skill", "context")
	if err == nil || strings.Contains(err.Error(), "<html>") || !strings.Contains(err.Error(), "API base URL") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestModelEndpointErrorIncludesTopLevelJSONMessage(t *testing.T) {
	err := modelEndpointError(http.StatusMethodNotAllowed, "application/json", []byte(`{"message":"proxy rejected request"}`))
	if !strings.Contains(err.Error(), "proxy rejected request") {
		t.Fatalf("unexpected error: %v", err)
	}
}
