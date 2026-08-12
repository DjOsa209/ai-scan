package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Protocol          string
	BrokerURL         string
	AdminToken        string
	PlatformURL       string
	WorkRoot          string
	DatabasePath      string
	RabbitQueues      []string
	KafkaBrokers      []string
	KafkaTopics       []string
	KafkaGroupID      string
	MaxFileBytes      int64
	MaxConcurrency    int
	CallbackTimeout   time.Duration
	AIEnabled         bool
	ModelAccessMode   string
	ModelProtocol     string
	ModelEndpoint     string
	ModelID           string
	ModelAPIKey       string
	BuiltInSkillRoot  string
	ProxyUserNo       string
	ProxyUserName     string
	ProxyUserDept     string
	ModelTemperature  float64
	ModelMaxTokens    int
	ModelContextBytes int
	ModelMaxBatches   int
	ModelTimeout      time.Duration
}

func Load() (Config, error) {
	configuration := Config{
		Protocol: env("QUEUE_PROTOCOL", "rabbitmq"), BrokerURL: os.Getenv("QUEUE_BROKER_URL"),
		AdminToken: os.Getenv("PLATFORM_ADMIN_TOKEN"), PlatformURL: strings.TrimRight(os.Getenv("PLATFORM_BASE_URL"), "/"),
		WorkRoot: env("ENGINE_WORK_ROOT", "./data/work"), DatabasePath: env("ENGINE_DATABASE_PATH", "./data/engine.db"),
		RabbitQueues: csv(env("RABBITMQ_QUEUES", "security.scan.lite,security.scan.standard,security.scan.release")),
		KafkaBrokers: csv(os.Getenv("KAFKA_BROKERS")), KafkaGroupID: env("KAFKA_GROUP_ID", "ai-scan-engine"),
		MaxFileBytes: int64(envInt("MAX_FILE_BYTES", 1024*1024)), MaxConcurrency: envInt("MAX_CONCURRENCY", 2),
		CallbackTimeout: time.Duration(envInt("CALLBACK_TIMEOUT_SECONDS", 15)) * time.Second,
		AIEnabled:       envBool("AI_ANALYSIS_ENABLED", false), ModelAccessMode: env("AI_MODEL_ACCESS_MODE", "platform"), ModelProtocol: env("AI_MODEL_PROTOCOL", "responses"),
		ModelEndpoint: strings.TrimRight(os.Getenv("AI_MODEL_ENDPOINT"), "/"), ModelID: os.Getenv("AI_MODEL_ID"), ModelAPIKey: os.Getenv("AI_MODEL_API_KEY"),
		BuiltInSkillRoot: env("BUILTIN_SKILL_ROOT", "../plugin-raw/.github/skills/security-baseline-review"),
		ProxyUserNo:      os.Getenv("AI_PROXY_USER_NO"), ProxyUserName: os.Getenv("AI_PROXY_USER_NAME"), ProxyUserDept: os.Getenv("AI_PROXY_USER_DEPT_NAME"),
		ModelTemperature: envFloat("AI_MODEL_TEMPERATURE", 0.1), ModelMaxTokens: envInt("AI_MODEL_MAX_TOKENS", 4096),
		ModelContextBytes: envInt("AI_MODEL_CONTEXT_BYTES", 120000), ModelMaxBatches: envNonNegativeInt("AI_MODEL_MAX_BATCHES", 0),
		ModelTimeout: time.Duration(envInt("AI_MODEL_TIMEOUT_SECONDS", 210)) * time.Second,
	}
	baseTopics := csv(env("KAFKA_TOPICS", "security.scan.lite,security.scan.standard,security.scan.release"))
	configuration.KafkaTopics = append(configuration.KafkaTopics, baseTopics...)
	for _, topic := range baseTopics {
		configuration.KafkaTopics = append(configuration.KafkaTopics, topic+".urgent")
	}
	if configuration.AdminToken == "" {
		return Config{}, fmt.Errorf("PLATFORM_ADMIN_TOKEN is required")
	}
	if configuration.Protocol != "rabbitmq" && configuration.Protocol != "kafka" {
		return Config{}, fmt.Errorf("QUEUE_PROTOCOL must be rabbitmq or kafka")
	}
	if configuration.Protocol == "rabbitmq" && configuration.BrokerURL == "" {
		return Config{}, fmt.Errorf("QUEUE_BROKER_URL is required for rabbitmq")
	}
	if configuration.Protocol == "kafka" && len(configuration.KafkaBrokers) == 0 {
		return Config{}, fmt.Errorf("KAFKA_BROKERS is required for kafka")
	}
	if configuration.AIEnabled {
		if configuration.ModelAccessMode != "platform" && configuration.ModelAccessMode != "direct" {
			return Config{}, fmt.Errorf("AI_MODEL_ACCESS_MODE must be platform or direct")
		}
		if configuration.ModelAccessMode == "platform" && configuration.PlatformURL == "" {
			return Config{}, fmt.Errorf("PLATFORM_BASE_URL is required for platform model access")
		}
		if configuration.ModelAccessMode == "direct" {
			if configuration.ModelProtocol != "chat-completions" && configuration.ModelProtocol != "responses" {
				return Config{}, fmt.Errorf("AI_MODEL_PROTOCOL must be chat-completions or responses")
			}
			if blank(configuration.ModelEndpoint, configuration.ModelID, configuration.ModelAPIKey) {
				return Config{}, fmt.Errorf("AI_MODEL_ENDPOINT, AI_MODEL_ID, and AI_MODEL_API_KEY are required for direct model access")
			}
		}
	}
	return configuration, nil
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func envNonNegativeInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}

func envFloat(name string, fallback float64) float64 {
	value, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv(name)), 64)
	if err != nil || value < 0 {
		return fallback
	}
	return value
}

func envBool(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func blank(values ...string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return true
		}
	}
	return false
}

func csv(value string) []string {
	var values []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			values = append(values, item)
		}
	}
	return values
}
