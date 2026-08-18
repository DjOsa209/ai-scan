package config

import (
	"errors"
	"fmt"
	"math"
	"os"
	"strconv"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	HTTPAddress                 string
	MySQLDSN                    string
	AdminToken                  string
	BuiltInSkillRoot            string
	DistributionSkillsRoot      string
	SkillMaxBytes               int64
	SkillFetchTimeout           time.Duration
	ReviewMaxBytes              int64
	ReviewTimeout               time.Duration
	ReviewConcurrency           int
	PublicAPIBaseURL            string
	ScanQueueProtocol           string
	ScanQueueBrokerURL          string
	ScanQueueName               string
	ScanQueueExchange           string
	ScanQueueRoutingKey         string
	ScanQueueLiteName           string
	ScanQueueStandardName       string
	ScanQueueReleaseName        string
	ScanQueueLiteUrgentName     string
	ScanQueueStandardUrgentName string
	ScanQueueReleaseUrgentName  string
	ScanQueueLiteRoutingKey     string
	ScanQueueStandardRoutingKey string
	ScanQueueReleaseRoutingKey  string
	ModelKeyPath                string
	BootstrapAdminEmail         string
	BootstrapAdminPassword      string
	BootstrapAdminCredits       uint64
	ProductCatalogTimeout       time.Duration
	SSOEnabled                  bool
	SSOProvider                 string
	SSOFrontendURL              string
	SSORedirectURI              string
	SSOClientID                 string
	SSOClientSecret             string
	SSOAuthorizeURL             string
	SSOTokenURL                 string
	SSOUserInfoURL              string
	SSOScope                    string
	SSOUserIDField              string
	SSOUserNameField            string
	SSOUserEmailField           string
	SSOUACGateway               string
	SSOUACAppID                 string
	SSOUACLang                  string
	SSOUACSource                string
	SSOTimeout                  time.Duration
	FeishuAppID                 string
	FeishuAppSecret             string
	FeishuAPIBaseURL            string
}

func Load() (Config, error) {
	return load(".env")
}

func load(configFile string) (Config, error) {
	source := viper.New()
	source.SetConfigFile(configFile)
	source.SetConfigType("env")
	source.AutomaticEnv()
	if err := source.ReadInConfig(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return Config{}, fmt.Errorf("read configuration file: %w", err)
	}

	config := Config{
		HTTPAddress:                 valueOrDefault(source, "HTTP_ADDRESS", ":8080"),
		MySQLDSN:                    source.GetString("MYSQL_DSN"),
		AdminToken:                  source.GetString("ADMIN_TOKEN"),
		BuiltInSkillRoot:            valueOrDefault(source, "BUILTIN_SKILL_ROOT", "../plugin-raw/.github/skills/security-baseline-review"),
		DistributionSkillsRoot:      valueOrDefault(source, "DISTRIBUTION_SKILLS_ROOT", "./skills"),
		SkillMaxBytes:               256 * 1024,
		SkillFetchTimeout:           15 * time.Second,
		ReviewMaxBytes:              2 * 1024 * 1024,
		ReviewTimeout:               3 * time.Minute,
		ReviewConcurrency:           4,
		PublicAPIBaseURL:            valueOrDefault(source, "PUBLIC_API_BASE_URL", "http://localhost:8080"),
		ScanQueueProtocol:           valueOrDefault(source, "SCAN_QUEUE_PROTOCOL", "rabbitmq"),
		ScanQueueBrokerURL:          source.GetString("SCAN_QUEUE_BROKER_URL"),
		ScanQueueName:               source.GetString("SCAN_QUEUE_NAME"),
		ScanQueueExchange:           source.GetString("SCAN_QUEUE_EXCHANGE"),
		ScanQueueRoutingKey:         source.GetString("SCAN_QUEUE_ROUTING_KEY"),
		ScanQueueLiteName:           source.GetString("SCAN_QUEUE_LITE_NAME"),
		ScanQueueStandardName:       source.GetString("SCAN_QUEUE_STANDARD_NAME"),
		ScanQueueReleaseName:        source.GetString("SCAN_QUEUE_RELEASE_NAME"),
		ScanQueueLiteUrgentName:     source.GetString("SCAN_QUEUE_LITE_URGENT_NAME"),
		ScanQueueStandardUrgentName: source.GetString("SCAN_QUEUE_STANDARD_URGENT_NAME"),
		ScanQueueReleaseUrgentName:  source.GetString("SCAN_QUEUE_RELEASE_URGENT_NAME"),
		ScanQueueLiteRoutingKey:     source.GetString("SCAN_QUEUE_LITE_ROUTING_KEY"),
		ScanQueueStandardRoutingKey: source.GetString("SCAN_QUEUE_STANDARD_ROUTING_KEY"),
		ScanQueueReleaseRoutingKey:  source.GetString("SCAN_QUEUE_RELEASE_ROUTING_KEY"),
		ModelKeyPath:                valueOrDefault(source, "MODEL_KEY_PATH", "./data/model-key"),
		BootstrapAdminEmail:         source.GetString("BOOTSTRAP_ADMIN_EMAIL"),
		BootstrapAdminPassword:      source.GetString("BOOTSTRAP_ADMIN_PASSWORD"),
		ProductCatalogTimeout:       15 * time.Second,
		SSOEnabled:                  source.GetBool("SSO_AUTH_ENABLED"),
		SSOProvider:                 valueOrDefault(source, "SSO_PROVIDER", "uac"),
		SSOFrontendURL:              source.GetString("SSO_FRONTEND_URL"),
		SSORedirectURI:              source.GetString("SSO_REDIRECT_URI"),
		SSOClientID:                 source.GetString("SSO_CLIENT_ID"),
		SSOClientSecret:             source.GetString("SSO_CLIENT_SECRET"),
		SSOAuthorizeURL:             source.GetString("SSO_AUTHORIZE_URL"),
		SSOTokenURL:                 source.GetString("SSO_TOKEN_URL"),
		SSOUserInfoURL:              source.GetString("SSO_USERINFO_URL"),
		SSOScope:                    valueOrDefault(source, "SSO_SCOPE", "openid profile email"),
		SSOUserIDField:              valueOrDefault(source, "SSO_USER_ID_FIELD", "sub"),
		SSOUserNameField:            valueOrDefault(source, "SSO_USER_NAME_FIELD", "name"),
		SSOUserEmailField:           valueOrDefault(source, "SSO_USER_EMAIL_FIELD", "email"),
		SSOUACGateway:               source.GetString("SSO_UAC_GATEWAY"),
		SSOUACAppID:                 source.GetString("SSO_UAC_APP_ID"),
		SSOUACLang:                  valueOrDefault(source, "SSO_UAC_LANG", "zh"),
		SSOUACSource:                source.GetString("SSO_UAC_SOURCE"),
		SSOTimeout:                  15 * time.Second,
		FeishuAppID:                 source.GetString("FEISHU_APP_ID"),
		FeishuAppSecret:             source.GetString("FEISHU_APP_SECRET"),
		FeishuAPIBaseURL:            valueOrDefault(source, "FEISHU_API_BASE_URL", "https://open.feishu.cn"),
	}
	if config.SSOEnabled {
		if config.SSORedirectURI == "" || config.SSOFrontendURL == "" {
			return Config{}, fmt.Errorf("SSO_REDIRECT_URI and SSO_FRONTEND_URL are required when SSO is enabled")
		}
		if config.SSOProvider == "uac" {
			if config.SSOUACGateway == "" || config.SSOUACAppID == "" {
				return Config{}, fmt.Errorf("SSO_UAC_GATEWAY and SSO_UAC_APP_ID are required for UAC SSO")
			}
		} else if config.SSOClientID == "" || config.SSOClientSecret == "" || config.SSOAuthorizeURL == "" || config.SSOTokenURL == "" || config.SSOUserInfoURL == "" {
			return Config{}, fmt.Errorf("SSO client, authorize, token and userinfo settings are required for OAuth2 SSO")
		}
	}
	if value := source.GetString("PRODUCT_CATALOG_TIMEOUT_SECONDS"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			return Config{}, fmt.Errorf("PRODUCT_CATALOG_TIMEOUT_SECONDS must be a positive integer")
		}
		config.ProductCatalogTimeout = time.Duration(parsed) * time.Second
	}
	if value := source.GetString("SKILL_MAX_BYTES"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil || parsed <= 0 {
			return Config{}, fmt.Errorf("SKILL_MAX_BYTES must be a positive integer")
		}
		config.SkillMaxBytes = parsed
	}
	if value := source.GetString("REVIEW_MAX_BYTES"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil || parsed <= 0 {
			return Config{}, fmt.Errorf("REVIEW_MAX_BYTES must be a positive integer")
		}
		config.ReviewMaxBytes = parsed
	}
	if value := source.GetString("REVIEW_TIMEOUT_SECONDS"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			return Config{}, fmt.Errorf("REVIEW_TIMEOUT_SECONDS must be a positive integer")
		}
		config.ReviewTimeout = time.Duration(parsed) * time.Second
	}
	if value := source.GetString("REVIEW_MAX_CONCURRENT"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			return Config{}, fmt.Errorf("REVIEW_MAX_CONCURRENT must be a positive integer")
		}
		config.ReviewConcurrency = parsed
	}
	if config.MySQLDSN == "" {
		return Config{}, fmt.Errorf("MYSQL_DSN is required")
	}
	if config.AdminToken == "" {
		return Config{}, fmt.Errorf("ADMIN_TOKEN is required")
	}
	levelQueueNames := []string{config.ScanQueueLiteName, config.ScanQueueStandardName, config.ScanQueueReleaseName}
	configuredLevelQueues := 0
	for _, name := range levelQueueNames {
		if name != "" {
			configuredLevelQueues++
		}
	}
	if config.ScanQueueBrokerURL == "" && (config.ScanQueueName != "" || configuredLevelQueues > 0) {
		return Config{}, fmt.Errorf("SCAN_QUEUE_BROKER_URL is required when scan queues are configured")
	}
	if config.ScanQueueBrokerURL != "" && config.ScanQueueName == "" && configuredLevelQueues != len(levelQueueNames) {
		return Config{}, fmt.Errorf("configure SCAN_QUEUE_NAME or all three level queue names")
	}
	if config.ScanQueueBrokerURL != "" && config.ScanQueueProtocol != "rabbitmq" && config.ScanQueueProtocol != "kafka" {
		return Config{}, fmt.Errorf("SCAN_QUEUE_PROTOCOL must be rabbitmq or kafka")
	}
	bootstrapCredits := source.GetString("BOOTSTRAP_ADMIN_CREDITS")
	if config.BootstrapAdminEmail != "" || config.BootstrapAdminPassword != "" || bootstrapCredits != "" {
		if config.BootstrapAdminEmail == "" || config.BootstrapAdminPassword == "" || bootstrapCredits == "" {
			return Config{}, fmt.Errorf("BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD and BOOTSTRAP_ADMIN_CREDITS must be provided together")
		}
		if len(config.BootstrapAdminPassword) < 12 {
			return Config{}, fmt.Errorf("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters")
		}
		parsed, err := strconv.ParseUint(bootstrapCredits, 10, 64)
		if err != nil || parsed > math.MaxInt64 {
			return Config{}, fmt.Errorf("BOOTSTRAP_ADMIN_CREDITS must be a non-negative integer")
		}
		config.BootstrapAdminCredits = parsed
	}
	return config, nil
}

func valueOrDefault(source *viper.Viper, name, fallback string) string {
	if value := source.GetString(name); value != "" {
		return value
	}
	return fallback
}
