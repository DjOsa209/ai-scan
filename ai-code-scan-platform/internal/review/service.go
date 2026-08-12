package review

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"ai-code-scan-platform/internal/reportjson"
	"ai-code-scan-platform/internal/skill"
)

var (
	ErrBusy               = errors.New("review capacity is exhausted")
	ErrModelNotConfigured = errors.New("no enabled external model is configured")
)

type Input struct {
	WorkspaceLabel string        `json:"workspaceLabel"`
	Context        ContextBundle `json:"context"`
}

type ContextBundle struct {
	GitStatus string        `json:"gitStatus"`
	Diff      string        `json:"diff"`
	Files     []ContextFile `json:"files"`
}

type ContextFile struct {
	Path    string `json:"path"`
	Kind    string `json:"kind"`
	Content string `json:"content"`
}

type Result struct {
	ModelID      string `json:"modelId"`
	ModelName    string `json:"modelName"`
	SkillVersion string `json:"skillVersion"`
	ReportJSON   string `json:"reportJson"`
}

type ModelConfig struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	Enabled           bool    `json:"enabled"`
	APIProtocol       string  `json:"apiProtocol"`
	Endpoint          string  `json:"endpoint"`
	ModelID           string  `json:"modelId"`
	APIKeyEncrypted   string  `json:"apiKeyEncrypted"`
	APIKey            string  `json:"-"`
	ProxyUserNo       string  `json:"proxyUserNo"`
	ProxyUserName     string  `json:"proxyUserName"`
	ProxyUserDeptName string  `json:"proxyUserDeptName"`
	Temperature       float64 `json:"temperature"`
	MaxTokens         int     `json:"maxTokens"`
}

type ConnectionInput struct {
	ID                string  `json:"id"`
	APIProtocol       string  `json:"apiProtocol"`
	Endpoint          string  `json:"endpoint"`
	ModelID           string  `json:"modelId"`
	APIKey            string  `json:"apiKey"`
	ProxyUserNo       string  `json:"proxyUserNo"`
	ProxyUserName     string  `json:"proxyUserName"`
	ProxyUserDeptName string  `json:"proxyUserDeptName"`
	Temperature       float64 `json:"temperature"`
}

type ConnectionResult struct {
	OK        bool   `json:"ok"`
	LatencyMS int64  `json:"latencyMs"`
	Message   string `json:"message"`
}

type SkillResolver interface {
	Resolve(context.Context) (skill.ResolvedSkill, error)
}

type ModelClient interface {
	Complete(context.Context, ModelConfig, string, string) (string, error)
}

type PromptModelClient interface {
	CompletePromptWithUsage(context.Context, ModelConfig, string, string) (PromptResult, error)
}

type SecretDecrypter interface {
	Decrypt(string) (string, error)
}

type StateLoader func(context.Context) (json.RawMessage, error)

type Service struct {
	loadState StateLoader
	skills    SkillResolver
	models    ModelClient
	secrets   SecretDecrypter
	capacity  chan struct{}
}

func NewService(loadState StateLoader, skills SkillResolver, models ModelClient, secrets SecretDecrypter, maxConcurrent int) *Service {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	return &Service{loadState: loadState, skills: skills, models: models, secrets: secrets, capacity: make(chan struct{}, maxConcurrent)}
}

func (service *Service) ResolveModelID(ctx context.Context, requestedID string) (string, error) {
	model, err := service.resolveModel(ctx, requestedID)
	if err != nil {
		return "", err
	}
	return model.ID, nil
}

func (service *Service) CompletePrompt(ctx context.Context, modelID, systemPrompt, userPrompt string) (PromptResult, error) {
	client, ok := service.models.(PromptModelClient)
	if !ok {
		return PromptResult{}, fmt.Errorf("model client does not support prompt proxying")
	}
	select {
	case service.capacity <- struct{}{}:
		defer func() { <-service.capacity }()
	default:
		return PromptResult{}, ErrBusy
	}
	model, err := service.resolveModel(ctx, modelID)
	if err != nil {
		return PromptResult{}, err
	}
	return client.CompletePromptWithUsage(ctx, model, systemPrompt, userPrompt)
}

func (service *Service) resolveModel(ctx context.Context, requestedID string) (ModelConfig, error) {
	state, err := service.loadState(ctx)
	if err != nil {
		return ModelConfig{}, fmt.Errorf("load platform state: %w", err)
	}
	if strings.TrimSpace(requestedID) == "" {
		return selectModel(state, service.secrets)
	}
	model, err := modelByID(state, requestedID, service.secrets)
	if err != nil {
		return ModelConfig{}, err
	}
	if !model.Enabled {
		return ModelConfig{}, fmt.Errorf("model %s is disabled", requestedID)
	}
	return model, nil
}

func (service *Service) Run(ctx context.Context, input Input) (Result, error) {
	contextBytes, err := json.Marshal(input.Context)
	if err != nil {
		return Result{}, fmt.Errorf("encode review context: %w", err)
	}
	if strings.TrimSpace(input.Context.GitStatus) == "" && strings.TrimSpace(input.Context.Diff) == "" && len(input.Context.Files) == 0 {
		return Result{}, fmt.Errorf("review context is required")
	}
	select {
	case service.capacity <- struct{}{}:
		defer func() { <-service.capacity }()
	default:
		return Result{}, ErrBusy
	}

	state, err := service.loadState(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("load platform state: %w", err)
	}
	model, err := selectModel(state, service.secrets)
	if err != nil {
		return Result{}, err
	}
	resolvedSkill, err := service.skills.Resolve(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("resolve review skill: %w", err)
	}
	report, err := service.models.Complete(ctx, model, resolvedSkill.Content, string(contextBytes))
	if err != nil {
		return Result{}, fmt.Errorf("model review failed: %w", err)
	}
	if strings.TrimSpace(report) == "" {
		return Result{}, fmt.Errorf("model returned an empty review")
	}
	if err := reportjson.Validate(report); err != nil {
		return Result{}, fmt.Errorf("model returned an invalid structured report: %w", err)
	}
	return Result{
		ModelID: model.ModelID, ModelName: model.Name, SkillVersion: resolvedSkill.Version, ReportJSON: report,
	}, nil
}

func (service *Service) TestConnection(ctx context.Context, input ConnectionInput) (ConnectionResult, error) {
	if strings.TrimSpace(input.Endpoint) == "" || strings.TrimSpace(input.ModelID) == "" {
		return ConnectionResult{}, fmt.Errorf("model endpoint and model ID are required")
	}
	model := ModelConfig{
		ID: input.ID, APIProtocol: input.APIProtocol, Endpoint: input.Endpoint, ModelID: input.ModelID, APIKey: input.APIKey,
		ProxyUserNo: input.ProxyUserNo, ProxyUserName: input.ProxyUserName, ProxyUserDeptName: input.ProxyUserDeptName,
		Temperature: input.Temperature, MaxTokens: 8,
	}
	if strings.TrimSpace(model.APIKey) == "" {
		state, err := service.loadState(ctx)
		if err != nil {
			return ConnectionResult{}, fmt.Errorf("load platform state: %w", err)
		}
		model, err = modelByID(state, input.ID, service.secrets)
		if err != nil {
			return ConnectionResult{}, err
		}
		model.Endpoint = input.Endpoint
		model.ModelID = input.ModelID
		model.APIProtocol = input.APIProtocol
		model.ProxyUserNo = input.ProxyUserNo
		model.ProxyUserName = input.ProxyUserName
		model.ProxyUserDeptName = input.ProxyUserDeptName
		model.Temperature = input.Temperature
		model.MaxTokens = 8
	}
	started := time.Now()
	if _, err := service.models.Complete(ctx, model, "Reply with OK only.", "Connectivity test"); err != nil {
		return ConnectionResult{}, fmt.Errorf("model connection failed: %w", err)
	}
	return ConnectionResult{OK: true, LatencyMS: time.Since(started).Milliseconds(), Message: "连接成功"}, nil
}

func selectModel(state json.RawMessage, secrets SecretDecrypter) (ModelConfig, error) {
	var configuration struct {
		AIModels []ModelConfig `json:"aiModels"`
	}
	if err := json.Unmarshal(state, &configuration); err != nil {
		return ModelConfig{}, fmt.Errorf("decode platform model configuration: %w", err)
	}
	for _, model := range configuration.AIModels {
		if model.Enabled && strings.TrimSpace(model.Endpoint) != "" && strings.TrimSpace(model.ModelID) != "" && strings.TrimSpace(model.APIKeyEncrypted) != "" {
			return decryptModel(model, secrets)
		}
	}
	return ModelConfig{}, ErrModelNotConfigured
}

func modelByID(state json.RawMessage, id string, secrets SecretDecrypter) (ModelConfig, error) {
	var configuration struct {
		AIModels []ModelConfig `json:"aiModels"`
	}
	if err := json.Unmarshal(state, &configuration); err != nil {
		return ModelConfig{}, fmt.Errorf("decode platform model configuration: %w", err)
	}
	for _, model := range configuration.AIModels {
		if model.ID == id && strings.TrimSpace(model.APIKeyEncrypted) != "" {
			return decryptModel(model, secrets)
		}
	}
	return ModelConfig{}, fmt.Errorf("model API key is required")
}

func decryptModel(model ModelConfig, secrets SecretDecrypter) (ModelConfig, error) {
	apiKey, err := secrets.Decrypt(model.APIKeyEncrypted)
	if err != nil {
		return ModelConfig{}, fmt.Errorf("decrypt API key for model %s: %w", model.ID, err)
	}
	model.APIKey = apiKey
	model.APIKeyEncrypted = ""
	return model, nil
}
