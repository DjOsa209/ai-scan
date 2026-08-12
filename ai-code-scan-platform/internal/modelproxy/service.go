package modelproxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"ai-code-scan-platform/internal/review"
	"ai-code-scan-platform/internal/scan"
)

var ErrInvalidSession = errors.New("invalid or expired model session")

type TaskReader interface {
	Get(context.Context, string) (scan.Task, error)
}

type ModelGateway interface {
	ResolveModelID(context.Context, string) (string, error)
	CompletePrompt(context.Context, string, string, string) (review.PromptResult, error)
}

type Cipher interface {
	Encrypt(string) (string, error)
	Decrypt(string) (string, error)
}

type Service struct {
	tasks  TaskReader
	models ModelGateway
	cipher Cipher
	ttl    time.Duration
	now    func() time.Time
}

type Session struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type PromptInput struct {
	System string `json:"system"`
	User   string `json:"user"`
}

type PromptOutput struct {
	Output       string `json:"output"`
	InputTokens  uint64 `json:"inputTokens"`
	OutputTokens uint64 `json:"outputTokens"`
	TotalTokens  uint64 `json:"totalTokens"`
	Estimated    bool   `json:"estimated"`
}

type sessionClaims struct {
	Purpose   string `json:"purpose"`
	TaskID    string `json:"taskId"`
	ModelID   string `json:"modelId"`
	ExpiresAt int64  `json:"expiresAt"`
}

func NewService(tasks TaskReader, models ModelGateway, cipher Cipher, ttl time.Duration) *Service {
	return &Service{tasks: tasks, models: models, cipher: cipher, ttl: ttl, now: time.Now}
}

func (service *Service) Issue(ctx context.Context, taskID string) (Session, error) {
	task, err := service.tasks.Get(ctx, strings.TrimSpace(taskID))
	if err != nil {
		return Session{}, fmt.Errorf("load scan task: %w", err)
	}
	modelID, err := service.models.ResolveModelID(ctx, task.ScanConfiguration.AIModelID)
	if err != nil {
		return Session{}, fmt.Errorf("resolve scan model: %w", err)
	}
	expiresAt := service.now().UTC().Add(service.ttl)
	claims, err := json.Marshal(sessionClaims{
		Purpose: "scan-model-session-v1", TaskID: task.ID, ModelID: modelID, ExpiresAt: expiresAt.Unix(),
	})
	if err != nil {
		return Session{}, fmt.Errorf("encode model session: %w", err)
	}
	token, err := service.cipher.Encrypt(string(claims))
	if err != nil {
		return Session{}, fmt.Errorf("encrypt model session: %w", err)
	}
	return Session{Token: token, ExpiresAt: expiresAt}, nil
}

func (service *Service) Complete(ctx context.Context, token string, input PromptInput) (PromptOutput, error) {
	claims, err := service.decodeClaims(token)
	if err != nil {
		return PromptOutput{}, err
	}
	if strings.TrimSpace(input.System) == "" || strings.TrimSpace(input.User) == "" {
		return PromptOutput{}, fmt.Errorf("system and user prompts are required")
	}
	result, err := service.models.CompletePrompt(ctx, claims.ModelID, input.System, input.User)
	if err != nil {
		return PromptOutput{}, fmt.Errorf("complete model prompt: %w", err)
	}
	return PromptOutput{Output: result.Output, InputTokens: result.InputTokens, OutputTokens: result.OutputTokens, TotalTokens: result.TotalTokens, Estimated: result.Estimated}, nil
}

func (service *Service) decodeClaims(token string) (sessionClaims, error) {
	plaintext, err := service.cipher.Decrypt(strings.TrimSpace(token))
	if err != nil {
		return sessionClaims{}, ErrInvalidSession
	}
	var claims sessionClaims
	if json.Unmarshal([]byte(plaintext), &claims) != nil || claims.Purpose != "scan-model-session-v1" || strings.TrimSpace(claims.TaskID) == "" || strings.TrimSpace(claims.ModelID) == "" || !service.now().UTC().Before(time.Unix(claims.ExpiresAt, 0)) {
		return sessionClaims{}, ErrInvalidSession
	}
	return claims, nil
}
