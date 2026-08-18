package threatmodel

import (
	"context"
	"errors"
	"testing"
	"time"

	"ai-code-scan-platform/internal/auth"
	"ai-code-scan-platform/internal/scan"
)

func TestServiceCreatesRunsAndTriagesRealScanEvidence(t *testing.T) {
	actorID := "user-1"
	repository := newMemoryRepository()
	scans := &fakeScanReader{
		task: scan.Task{ID: "scan-1", ActorID: &actorID, Status: scan.StatusCompleted},
		detail: scan.TaskDetail{SourceSnapshot: scan.SourceSnapshot{Files: []scan.SourceSnapshotFile{{
			Path: "api/orders.go", Content: `router.Get("/orders/{orderId}", authenticate(getOrder))`,
		}}}},
	}
	service := NewService(repository, scans, NewAnalyzer())
	ctx := auth.WithUser(context.Background(), auth.User{ID: actorID, Role: "user"})

	model, err := service.Create(ctx, CreateModelInput{Title: "订单 API", Configuration: Configuration{
		SourceScanTaskID: "scan-1", Environment: "production", Mode: "baseline",
		ScopeDocuments: []Document{{Name: "architecture.md", Content: "Orders are stored in MySQL."}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if model.Status != ModelDraft || model.ActorID != actorID || len(model.Runs) != 0 {
		t.Fatalf("unexpected created model: %#v", model)
	}

	model, err = service.StartRun(ctx, model.ID)
	if err != nil {
		t.Fatal(err)
	}
	if model.Status != ModelCompleted || model.LatestRun == nil || model.LatestRun.Result == nil {
		t.Fatalf("expected completed persisted run, got %#v", model)
	}
	if model.LatestRun.Result.Coverage.SourceFiles != 1 || len(model.LatestRun.Result.Threats) == 0 {
		t.Fatalf("expected scan evidence and threats, got %#v", model.LatestRun.Result)
	}

	threatID := model.LatestRun.Result.Threats[0].ID
	model, err = service.UpdateThreat(ctx, model.ID, threatID, UpdateThreatInput{Status: ThreatResolved})
	if err != nil {
		t.Fatal(err)
	}
	if model.LatestRun.Result.Threats[0].Status != ThreatResolved || model.LatestRun.Result.Summary.Open != len(model.LatestRun.Result.Threats)-1 {
		t.Fatalf("expected persisted triage and recalculated summary, got %#v", model.LatestRun.Result)
	}

	model, err = service.CreateThreat(ctx, model.ID, CreateThreatInput{
		Title: "业务状态可被重复推进", Severity: SeverityHigh, STRIDE: []string{"T"},
		Statement: "重复请求可能推进状态。", Source: "人工评审", Action: "重复提交", Impact: "状态异常",
		Prerequisites: []string{"可调用接口"}, Assets: []string{"订单状态"}, Goals: []string{"Integrity"}, Recommendation: "增加幂等键。",
	})
	if err != nil {
		t.Fatal(err)
	}
	if model.LatestRun.Result.Threats[0].Confidence != "human" || model.LatestRun.Result.Threats[0].Status != ThreatOpen {
		t.Fatalf("expected persisted human-created threat, got %#v", model.LatestRun.Result.Threats[0])
	}
}

func TestServiceRejectsAnotherUsersScan(t *testing.T) {
	repository := newMemoryRepository()
	scans := &fakeScanReader{getErr: errors.New("scan not found")}
	service := NewService(repository, scans, NewAnalyzer())
	ctx := auth.WithUser(context.Background(), auth.User{ID: "user-2", Role: "user"})

	_, err := service.Create(ctx, CreateModelInput{Title: "越权输入", Configuration: Configuration{
		SourceScanTaskID: "scan-owned-by-other-user", Environment: "production", Mode: "baseline",
	}})
	if err == nil {
		t.Fatal("expected inaccessible source scan to be rejected")
	}
	if len(repository.models) != 0 {
		t.Fatal("model must not be persisted when source ownership cannot be verified")
	}
}

type fakeScanReader struct {
	task   scan.Task
	detail scan.TaskDetail
	getErr error
}

func (reader *fakeScanReader) GetByActor(context.Context, string, string) (scan.Task, error) {
	if reader.getErr != nil {
		return scan.Task{}, reader.getErr
	}
	return reader.task, nil
}

func (reader *fakeScanReader) GetDetail(context.Context, string) (scan.TaskDetail, error) {
	return reader.detail, nil
}

type memoryRepository struct {
	models   map[string]Model
	runs     map[string]Run
	runOrder map[string][]string
}

func newMemoryRepository() *memoryRepository {
	return &memoryRepository{models: map[string]Model{}, runs: map[string]Run{}, runOrder: map[string][]string{}}
}

func (repository *memoryRepository) CreateModel(_ context.Context, model Model) error {
	now := time.Now().UTC()
	model.CreatedAt, model.UpdatedAt = now, now
	repository.models[model.ID] = model
	return nil
}

func (repository *memoryRepository) ListModels(_ context.Context, actorID string) ([]Model, error) {
	result := []Model{}
	for id, model := range repository.models {
		if model.ActorID == actorID {
			attached, _ := repository.GetModel(context.Background(), id, actorID)
			result = append(result, attached)
		}
	}
	return result, nil
}

func (repository *memoryRepository) GetModel(_ context.Context, id, actorID string) (Model, error) {
	model, ok := repository.models[id]
	if !ok || model.ActorID != actorID {
		return Model{}, ErrNotFound
	}
	model.Runs = []RunSummary{}
	for _, runID := range repository.runOrder[id] {
		run := repository.runs[runID]
		if model.LatestRun == nil {
			copy := run
			model.LatestRun = &copy
		}
		count := 0
		if run.Result != nil {
			count = len(run.Result.Threats)
		}
		model.Runs = append(model.Runs, RunSummary{ID: run.ID, Status: run.Status, Stage: run.Stage, Progress: run.Progress, StatusMessage: run.StatusMessage, ThreatCount: count, StartedAt: run.StartedAt, CompletedAt: run.CompletedAt})
	}
	return model, nil
}

func (repository *memoryRepository) CreateRun(_ context.Context, run Run) error {
	model, ok := repository.models[run.ModelID]
	if !ok {
		return ErrNotFound
	}
	if model.Status == ModelRunning {
		return ErrAlreadyRunning
	}
	model.Status = ModelRunning
	repository.models[run.ModelID] = model
	repository.runs[run.ID] = run
	repository.runOrder[run.ModelID] = append([]string{run.ID}, repository.runOrder[run.ModelID]...)
	return nil
}

func (repository *memoryRepository) CompleteRun(_ context.Context, runID string, result Result, completedAt time.Time) error {
	run, ok := repository.runs[runID]
	if !ok {
		return ErrNotFound
	}
	run.Status, run.Stage, run.Progress, run.StatusMessage = RunCompleted, "分析完成", 100, "威胁模型已生成"
	run.Result, run.CompletedAt = &result, &completedAt
	repository.runs[runID] = run
	model := repository.models[run.ModelID]
	model.Status = ModelCompleted
	repository.models[run.ModelID] = model
	return nil
}

func (repository *memoryRepository) FailRun(_ context.Context, runID, message string, completedAt time.Time) error {
	run, ok := repository.runs[runID]
	if !ok {
		return errors.New("run not found")
	}
	run.Status, run.ErrorMessage, run.CompletedAt = RunFailed, message, &completedAt
	repository.runs[runID] = run
	model := repository.models[run.ModelID]
	model.Status = ModelFailed
	repository.models[run.ModelID] = model
	return nil
}

func (repository *memoryRepository) UpdateRunResult(_ context.Context, runID string, result Result) error {
	run, ok := repository.runs[runID]
	if !ok || run.Status != RunCompleted {
		return ErrNotFound
	}
	run.Result = &result
	repository.runs[runID] = run
	return nil
}
