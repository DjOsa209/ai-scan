package platformstate

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"ai-code-scan-platform/internal/secretstore"
)

func TestProtectAndRedactModelSecrets(t *testing.T) {
	cipher, err := secretstore.New(bytes.Repeat([]byte{3}, 32))
	if err != nil {
		t.Fatal(err)
	}
	protected, err := protectModelSecrets(json.RawMessage(`{"aiModels":[{"id":"secure","apiKey":"provider-secret"}]}`), nil, cipher)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(protected), "provider-secret") || !strings.Contains(string(protected), "apiKeyEncrypted") {
		t.Fatalf("secret was not protected: %s", protected)
	}
	publicState, err := redactModelSecrets(protected)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(publicState), "apiKeyEncrypted") || !strings.Contains(string(publicState), `"apiKeyConfigured":true`) {
		t.Fatalf("secret was not redacted: %s", publicState)
	}
}

func TestProtectModelSecretsPreservesConfiguredKey(t *testing.T) {
	cipher, err := secretstore.New(bytes.Repeat([]byte{5}, 32))
	if err != nil {
		t.Fatal(err)
	}
	current, err := protectModelSecrets(json.RawMessage(`{"aiModels":[{"id":"secure","apiKey":"provider-secret"}]}`), nil, cipher)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := protectModelSecrets(json.RawMessage(`{"aiModels":[{"id":"secure","name":"Updated","apiKeyConfigured":true}]}`), current, cipher)
	if err != nil {
		t.Fatal(err)
	}
	if encryptedModelKeys(updated)["secure"] != encryptedModelKeys(current)["secure"] {
		t.Fatal("existing encrypted API key was not preserved")
	}
}

func TestProtectAndRedactScanQueueBrokerURL(t *testing.T) {
	cipher, err := secretstore.New(bytes.Repeat([]byte{9}, 32))
	if err != nil {
		t.Fatal(err)
	}
	protected, err := protectModelSecrets(json.RawMessage(`{"aiModels":[],"scanQueue":{"enabled":true,"brokerUrl":"amqps://publisher:secret@mq.example.com/security"}}`), nil, cipher)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(protected), "publisher:secret") || !strings.Contains(string(protected), "brokerUrlEncrypted") {
		t.Fatalf("broker URL was not protected: %s", protected)
	}
	publicState, err := redactModelSecrets(protected)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(publicState), "brokerUrlEncrypted") || !strings.Contains(string(publicState), `"brokerUrlConfigured":true`) {
		t.Fatalf("broker URL was not redacted: %s", publicState)
	}
}

func TestProtectScanQueueSecretPreservesConfiguredBrokerURL(t *testing.T) {
	cipher, err := secretstore.New(bytes.Repeat([]byte{11}, 32))
	if err != nil {
		t.Fatal(err)
	}
	current, err := protectModelSecrets(json.RawMessage(`{"aiModels":[],"scanQueue":{"brokerUrl":"amqps://publisher:secret@mq.example.com/security"}}`), nil, cipher)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := protectModelSecrets(json.RawMessage(`{"aiModels":[],"scanQueue":{"enabled":true,"brokerUrlConfigured":true}}`), current, cipher)
	if err != nil {
		t.Fatal(err)
	}
	if encryptedScanQueueBrokerURL(updated) != encryptedScanQueueBrokerURL(current) {
		t.Fatal("existing encrypted broker URL was not preserved")
	}
}

func TestProtectAndRedactFeishuApplicationSecret(t *testing.T) {
	cipher, err := secretstore.New(bytes.Repeat([]byte{13}, 32))
	if err != nil {
		t.Fatal(err)
	}
	protected, err := protectModelSecrets(json.RawMessage(`{"aiModels":[],"feishuApplication":{"appId":"cli_app","appSecret":"application-secret"}}`), nil, cipher)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(protected), "application-secret") || !strings.Contains(string(protected), "appSecretEncrypted") {
		t.Fatalf("Feishu secret was not protected: %s", protected)
	}
	publicState, err := redactModelSecrets(protected)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(publicState), "appSecretEncrypted") || !strings.Contains(string(publicState), `"appSecretConfigured":true`) {
		t.Fatalf("Feishu secret was not redacted: %s", publicState)
	}
}

func TestPlatformStateNeverPersistsOrReturnsUserAPIKeys(t *testing.T) {
	cipher, err := secretstore.New(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	state := json.RawMessage(`{"users":[{"id":"user-1","apiKey":"sk_user_plaintext"}],"aiModels":[]}`)
	protected, err := protectModelSecrets(state, nil, cipher)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(protected), "sk_user_plaintext") || strings.Contains(string(protected), `"apiKey"`) {
		t.Fatalf("user API key was persisted in platform state: %s", protected)
	}
	publicState, err := redactModelSecrets(protected)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(publicState), "sk_user_plaintext") || strings.Contains(string(publicState), `"apiKey"`) {
		t.Fatalf("user API key was returned from platform state: %s", publicState)
	}
}
