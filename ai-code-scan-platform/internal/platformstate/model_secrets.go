package platformstate

import (
	"encoding/json"
	"fmt"
	"strings"
)

type SecretCipher interface {
	Encrypt(string) (string, error)
	Decrypt(string) (string, error)
}

func protectModelSecrets(state, currentState json.RawMessage, secrets SecretCipher) (json.RawMessage, error) {
	root, models, err := decodeModels(state)
	if err != nil {
		return nil, err
	}
	existing := encryptedModelKeys(currentState)
	for _, model := range models {
		id := readString(model["id"])
		plaintext := readString(model["apiKey"])
		configured := readBool(model["apiKeyConfigured"])
		delete(model, "apiKey")
		delete(model, "apiKeyConfigured")
		delete(model, "apiKeyEncrypted")
		if strings.TrimSpace(plaintext) != "" {
			ciphertext, err := secrets.Encrypt(plaintext)
			if err != nil {
				return nil, fmt.Errorf("encrypt API key for model %s: %w", id, err)
			}
			model["apiKeyEncrypted"] = mustMarshal(ciphertext)
		} else if configured && existing[id] != "" {
			model["apiKeyEncrypted"] = mustMarshal(existing[id])
		}
	}
	root["aiModels"], err = json.Marshal(models)
	if err != nil {
		return nil, fmt.Errorf("encode AI model configuration: %w", err)
	}
	if err := protectScanQueueSecret(root, currentState, secrets); err != nil {
		return nil, err
	}
	if err := protectFeishuApplicationSecret(root, currentState, secrets); err != nil {
		return nil, err
	}
	stripUserAPIKeys(root)
	protected, err := json.Marshal(root)
	if err != nil {
		return nil, fmt.Errorf("encode platform state: %w", err)
	}
	return protected, nil
}

func redactModelSecrets(state json.RawMessage) (json.RawMessage, error) {
	root, models, err := decodeModels(state)
	if err != nil {
		return nil, err
	}
	for _, model := range models {
		configured := readString(model["apiKeyEncrypted"]) != ""
		delete(model, "apiKey")
		delete(model, "apiKeyEncrypted")
		model["apiKeyConfigured"] = mustMarshal(configured)
	}
	root["aiModels"], err = json.Marshal(models)
	if err != nil {
		return nil, fmt.Errorf("encode public AI model configuration: %w", err)
	}
	redactScanQueueSecret(root)
	redactFeishuApplicationSecret(root)
	stripUserAPIKeys(root)
	publicState, err := json.Marshal(root)
	if err != nil {
		return nil, fmt.Errorf("encode public platform state: %w", err)
	}
	return publicState, nil
}

func protectFeishuApplicationSecret(root map[string]json.RawMessage, currentState json.RawMessage, secrets SecretCipher) error {
	var application map[string]json.RawMessage
	if len(root["feishuApplication"]) == 0 {
		return nil
	}
	if err := json.Unmarshal(root["feishuApplication"], &application); err != nil {
		return fmt.Errorf("decode Feishu application configuration: %w", err)
	}
	plaintext := readString(application["appSecret"])
	configured := readBool(application["appSecretConfigured"])
	delete(application, "appSecret")
	delete(application, "appSecretConfigured")
	delete(application, "appSecretEncrypted")
	if strings.TrimSpace(plaintext) != "" {
		ciphertext, err := secrets.Encrypt(plaintext)
		if err != nil {
			return fmt.Errorf("encrypt Feishu application secret: %w", err)
		}
		application["appSecretEncrypted"] = mustMarshal(ciphertext)
	} else if configured {
		if existing := encryptedFeishuApplicationSecret(currentState); existing != "" {
			application["appSecretEncrypted"] = mustMarshal(existing)
		}
	}
	root["feishuApplication"] = mustMarshal(application)
	return nil
}

func redactFeishuApplicationSecret(root map[string]json.RawMessage) {
	var application map[string]json.RawMessage
	if len(root["feishuApplication"]) == 0 || json.Unmarshal(root["feishuApplication"], &application) != nil {
		return
	}
	configured := readString(application["appSecretEncrypted"]) != ""
	delete(application, "appSecret")
	delete(application, "appSecretEncrypted")
	application["appSecretConfigured"] = mustMarshal(configured)
	root["feishuApplication"] = mustMarshal(application)
}

func encryptedFeishuApplicationSecret(state json.RawMessage) string {
	if len(state) == 0 {
		return ""
	}
	var root map[string]json.RawMessage
	var application map[string]json.RawMessage
	if json.Unmarshal(state, &root) != nil || json.Unmarshal(root["feishuApplication"], &application) != nil {
		return ""
	}
	return readString(application["appSecretEncrypted"])
}

func protectScanQueueSecret(root map[string]json.RawMessage, currentState json.RawMessage, secrets SecretCipher) error {
	var queue map[string]json.RawMessage
	if len(root["scanQueue"]) == 0 {
		return nil
	}
	if err := json.Unmarshal(root["scanQueue"], &queue); err != nil {
		return fmt.Errorf("decode scan queue configuration: %w", err)
	}
	plaintext := readString(queue["brokerUrl"])
	configured := readBool(queue["brokerUrlConfigured"])
	delete(queue, "brokerUrl")
	delete(queue, "brokerUrlConfigured")
	delete(queue, "brokerUrlEncrypted")
	if strings.TrimSpace(plaintext) != "" {
		ciphertext, err := secrets.Encrypt(plaintext)
		if err != nil {
			return fmt.Errorf("encrypt scan queue broker URL: %w", err)
		}
		queue["brokerUrlEncrypted"] = mustMarshal(ciphertext)
	} else if configured {
		if existing := encryptedScanQueueBrokerURL(currentState); existing != "" {
			queue["brokerUrlEncrypted"] = mustMarshal(existing)
		}
	}
	root["scanQueue"] = mustMarshal(queue)
	return nil
}

func redactScanQueueSecret(root map[string]json.RawMessage) {
	var queue map[string]json.RawMessage
	if len(root["scanQueue"]) == 0 || json.Unmarshal(root["scanQueue"], &queue) != nil {
		return
	}
	configured := readString(queue["brokerUrlEncrypted"]) != ""
	delete(queue, "brokerUrl")
	delete(queue, "brokerUrlEncrypted")
	queue["brokerUrlConfigured"] = mustMarshal(configured)
	root["scanQueue"] = mustMarshal(queue)
}

func encryptedScanQueueBrokerURL(state json.RawMessage) string {
	if len(state) == 0 {
		return ""
	}
	var root map[string]json.RawMessage
	var queue map[string]json.RawMessage
	if json.Unmarshal(state, &root) != nil || json.Unmarshal(root["scanQueue"], &queue) != nil {
		return ""
	}
	return readString(queue["brokerUrlEncrypted"])
}

func stripUserAPIKeys(root map[string]json.RawMessage) {
	var users []map[string]json.RawMessage
	if len(root["users"]) == 0 || json.Unmarshal(root["users"], &users) != nil {
		return
	}
	for _, user := range users {
		delete(user, "apiKey")
	}
	root["users"] = mustMarshal(users)
}

func decodeModels(state json.RawMessage) (map[string]json.RawMessage, []map[string]json.RawMessage, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(state, &root); err != nil {
		return nil, nil, fmt.Errorf("decode platform state: %w", err)
	}
	var models []map[string]json.RawMessage
	if rawModels := root["aiModels"]; len(rawModels) > 0 {
		if err := json.Unmarshal(rawModels, &models); err != nil {
			return nil, nil, fmt.Errorf("decode AI model configuration: %w", err)
		}
	}
	return root, models, nil
}

func encryptedModelKeys(state json.RawMessage) map[string]string {
	keys := make(map[string]string)
	if len(state) == 0 {
		return keys
	}
	_, models, err := decodeModels(state)
	if err != nil {
		return keys
	}
	for _, model := range models {
		keys[readString(model["id"])] = readString(model["apiKeyEncrypted"])
	}
	return keys
}

func readString(value json.RawMessage) string {
	var result string
	_ = json.Unmarshal(value, &result)
	return result
}

func readBool(value json.RawMessage) bool {
	var result bool
	_ = json.Unmarshal(value, &result)
	return result
}

func mustMarshal(value any) json.RawMessage {
	encoded, _ := json.Marshal(value)
	return encoded
}
