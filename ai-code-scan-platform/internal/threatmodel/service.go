package threatmodel

import (
	"context"
	"crypto/rand"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"ai-code-scan-platform/internal/auth"
	"ai-code-scan-platform/internal/scan"
)

type ScanReader interface {
	GetByActor(context.Context, string, string) (scan.Task, error)
	GetDetail(context.Context, string) (scan.TaskDetail, error)
}

type Service struct {
	repository Repository
	scans      ScanReader
	analyzer   *Analyzer
	now        func() time.Time
}

func NewService(repository Repository, scans ScanReader, analyzer *Analyzer) *Service {
	return &Service{repository: repository, scans: scans, analyzer: analyzer, now: time.Now}
}

func (service *Service) Create(ctx context.Context, input CreateModelInput) (Model, error) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return Model{}, fmt.Errorf("authenticated user is required")
	}
	input.Title = strings.TrimSpace(input.Title)
	input.Configuration = normalizeConfiguration(input.Configuration)
	if err := validateCreateInput(input); err != nil {
		return Model{}, err
	}
	if input.Configuration.SourceScanTaskID != "" {
		if service.scans == nil {
			return Model{}, fmt.Errorf("scan source provider is not configured")
		}
		task, err := service.scans.GetByActor(ctx, input.Configuration.SourceScanTaskID, user.ID)
		if err != nil {
			return Model{}, fmt.Errorf("load source scan: %w", err)
		}
		if task.Status != scan.StatusCompleted && task.Status != scan.StatusPartial {
			return Model{}, fmt.Errorf("source scan must be completed before threat modeling")
		}
	}
	id, err := newUUID()
	if err != nil {
		return Model{}, err
	}
	model := Model{ID: id, ActorID: user.ID, Title: input.Title, Status: ModelDraft, Configuration: input.Configuration, Runs: []RunSummary{}}
	if err := service.repository.CreateModel(ctx, model); err != nil {
		return Model{}, err
	}
	return service.repository.GetModel(ctx, id, user.ID)
}

func (service *Service) List(ctx context.Context) ([]Model, error) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, fmt.Errorf("authenticated user is required")
	}
	return service.repository.ListModels(ctx, user.ID)
}

func (service *Service) Get(ctx context.Context, id string) (Model, error) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return Model{}, fmt.Errorf("authenticated user is required")
	}
	return service.repository.GetModel(ctx, strings.TrimSpace(id), user.ID)
}

func (service *Service) StartRun(ctx context.Context, modelID string) (Model, error) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return Model{}, fmt.Errorf("authenticated user is required")
	}
	model, err := service.repository.GetModel(ctx, strings.TrimSpace(modelID), user.ID)
	if err != nil {
		return Model{}, err
	}
	files, err := service.sourceFiles(ctx, user.ID, model.Configuration)
	if err != nil {
		return Model{}, err
	}
	runID, err := newUUID()
	if err != nil {
		return Model{}, err
	}
	startedAt := service.now().UTC()
	run := Run{ID: runID, ModelID: model.ID, Status: RunRunning, Stage: "输入预检", Progress: 5, StatusMessage: "正在固定输入并建立系统对象索引", Configuration: model.Configuration, StartedAt: startedAt}
	if err := service.repository.CreateRun(ctx, run); err != nil {
		return Model{}, err
	}
	result := service.analyzer.Analyze(model.Title, model.Configuration, files)
	if err := service.repository.CompleteRun(ctx, runID, result, service.now().UTC()); err != nil {
		_ = service.repository.FailRun(ctx, runID, "保存威胁模型结果失败", service.now().UTC())
		return Model{}, err
	}
	return service.repository.GetModel(ctx, model.ID, user.ID)
}

func (service *Service) UpdateThreat(ctx context.Context, modelID, threatID string, input UpdateThreatInput) (Model, error) {
	model, err := service.Get(ctx, modelID)
	if err != nil {
		return Model{}, err
	}
	if model.LatestRun == nil || model.LatestRun.Result == nil || model.LatestRun.Status != RunCompleted {
		return Model{}, fmt.Errorf("completed threat model run is required")
	}
	if input.Status != ThreatOpen && input.Status != ThreatResolved && input.Status != ThreatDismissed {
		return Model{}, fmt.Errorf("status must be open, resolved or dismissed")
	}
	found := false
	for index := range model.LatestRun.Result.Threats {
		threat := &model.LatestRun.Result.Threats[index]
		if threat.ID != threatID {
			continue
		}
		threat.Status = input.Status
		if input.Owner != nil {
			owner := strings.TrimSpace(*input.Owner)
			if len(owner) > 160 {
				return Model{}, fmt.Errorf("owner must not exceed 160 characters")
			}
			threat.Owner = owner
		}
		threat.UpdatedAt = service.now().UTC()
		found = true
		break
	}
	if !found {
		return Model{}, ErrNotFound
	}
	model.LatestRun.Result.Summary = summarize(*model.LatestRun.Result)
	if err := service.repository.UpdateRunResult(ctx, model.LatestRun.ID, *model.LatestRun.Result); err != nil {
		return Model{}, err
	}
	return service.Get(ctx, modelID)
}

func (service *Service) CreateThreat(ctx context.Context, modelID string, input CreateThreatInput) (Model, error) {
	model, err := service.Get(ctx, modelID)
	if err != nil {
		return Model{}, err
	}
	if model.LatestRun == nil || model.LatestRun.Result == nil || model.LatestRun.Status != RunCompleted {
		return Model{}, fmt.Errorf("completed threat model run is required")
	}
	input = normalizeThreatInput(input)
	if err := validateThreatInput(input); err != nil {
		return Model{}, err
	}
	id, err := newUUID()
	if err != nil {
		return Model{}, err
	}
	threat := Threat{
		ID: "TM-M-" + strings.ToUpper(strings.ReplaceAll(id[:8], "-", "")), Title: input.Title, Severity: input.Severity, Status: ThreatOpen,
		STRIDE: input.STRIDE, Statement: input.Statement, Source: input.Source, Action: input.Action, Impact: input.Impact,
		Prerequisites: input.Prerequisites, Assets: input.Assets, Goals: input.Goals, Evidence: []string{"人工评审记录"},
		Recommendation: input.Recommendation, Owner: "未分派", Confidence: "human", UpdatedAt: service.now().UTC(),
	}
	model.LatestRun.Result.Threats = append([]Threat{threat}, model.LatestRun.Result.Threats...)
	model.LatestRun.Result.Summary = summarize(*model.LatestRun.Result)
	if err := service.repository.UpdateRunResult(ctx, model.LatestRun.ID, *model.LatestRun.Result); err != nil {
		return Model{}, err
	}
	return service.Get(ctx, modelID)
}

func (service *Service) sourceFiles(ctx context.Context, actorID string, configuration Configuration) ([]SourceFile, error) {
	if configuration.SourceScanTaskID == "" {
		return nil, nil
	}
	task, err := service.scans.GetByActor(ctx, configuration.SourceScanTaskID, actorID)
	if err != nil {
		return nil, fmt.Errorf("load source scan: %w", err)
	}
	if task.Status != scan.StatusCompleted && task.Status != scan.StatusPartial {
		return nil, fmt.Errorf("source scan must be completed before threat modeling")
	}
	detail, err := service.scans.GetDetail(ctx, configuration.SourceScanTaskID)
	if err != nil {
		return nil, fmt.Errorf("load source scan evidence: %w", err)
	}
	files := make([]SourceFile, 0, len(detail.SourceSnapshot.Files)+1)
	totalBytes := 0
	for _, file := range detail.SourceSnapshot.Files {
		content := file.Content
		if len(content) > 512*1024 {
			content = content[:512*1024]
		}
		totalBytes += len(content)
		if totalBytes > 8*1024*1024 {
			break
		}
		files = append(files, SourceFile{Path: file.Path, Content: content})
	}
	if strings.TrimSpace(detail.SourceSnapshot.Diff) != "" && totalBytes < 8*1024*1024 {
		files = append(files, SourceFile{Path: "scan/git-diff.patch", Content: detail.SourceSnapshot.Diff})
	}
	return files, nil
}

func normalizeConfiguration(configuration Configuration) Configuration {
	configuration.SourceScanTaskID = strings.TrimSpace(configuration.SourceScanTaskID)
	configuration.ScopeSummary = strings.TrimSpace(configuration.ScopeSummary)
	configuration.Environment = strings.TrimSpace(configuration.Environment)
	configuration.Mode = strings.TrimSpace(configuration.Mode)
	if configuration.Environment == "" {
		configuration.Environment = "production"
	}
	if configuration.Mode == "" {
		configuration.Mode = "baseline"
	}
	documents := make([]Document, 0, len(configuration.ScopeDocuments))
	for _, document := range configuration.ScopeDocuments {
		document.Name = filepath.Base(strings.TrimSpace(document.Name))
		document.Content = strings.TrimSpace(document.Content)
		if document.Name != "" && document.Content != "" {
			documents = append(documents, document)
		}
	}
	configuration.ScopeDocuments = documents
	return configuration
}

func validateCreateInput(input CreateModelInput) error {
	if input.Title == "" || len(input.Title) > 200 {
		return fmt.Errorf("title must be between 1 and 200 characters")
	}
	if input.Configuration.SourceScanTaskID == "" && len(input.Configuration.ScopeDocuments) == 0 && input.Configuration.ScopeSummary == "" {
		return fmt.Errorf("source scan or scope document is required")
	}
	if len(input.Configuration.ScopeDocuments) > 20 {
		return fmt.Errorf("scopeDocuments must contain at most 20 documents")
	}
	total := len(input.Configuration.ScopeSummary)
	for _, document := range input.Configuration.ScopeDocuments {
		if len(document.Name) > 255 || len(document.Content) > 2*1024*1024 {
			return fmt.Errorf("each scope document must be at most 2 MiB")
		}
		total += len(document.Content)
	}
	if total > 8*1024*1024 {
		return fmt.Errorf("scope document content must not exceed 8 MiB")
	}
	if input.Configuration.Environment != "production" && input.Configuration.Environment != "staging" && input.Configuration.Environment != "development" {
		return fmt.Errorf("environment must be production, staging or development")
	}
	if input.Configuration.Mode != "baseline" && input.Configuration.Mode != "incremental" {
		return fmt.Errorf("mode must be baseline or incremental")
	}
	return nil
}

func normalizeThreatInput(input CreateThreatInput) CreateThreatInput {
	input.Title = strings.TrimSpace(input.Title)
	input.Statement = strings.TrimSpace(input.Statement)
	input.Source = strings.TrimSpace(input.Source)
	input.Action = strings.TrimSpace(input.Action)
	input.Impact = strings.TrimSpace(input.Impact)
	input.Recommendation = strings.TrimSpace(input.Recommendation)
	return input
}

func validateThreatInput(input CreateThreatInput) error {
	if input.Title == "" || len(input.Title) > 240 || input.Statement == "" || input.Recommendation == "" {
		return fmt.Errorf("title, statement and recommendation are required")
	}
	if input.Severity != SeverityCritical && input.Severity != SeverityHigh && input.Severity != SeverityMedium && input.Severity != SeverityLow {
		return fmt.Errorf("unsupported severity")
	}
	allowed := map[string]bool{"S": true, "T": true, "R": true, "I": true, "D": true, "E": true}
	if len(input.STRIDE) == 0 {
		return fmt.Errorf("at least one STRIDE category is required")
	}
	for _, category := range input.STRIDE {
		if !allowed[category] {
			return fmt.Errorf("unsupported STRIDE category %q", category)
		}
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
