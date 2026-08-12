package scan

import (
	"ai-code-scan-platform/internal/reportjson"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"ai-code-scan-platform/internal/auth"
)

type Repository interface {
	Create(context.Context, Task) (Task, error)
	CreatePlatformAtomic(context.Context, Task) (Task, error)
	Get(context.Context, string) (Task, error)
	GetPlatform(context.Context, string) (Task, error)
	GetByActor(context.Context, string, string) (Task, error)
	DeleteByActor(context.Context, string, string) error
	GetDetail(context.Context, string) (TaskDetail, error)
	List(context.Context, int, int) ([]Task, error)
	ListByActor(context.Context, string, int, int) ([]Task, error)
	ListPlatform(context.Context, int, int) ([]Task, error)
	ListPlugin(context.Context, int, int) ([]Task, error)
	ListCompletedBetween(context.Context, *string, time.Time, time.Time) ([]time.Time, error)
	GetRiskDistribution(context.Context, *string) (RiskDistribution, error)
	GetAITokenUsage(context.Context, *string) (AITokenTotals, error)
	Update(context.Context, string, UpdateTaskInput) (Task, error)
	SaveReport(context.Context, string, UploadReportInput) (Task, error)
	GetRepositoryCredentialCiphertext(context.Context, string) (string, error)
	GetSourceArchive(context.Context, string) ([]byte, string, error)
}

type SecretCipher interface {
	Encrypt(string) (string, error)
	Decrypt(string) (string, error)
}

type RepositoryAccessVerifier interface {
	Verify(context.Context, string, string, string) error
	ListBranches(context.Context, string, string) ([]string, error)
}

type Service struct {
	repository     Repository
	models         ModelResolver
	secrets        SecretCipher
	accessVerifier RepositoryAccessVerifier
	notifier       CompletionNotifier
	now            func() time.Time
}

type CompletionNotifier interface {
	NotifyCompletion(context.Context, Task) error
}

type ModelResolver interface {
	ResolveModelID(context.Context, string) (string, error)
}

const beijingTimezoneOffsetMinutes = 8 * 60

func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: time.Now}
}

func (service *Service) WithModelResolver(models ModelResolver) *Service {
	service.models = models
	return service
}

func (service *Service) WithSecretCipher(secrets SecretCipher) *Service {
	service.secrets = secrets
	return service
}

func (service *Service) WithRepositoryAccessVerifier(verifier RepositoryAccessVerifier) *Service {
	service.accessVerifier = verifier
	return service
}

func (service *Service) WithCompletionNotifier(notifier CompletionNotifier) *Service {
	service.notifier = notifier
	return service
}

func (service *Service) ListRepositoryBranches(ctx context.Context, repositoryURL, repositoryToken string) ([]string, error) {
	if _, ok := auth.UserFromContext(ctx); !ok {
		return nil, fmt.Errorf("authenticated user is required")
	}
	repositoryURL = strings.TrimSpace(repositoryURL)
	repositoryToken = strings.TrimSpace(repositoryToken)
	if err := validateRepositoryURL(repositoryURL); err != nil {
		return nil, err
	}
	if len(repositoryToken) > 4096 {
		return nil, fmt.Errorf("repositoryToken must not exceed 4096 bytes")
	}
	if repositoryToken != "" && !strings.HasPrefix(repositoryURL, "https://") {
		return nil, fmt.Errorf("repositoryToken requires an HTTPS repositoryUrl")
	}
	if service.accessVerifier == nil {
		return nil, fmt.Errorf("repository access verification is not configured")
	}
	return service.accessVerifier.ListBranches(ctx, repositoryURL, repositoryToken)
}

func (service *Service) CreatePlatform(ctx context.Context, input CreateTaskInput) (Task, error) {
	return service.createPlatform(ctx, input, nil)
}

func (service *Service) CreatePlatformArchive(ctx context.Context, input CreateTaskInput, filename string, archive []byte) (Task, error) {
	if len(archive) == 0 || len(archive) > 64*1024*1024 {
		return Task{}, fmt.Errorf("ZIP archive must be between 1 byte and 64 MiB")
	}
	filename = path.Base(strings.TrimSpace(filename))
	if !strings.HasSuffix(strings.ToLower(filename), ".zip") {
		return Task{}, fmt.Errorf("source archive must be a ZIP file")
	}
	input.RepositoryURL = "archive://upload/" + url.PathEscape(filename)
	input.GitRef = "uploaded"
	return service.createPlatform(ctx, input, archive)
}

func (service *Service) createPlatform(ctx context.Context, input CreateTaskInput, archive []byte) (Task, error) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return Task{}, fmt.Errorf("authenticated user is required")
	}
	if err := validateBillingInput(input); err != nil {
		return Task{}, err
	}
	input, err := service.resolveTaskModel(ctx, input)
	if err != nil {
		return Task{}, err
	}
	task, err := service.newTask(input, SourcePlatform, ActorUser, &user.ID, BillingCredit, estimateCredits(input))
	if err != nil {
		return Task{}, err
	}
	task.CreatorName = user.Name
	task.CreatorEmployeeNo = user.EmployeeNo
	task.sourceArchive = archive
	if len(archive) > 0 {
		return service.repository.CreatePlatformAtomic(ctx, task)
	}
	if service.accessVerifier == nil {
		return Task{}, fmt.Errorf("repository access verification is not configured")
	}
	repositoryToken := strings.TrimSpace(input.RepositoryToken)
	if repositoryToken != "" && service.secrets == nil {
		return Task{}, fmt.Errorf("repository credential encryption is not configured")
	}
	if err := service.accessVerifier.Verify(ctx, task.RepositoryURL, task.GitRef, repositoryToken); err != nil {
		return Task{}, fmt.Errorf("verify repository access: %w", err)
	}
	if repositoryToken != "" {
		task.repositoryTokenCiphertext, err = service.secrets.Encrypt(repositoryToken)
		if err != nil {
			return Task{}, fmt.Errorf("encrypt repository token: %w", err)
		}
	}
	return service.repository.CreatePlatformAtomic(ctx, task)
}

func (service *Service) RescanForUser(ctx context.Context, id string) (Task, error) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return Task{}, fmt.Errorf("authenticated user is required")
	}
	original, err := service.GetForUser(ctx, id)
	if err != nil {
		return Task{}, err
	}
	input := CreateTaskInput{
		ProjectName: original.ProjectName, ProductID: original.ScanConfiguration.ProductID, ProductName: original.ScanConfiguration.ProductName,
		RepositoryURL: original.RepositoryURL, GitRef: original.GitRef,
		SkillSourceID: original.SkillSourceID, AIModelID: original.ScanConfiguration.AIModelID,
		Mode: original.ScanConfiguration.Mode, ScanLevel: original.ScanConfiguration.ScanLevel, Priority: original.ScanConfiguration.Priority,
		ExcludeDirectories: original.ScanConfiguration.ExcludeDirectories, ExcludePatterns: original.ScanConfiguration.ExcludePatterns,
		ScanDirectories: original.ScanConfiguration.ScanDirectories, VulnerabilityTypes: original.ScanConfiguration.VulnerabilityTypes,
	}
	input.AIEnabled = &original.ScanConfiguration.AIEnabled
	if strings.HasPrefix(original.RepositoryURL, "archive://") {
		archive, _, archiveErr := service.repository.GetSourceArchive(ctx, original.ID)
		if archiveErr != nil {
			return Task{}, fmt.Errorf("copy source archive: %w", archiveErr)
		}
		task, taskErr := service.newTask(input, SourcePlatform, ActorUser, &user.ID, BillingCredit, original.EstimatedCredits)
		if taskErr != nil {
			return Task{}, taskErr
		}
		task.CreatorName, task.CreatorEmployeeNo, task.sourceArchive = user.Name, user.EmployeeNo, archive
		return service.repository.CreatePlatformAtomic(ctx, task)
	}
	task, err := service.newTask(input, SourcePlatform, ActorUser, &user.ID, BillingCredit, original.EstimatedCredits)
	if err != nil {
		return Task{}, err
	}
	task.CreatorName = user.Name
	task.CreatorEmployeeNo = user.EmployeeNo
	ciphertext, credentialErr := service.repository.GetRepositoryCredentialCiphertext(ctx, original.ID)
	if credentialErr != nil && !errors.Is(credentialErr, sql.ErrNoRows) {
		return Task{}, fmt.Errorf("copy repository credential: %w", credentialErr)
	}
	task.repositoryTokenCiphertext = ciphertext
	return service.repository.CreatePlatformAtomic(ctx, task)
}

func (service *Service) GetRepositoryCredential(ctx context.Context, id string) (RepositoryCredential, error) {
	if service.secrets == nil {
		return RepositoryCredential{}, fmt.Errorf("repository credential encryption is not configured")
	}
	ciphertext, err := service.repository.GetRepositoryCredentialCiphertext(ctx, strings.TrimSpace(id))
	if err != nil {
		return RepositoryCredential{}, err
	}
	token, err := service.secrets.Decrypt(ciphertext)
	if err != nil {
		return RepositoryCredential{}, fmt.Errorf("decrypt repository token: %w", err)
	}
	encoded := basicRepositoryToken(token)
	return RepositoryCredential{AuthorizationHeader: "Basic " + encoded}, nil
}

func (service *Service) GetSourceArchive(ctx context.Context, id string) ([]byte, string, error) {
	return service.repository.GetSourceArchive(ctx, strings.TrimSpace(id))
}

func basicRepositoryToken(token string) string {
	return base64.StdEncoding.EncodeToString([]byte("oauth2:" + token))
}

func validateBillingInput(input CreateTaskInput) error {
	if input.EstimatedLines < 0 || input.EstimatedLines > 100_000_000 {
		return fmt.Errorf("estimatedLines must be between 0 and 100000000")
	}
	if input.Mode != "" && input.Mode != ScanModeStandard && input.Mode != ScanModeDeep {
		return fmt.Errorf("mode must be standard or deep")
	}
	if input.ScanLevel != "" && input.ScanLevel != ScanLevelLite && input.ScanLevel != ScanLevelStandard && input.ScanLevel != ScanLevelRelease {
		return fmt.Errorf("scanLevel must be lite, standard or release")
	}
	if input.ScanLevel != "" && input.Mode != "" {
		if input.ScanLevel == ScanLevelRelease && input.Mode != ScanModeDeep {
			return fmt.Errorf("release scan level requires deep mode")
		}
		if input.ScanLevel != ScanLevelRelease && input.Mode != ScanModeStandard {
			return fmt.Errorf("lite and standard scan levels require standard mode")
		}
	}
	if input.Priority != "" && input.Priority != PriorityNormal && input.Priority != PriorityUrgent {
		return fmt.Errorf("priority must be normal or urgent")
	}
	if err := validatePathRules(input.ExcludeDirectories, input.ExcludePatterns, input.ScanDirectories); err != nil {
		return err
	}
	if len(input.VulnerabilityTypes) > 64 {
		return fmt.Errorf("vulnerabilityTypes must contain at most 64 items")
	}
	return nil
}

func (service *Service) resolveTaskModel(ctx context.Context, input CreateTaskInput) (CreateTaskInput, error) {
	aiEnabled := input.AIEnabled == nil || *input.AIEnabled
	if !aiEnabled {
		input.AIModelID = ""
		return input, nil
	}
	if service.models == nil {
		return input, nil
	}
	modelID, err := service.models.ResolveModelID(ctx, input.AIModelID)
	if err != nil {
		return CreateTaskInput{}, fmt.Errorf("resolve scan model: %w", err)
	}
	input.AIModelID = modelID
	return input, nil
}

func validatePathRules(groups ...[]string) error {
	for _, values := range groups {
		if len(values) > 128 {
			return fmt.Errorf("scan path rule groups must contain at most 128 items")
		}
		for _, value := range values {
			trimmed := strings.TrimSpace(value)
			if trimmed == "" || len(trimmed) > 255 || strings.HasPrefix(trimmed, "/") || strings.Contains(trimmed, "..") {
				return fmt.Errorf("scan path rules must be non-empty relative paths or patterns")
			}
		}
	}
	return nil
}

func (service *Service) CreatePlugin(ctx context.Context, input CreateTaskInput) (Task, error) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return Task{}, fmt.Errorf("authenticated user is required")
	}
	if err := validateBillingInput(input); err != nil {
		return Task{}, err
	}
	input, err := service.resolveTaskModel(ctx, input)
	if err != nil {
		return Task{}, err
	}
	task, err := service.newTask(input, SourcePlugin, ActorUser, &user.ID, BillingCredit, estimateCredits(input))
	if err != nil {
		return Task{}, err
	}
	return service.repository.CreatePlatformAtomic(ctx, task)
}

func (service *Service) UpdateForUser(ctx context.Context, id string, input UpdateTaskInput) (Task, error) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return Task{}, fmt.Errorf("authenticated user is required")
	}
	if _, err := service.repository.GetByActor(ctx, id, user.ID); err != nil {
		return Task{}, err
	}
	return service.Update(ctx, id, input)
}

func (service *Service) UploadReportForUser(ctx context.Context, id string, input UploadReportInput) (Task, error) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return Task{}, fmt.Errorf("authenticated user is required")
	}
	task, err := service.repository.GetByActor(ctx, id, user.ID)
	if err != nil {
		return Task{}, err
	}
	if task.Source != SourcePlugin {
		return Task{}, fmt.Errorf("only plugin scans accept user report uploads")
	}
	return service.UploadReport(ctx, id, input)
}

func (service *Service) newTask(input CreateTaskInput, source Source, actorType ActorType, actorID *string, billingMode BillingMode, estimatedCredits int) (Task, error) {
	input.ProjectName = strings.TrimSpace(input.ProjectName)
	input.RepositoryURL = strings.TrimSpace(input.RepositoryURL)
	input.GitRef = strings.TrimSpace(input.GitRef)
	input.RepositoryToken = strings.TrimSpace(input.RepositoryToken)
	if input.ProjectName == "" || input.RepositoryURL == "" || input.GitRef == "" {
		return Task{}, fmt.Errorf("projectName, repositoryUrl and gitRef are required")
	}
	if err := validateRepositoryURL(input.RepositoryURL); err != nil {
		return Task{}, err
	}
	if len(input.RepositoryToken) > 4096 {
		return Task{}, fmt.Errorf("repositoryToken must not exceed 4096 bytes")
	}
	if input.RepositoryToken != "" && !strings.HasPrefix(input.RepositoryURL, "https://") {
		return Task{}, fmt.Errorf("repositoryToken requires an HTTPS repositoryUrl")
	}
	if input.SkillSourceID != nil && *input.SkillSourceID <= 0 {
		return Task{}, fmt.Errorf("skillSourceId must be a positive integer")
	}

	id, err := newUUID()
	if err != nil {
		return Task{}, fmt.Errorf("generate scan task id: %w", err)
	}
	return Task{
		ID: id, ProjectName: input.ProjectName, RepositoryURL: input.RepositoryURL,
		GitRef: input.GitRef, SkillSourceID: input.SkillSourceID, Status: StatusQueued,
		Source: source, ActorType: actorType, ActorID: actorID, BillingMode: billingMode,
		EstimatedCredits:  estimatedCredits,
		ScanConfiguration: normalizedScanConfiguration(input),
		Stage:             "等待扫描", Progress: 0, StatusMessage: "扫描任务已创建",
	}, nil
}

func normalizedScanConfiguration(input CreateTaskInput) ScanConfiguration {
	mode := input.Mode
	if mode == "" {
		if input.ScanLevel == ScanLevelLite || input.ScanLevel == ScanLevelStandard {
			mode = ScanModeStandard
		} else {
			mode = ScanModeDeep
		}
	}
	scanLevel := input.ScanLevel
	if scanLevel == "" {
		if mode == ScanModeDeep {
			scanLevel = ScanLevelRelease
		} else {
			scanLevel = ScanLevelStandard
		}
	}
	priority := input.Priority
	if priority == "" {
		priority = PriorityNormal
	}
	normalize := func(values []string) []string {
		result := make([]string, 0, len(values))
		seen := make(map[string]bool, len(values))
		for _, value := range values {
			value = strings.Trim(strings.ReplaceAll(strings.TrimSpace(value), "\\", "/"), "/")
			if value != "" && !seen[value] {
				seen[value] = true
				result = append(result, value)
			}
		}
		return result
	}
	aiEnabled := input.AIEnabled == nil || *input.AIEnabled
	return ScanConfiguration{
		ProductID: strings.TrimSpace(input.ProductID), ProductName: strings.TrimSpace(input.ProductName),
		Mode: mode, ScanLevel: scanLevel, Priority: priority, AIEnabled: aiEnabled, AIModelID: strings.TrimSpace(input.AIModelID),
		ExcludeDirectories: normalize(input.ExcludeDirectories),
		ExcludePatterns:    normalize(input.ExcludePatterns),
		ScanDirectories:    normalize(input.ScanDirectories),
		VulnerabilityTypes: normalize(input.VulnerabilityTypes),
	}
}

func estimateCredits(input CreateTaskInput) int {
	lines := input.EstimatedLines
	if lines <= 0 {
		lines = 10000
	}
	mode := input.Mode
	if mode == "" {
		mode = ScanModeDeep
	}
	priority := input.Priority
	if priority == "" {
		priority = PriorityNormal
	}
	aiEnabled := input.AIEnabled == nil || *input.AIEnabled
	premiumModel := input.PremiumModel == nil || *input.PremiumModel

	subtotal := 20 + ((lines+999)/1000)*2
	if aiEnabled {
		subtotal += 18
		if premiumModel {
			subtotal += 25
		}
	}
	numerator, denominator := 1, 1
	if mode == ScanModeDeep {
		numerator, denominator = numerator*16, denominator*10
	}
	if priority == PriorityUrgent {
		numerator, denominator = numerator*15, denominator*10
	}
	return (subtotal*numerator + denominator - 1) / denominator
}

func (service *Service) Get(ctx context.Context, id string) (Task, error) {
	if strings.TrimSpace(id) == "" {
		return Task{}, fmt.Errorf("scan task id is required")
	}
	return service.repository.Get(ctx, id)
}

func (service *Service) GetForUser(ctx context.Context, id string) (Task, error) {
	if strings.TrimSpace(id) == "" {
		return Task{}, fmt.Errorf("scan task id is required")
	}
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return Task{}, fmt.Errorf("authenticated user is required")
	}
	if user.Role == "admin" {
		return service.repository.Get(ctx, id)
	}
	return service.repository.GetByActor(ctx, id, user.ID)
}

func (service *Service) DeleteForUser(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("scan task id is required")
	}
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return fmt.Errorf("authenticated user is required")
	}
	return service.repository.DeleteByActor(ctx, id, user.ID)
}

func (service *Service) GetDetailForUser(ctx context.Context, id string) (TaskDetail, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return TaskDetail{}, fmt.Errorf("scan task id is required")
	}
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return TaskDetail{}, fmt.Errorf("authenticated user is required")
	}
	if user.Role != "admin" {
		if _, err := service.repository.GetByActor(ctx, id, user.ID); err != nil {
			return TaskDetail{}, err
		}
	}
	return service.repository.GetDetail(ctx, id)
}

func (service *Service) ListForUser(ctx context.Context, limit, offset int) ([]Task, error) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, fmt.Errorf("authenticated user is required")
	}
	if user.Role == "admin" {
		return service.repository.List(ctx, limit, offset)
	}
	return service.repository.ListByActor(ctx, user.ID, limit, offset)
}

func (service *Service) ListPlugin(ctx context.Context, limit, offset int) ([]Task, error) {
	return service.repository.ListPlugin(ctx, limit, offset)
}

func (service *Service) StatisticsForUser(ctx context.Context, _ int) (Statistics, error) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return Statistics{}, fmt.Errorf("authenticated user is required")
	}

	location := time.FixedZone("Asia/Shanghai", beijingTimezoneOffsetMinutes*60)
	now := service.now().In(location)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
	periodStart := today.AddDate(0, 0, -13)
	periodEnd := today.AddDate(0, 0, 1)
	var actorID *string
	if user.Role != "admin" {
		actorID = &user.ID
	}
	completedAt, err := service.repository.ListCompletedBetween(ctx, actorID, periodStart.UTC(), periodEnd.UTC())
	if err != nil {
		return Statistics{}, err
	}
	distribution, err := service.repository.GetRiskDistribution(ctx, actorID)
	if err != nil {
		return Statistics{}, err
	}
	tokenUsage, err := service.repository.GetAITokenUsage(ctx, actorID)
	if err != nil {
		return Statistics{}, err
	}

	counts := make(map[string]int, 14)
	for _, completed := range completedAt {
		counts[completed.In(location).Format("2006-01-02")]++
	}
	statistics := Statistics{RiskDistribution: distribution, AITokenUsage: tokenUsage, Trend: make([]DailyScanCount, 0, 7)}
	for dayOffset := -13; dayOffset <= 0; dayOffset++ {
		date := today.AddDate(0, 0, dayOffset).Format("2006-01-02")
		count := counts[date]
		if dayOffset < -6 {
			statistics.PreviousPeriodCompleted += count
			continue
		}
		statistics.CurrentPeriodCompleted += count
		statistics.Trend = append(statistics.Trend, DailyScanCount{Date: date, Completed: count})
	}
	if statistics.PreviousPeriodCompleted > 0 {
		change := float64(statistics.CurrentPeriodCompleted-statistics.PreviousPeriodCompleted) / float64(statistics.PreviousPeriodCompleted) * 100
		statistics.ChangePercent = &change
	} else if statistics.CurrentPeriodCompleted == 0 {
		change := float64(0)
		statistics.ChangePercent = &change
	}
	return statistics, nil
}

func (service *Service) Update(ctx context.Context, id string, input UpdateTaskInput) (Task, error) {
	id = strings.TrimSpace(id)
	input.Stage = strings.TrimSpace(input.Stage)
	input.StatusMessage = strings.TrimSpace(input.StatusMessage)
	if id == "" || input.Stage == "" || input.StatusMessage == "" {
		return Task{}, fmt.Errorf("scan task id, stage and statusMessage are required")
	}
	if len(input.Stage) > 160 || len(input.StatusMessage) > 500 {
		return Task{}, fmt.Errorf("stage or statusMessage is too long")
	}
	if input.Progress < 0 || input.Progress > 100 {
		return Task{}, fmt.Errorf("progress must be between 0 and 100")
	}
	current, err := service.repository.Get(ctx, id)
	if err != nil {
		return Task{}, err
	}
	if current.Status == input.Status && current.Stage == input.Stage && current.Progress == input.Progress && current.StatusMessage == input.StatusMessage {
		return current, nil
	}
	if !validTransition(current.Status, input.Status) {
		return Task{}, fmt.Errorf("invalid scan status transition from %s to %s", current.Status, input.Status)
	}
	if input.Progress < current.Progress {
		return Task{}, fmt.Errorf("scan progress must not decrease")
	}
	if input.Status == StatusCompleted {
		input.Progress = 100
	}
	updated, err := service.repository.Update(ctx, id, input)
	if err != nil {
		return Task{}, err
	}
	if service.notifier != nil && current.Status != input.Status && isNotificationStatus(input.Status) {
		if err := service.notifier.NotifyCompletion(ctx, updated); err != nil {
			log.Printf("send scan completion notification for %s: %v", updated.ID, err)
		}
	}
	return updated, nil
}

func isNotificationStatus(status Status) bool {
	return status == StatusCompleted || status == StatusPartial || status == StatusFailed
}

func (service *Service) UploadReport(ctx context.Context, id string, input UploadReportInput) (Task, error) {
	id = strings.TrimSpace(id)
	input.SchemaVersion = strings.TrimSpace(input.SchemaVersion)
	input.ReportID = strings.TrimSpace(input.ReportID)
	input.GeneratedAt = strings.TrimSpace(input.GeneratedAt)
	input.WorkspaceLabel = strings.TrimSpace(input.WorkspaceLabel)
	if id == "" || input.SchemaVersion == "" || input.ReportID == "" || input.GeneratedAt == "" || input.WorkspaceLabel == "" || strings.TrimSpace(input.ReportJSON) == "" {
		return Task{}, fmt.Errorf("complete report metadata and reportJson are required")
	}
	if len(input.ReportJSON) > 8*1024*1024 {
		return Task{}, fmt.Errorf("reportJson exceeds 8 MiB")
	}
	if input.SchemaVersion != "2.0" {
		return Task{}, fmt.Errorf("schemaVersion must be 2.0")
	}
	if err := reportjson.Validate(input.ReportJSON); err != nil {
		return Task{}, fmt.Errorf("invalid reportJson: %w", err)
	}
	if input.AITokenUsage.TotalTokens != input.AITokenUsage.InputTokens+input.AITokenUsage.OutputTokens {
		return Task{}, fmt.Errorf("aiTokenUsage totalTokens must equal inputTokens plus outputTokens")
	}
	if !input.AITokenUsage.Estimated {
		return Task{}, fmt.Errorf("aiTokenUsage must be marked as estimated")
	}
	task, err := service.repository.Get(ctx, id)
	if err != nil {
		return Task{}, err
	}
	input.SourceSnapshot = filterSourceSnapshot(input.SourceSnapshot, task.ScanConfiguration)
	if err := validateUploadedSourceSnapshot(task.Source, input.SourceSnapshot); err != nil {
		return Task{}, err
	}
	statistics, err := reportStatistics(input)
	if err != nil {
		return Task{}, fmt.Errorf("summarize report: %w", err)
	}
	input.Statistics = statistics
	return service.repository.SaveReport(ctx, id, input)
}

func reportStatistics(input UploadReportInput) (ReportStatistics, error) {
	var report struct {
		Findings []json.RawMessage `json:"findings"`
		Coverage struct {
			Checked []string `json:"checked"`
		} `json:"coverage"`
	}
	if err := json.Unmarshal([]byte(input.ReportJSON), &report); err != nil {
		return ReportStatistics{}, err
	}
	statistics := ReportStatistics{ScannedFiles: len(report.Coverage.Checked), FindingCount: len(report.Findings)}
	for _, file := range input.SourceSnapshot.Files {
		if file.Content != "" {
			statistics.CodeLines += strings.Count(file.Content, "\n") + 1
		}
	}
	return statistics, nil
}

var scannableExtension = regexp.MustCompile(`(?i)\.(aspx?|bash|c|cc|cfg|cjs|clj|cljs|conf|cpp|cs|cshtml|css|cxx|dart|env|erl|ex|exs|fs|fsx|go|gql|gradle|graphql|groovy|h|hcl|hh|hpp|hrl|html?|ini|java|js|json|jsp|jsx|kt|kts|less|lock|lua|mjs|php|properties|proto|ps1|py|rb|rs|scala|scss|sh|sol|sql|svelte|swift|tf|tfvars|toml|ts|tsx|vue|xml|ya?ml|zsh)$`)

func isScannableSourcePath(candidate string) bool {
	candidate = strings.Trim(strings.ReplaceAll(candidate, "\\", "/"), "/")
	if candidate == "" {
		return false
	}
	for _, segment := range strings.Split(strings.ToLower(candidate), "/") {
		switch segment {
		case ".git", ".idea", ".next", ".nuxt", ".svn", ".vscode", "build", "coverage", "dist", "generated", "node_modules", "out", "target", "vendor":
			return false
		}
	}
	base := strings.ToLower(path.Base(candidate))
	if strings.HasPrefix(base, "dockerfile") || strings.HasPrefix(base, ".env") || strings.HasPrefix(base, "requirements") && strings.HasSuffix(base, ".txt") || strings.HasPrefix(base, "tsconfig") && strings.HasSuffix(base, ".json") {
		return true
	}
	switch base {
	case "cargo.lock", "cargo.toml", "composer.json", "composer.lock", "gemfile", "go.mod", "go.sum", "jenkinsfile", "makefile", "package-lock.json", "package.json", "pnpm-lock.yaml", "pom.xml", "pyproject.toml", "rakefile", "yarn.lock":
		return true
	}
	return scannableExtension.MatchString(base)
}

func scanPathAllowed(candidate string, configuration ScanConfiguration) bool {
	candidate = strings.Trim(strings.ReplaceAll(candidate, "\\", "/"), "/")
	if !isScannableSourcePath(candidate) {
		return false
	}
	if len(configuration.ScanDirectories) > 0 {
		inside := false
		for _, directory := range configuration.ScanDirectories {
			if candidate == directory || strings.HasPrefix(candidate, strings.Trim(directory, "/")+"/") {
				inside = true
				break
			}
		}
		if !inside {
			return false
		}
	}
	for _, directory := range configuration.ExcludeDirectories {
		directory = strings.Trim(directory, "/")
		for _, segment := range strings.Split(candidate, "/") {
			if segment == directory {
				return false
			}
		}
		if candidate == directory || strings.HasPrefix(candidate, directory+"/") {
			return false
		}
	}
	for _, pattern := range configuration.ExcludePatterns {
		fullMatch, _ := path.Match(pattern, candidate)
		baseMatch, _ := path.Match(pattern, path.Base(candidate))
		if fullMatch || baseMatch {
			return false
		}
	}
	return true
}

func filterSourceSnapshot(snapshot SourceSnapshot, configuration ScanConfiguration) SourceSnapshot {
	files := make([]SourceSnapshotFile, 0, len(snapshot.Files))
	allowed := make(map[string]bool, len(snapshot.Files))
	for _, file := range snapshot.Files {
		file.Path = strings.Trim(strings.ReplaceAll(file.Path, "\\", "/"), "/")
		if scanPathAllowed(file.Path, configuration) {
			files = append(files, file)
			allowed[file.Path] = true
		}
	}
	statusLines := make([]string, 0)
	for _, line := range strings.Split(snapshot.GitStatus, "\n") {
		candidate := strings.TrimSpace(line)
		if len(candidate) > 2 {
			candidate = strings.TrimSpace(candidate[2:])
		}
		if arrow := strings.LastIndex(candidate, " -> "); arrow >= 0 {
			candidate = candidate[arrow+4:]
		}
		if allowed[candidate] {
			statusLines = append(statusLines, line)
		}
	}
	return SourceSnapshot{GitStatus: strings.Join(statusLines, "\n"), Diff: filterSnapshotDiff(snapshot.Diff, allowed), Files: files}
}

func filterSnapshotDiff(diff string, allowed map[string]bool) string {
	if strings.TrimSpace(diff) == "" {
		return ""
	}
	indices := regexp.MustCompile(`(?m)^diff --git `).FindAllStringIndex(diff, -1)
	kept := make([]string, 0, len(indices))
	for index, bounds := range indices {
		end := len(diff)
		if index+1 < len(indices) {
			end = indices[index+1][0]
		}
		section := diff[bounds[0]:end]
		firstLine := strings.SplitN(section, "\n", 2)[0]
		parts := strings.Split(firstLine, " b/")
		if len(parts) == 2 && allowed[strings.TrimSpace(parts[1])] {
			kept = append(kept, section)
		}
	}
	return strings.Join(kept, "")
}

func validateSourceSnapshot(snapshot SourceSnapshot) error {
	if strings.TrimSpace(snapshot.GitStatus) == "" || len(snapshot.Files) == 0 {
		return fmt.Errorf("sourceSnapshot gitStatus and files are required")
	}
	totalSize := len(snapshot.GitStatus) + len(snapshot.Diff)
	for _, file := range snapshot.Files {
		file.Path = strings.TrimSpace(file.Path)
		if file.Path == "" || strings.HasPrefix(file.Path, "/") || strings.Contains(file.Path, "..") {
			return fmt.Errorf("sourceSnapshot file paths must be relative workspace paths")
		}
		if file.Kind != "changed" && file.Kind != "test" && file.Kind != "config" && file.Kind != "evidence" {
			return fmt.Errorf("sourceSnapshot file kind must be changed, test, config or evidence")
		}
		totalSize += len(file.Path) + len(file.Kind) + len(file.Content)
	}
	if totalSize > 24*1024*1024 {
		return fmt.Errorf("sourceSnapshot exceeds 24 MiB")
	}
	return nil
}

func validateUploadedSourceSnapshot(source Source, snapshot SourceSnapshot) error {
	if source == SourcePlatform && strings.TrimSpace(snapshot.GitStatus) == "" && len(snapshot.Files) == 0 {
		return nil
	}
	return validateSourceSnapshot(snapshot)
}

func validTransition(from, to Status) bool {
	if from == to {
		return true
	}
	allowed := map[Status]map[Status]bool{
		StatusQueued:      {StatusCloning: true, StatusIndexing: true, StatusAnalyzing: true, StatusFailed: true, StatusCancelled: true},
		StatusCloning:     {StatusIndexing: true, StatusAnalyzing: true, StatusFailed: true, StatusCancelled: true},
		StatusIndexing:    {StatusAnalyzing: true, StatusFailed: true, StatusCancelled: true},
		StatusAnalyzing:   {StatusNormalizing: true, StatusCompleted: true, StatusPartial: true, StatusFailed: true, StatusCancelled: true},
		StatusNormalizing: {StatusCompleted: true, StatusPartial: true, StatusFailed: true, StatusCancelled: true},
	}
	return allowed[from][to]
}

func validateRepositoryURL(rawURL string) error {
	repositoryURL, err := url.Parse(rawURL)
	if err != nil || (repositoryURL.Hostname() == "" && repositoryURL.Scheme != "archive") {
		return fmt.Errorf("repositoryUrl must be a valid URL")
	}
	if repositoryURL.Scheme == "archive" && repositoryURL.Host == "upload" {
		return nil
	}
	if repositoryURL.Scheme != "https" && repositoryURL.Scheme != "ssh" {
		if repositoryURL.Scheme != "workspace" || repositoryURL.Hostname() != "local" {
			return fmt.Errorf("repositoryUrl must use HTTPS, SSH or workspace://local")
		}
	}
	if repositoryURL.User != nil && repositoryURL.User.Username() != "git" {
		return fmt.Errorf("repositoryUrl must not contain credentials")
	}
	return nil
}

func newUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}
