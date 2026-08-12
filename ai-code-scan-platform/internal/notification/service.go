package notification

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"ai-code-scan-platform/internal/scan"
)

var ErrWebhookRequired = errors.New("Feishu webhook URL is required")
var ErrWebhookNotConfigured = errors.New("Feishu webhook is not configured")

type SecretCipher interface {
	Encrypt(string) (string, error)
	Decrypt(string) (string, error)
}

type ApplicationClientProvider func(context.Context) (*FeishuClient, error)

type Preference struct {
	ApplicationEnabled bool `json:"applicationEnabled"`
	WebhookEnabled     bool `json:"webhookEnabled"`
	WebhookConfigured  bool `json:"webhookConfigured"`
}

type Service struct {
	repository                *Repository
	secrets                   SecretCipher
	feishu                    *FeishuClient
	applicationClientProvider ApplicationClientProvider
	frontend                  string
}

func (service *Service) WithApplicationClientProvider(provider ApplicationClientProvider) *Service {
	service.applicationClientProvider = provider
	return service
}

func NewService(repository *Repository, secrets SecretCipher, feishu *FeishuClient, frontendURL string) *Service {
	return &Service{repository: repository, secrets: secrets, feishu: feishu, frontend: strings.TrimRight(frontendURL, "/")}
}

func (service *Service) Preference(ctx context.Context, userID string) (Preference, error) {
	target, err := service.repository.TargetForUser(ctx, userID)
	if err != nil {
		return Preference{}, err
	}
	return Preference{ApplicationEnabled: target.ApplicationEnabled, WebhookEnabled: target.WebhookEnabled, WebhookConfigured: target.WebhookURLCiphertext != ""}, nil
}

func (service *Service) UpdatePreference(ctx context.Context, userID string, applicationEnabled, webhookEnabled bool, webhookURL string) (Preference, error) {
	webhookURL = strings.TrimSpace(webhookURL)
	target, err := service.repository.TargetForUser(ctx, userID)
	if err != nil {
		return Preference{}, err
	}
	ciphertext := ""
	if webhookURL != "" {
		if err := validateWebhookURL(webhookURL); err != nil {
			return Preference{}, err
		}
		ciphertext, err = service.secrets.Encrypt(webhookURL)
		if err != nil {
			return Preference{}, fmt.Errorf("encrypt Feishu webhook: %w", err)
		}
	}
	if webhookEnabled && ciphertext == "" && target.WebhookURLCiphertext == "" {
		return Preference{}, ErrWebhookRequired
	}
	if err := service.repository.SavePreference(ctx, userID, applicationEnabled, webhookEnabled, ciphertext); err != nil {
		return Preference{}, err
	}
	return Preference{ApplicationEnabled: applicationEnabled, WebhookEnabled: webhookEnabled, WebhookConfigured: ciphertext != "" || target.WebhookURLCiphertext != ""}, nil
}

func (service *Service) TestWebhook(ctx context.Context, userID string) error {
	target, err := service.repository.TargetForUser(ctx, userID)
	if err != nil {
		return err
	}
	if target.WebhookURLCiphertext == "" {
		return ErrWebhookNotConfigured
	}
	webhookURL, err := service.secrets.Decrypt(target.WebhookURLCiphertext)
	if err != nil {
		return fmt.Errorf("decrypt Feishu webhook: %w", err)
	}
	return service.feishu.SendWebhook(ctx, webhookURL, "AI 代码扫描平台：飞书 Webhook 测试成功。")
}

func (service *Service) NotifyCompletion(ctx context.Context, task scan.Task) error {
	if task.ActorID == nil || task.ActorType != scan.ActorUser {
		return nil
	}
	target, err := service.repository.TargetForUser(ctx, *task.ActorID)
	if err != nil {
		return fmt.Errorf("load scan notification target: %w", err)
	}
	message := completionMessage(task, service.frontend)
	errorsFound := make([]error, 0, 2)
	if target.ApplicationEnabled {
		applicationClient := service.feishu
		if service.applicationClientProvider != nil {
			applicationClient, err = service.applicationClientProvider(ctx)
		}
		if err == nil {
			err = applicationClient.SendToEmail(ctx, target.Email, message)
		}
		if err != nil {
			errorsFound = append(errorsFound, fmt.Errorf("send application message: %w", err))
		}
	}
	if target.WebhookEnabled && target.WebhookURLCiphertext != "" {
		webhookURL, err := service.secrets.Decrypt(target.WebhookURLCiphertext)
		if err == nil {
			err = service.feishu.SendWebhook(ctx, webhookURL, message)
		}
		if err != nil {
			errorsFound = append(errorsFound, fmt.Errorf("send webhook message: %w", err))
		}
	}
	return errors.Join(errorsFound...)
}

func completionMessage(task scan.Task, frontendURL string) string {
	status := map[scan.Status]string{
		scan.StatusCompleted: "已完成",
		scan.StatusPartial:   "部分完成",
		scan.StatusFailed:    "执行失败",
	}[task.Status]
	message := fmt.Sprintf("AI 代码扫描任务%s\n项目：%s\n任务 ID：%s\n发现问题：%d\n消耗 Credit：%d", status, task.ProjectName, task.ID, task.FindingCount, task.ChargedCredits)
	if frontendURL != "" {
		message += "\n查看平台：" + frontendURL
	}
	return message
}
