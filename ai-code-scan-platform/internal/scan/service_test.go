package scan

import (
	"context"
	"errors"
	"testing"
	"time"

	"ai-code-scan-platform/internal/auth"
)

type recordingRepositoryAccessVerifier struct {
	repositoryURL string
	gitRef        string
	token         string
	branches      []string
	err           error
}

type recordingCompletionNotifier struct {
	tasks []Task
}

func (notifier *recordingCompletionNotifier) NotifyCompletion(_ context.Context, task Task) error {
	notifier.tasks = append(notifier.tasks, task)
	return nil
}

func TestUpdateNotifiesOnceWhenScanCompletes(t *testing.T) {
	repository := &memoryRepository{task: Task{ID: "scan-1", Status: StatusAnalyzing, Stage: "分析", Progress: 80}}
	notifier := &recordingCompletionNotifier{}
	service := NewService(repository).WithCompletionNotifier(notifier)
	input := UpdateTaskInput{Status: StatusCompleted, Stage: "完成", Progress: 100, StatusMessage: "扫描完成"}

	if _, err := service.Update(context.Background(), "scan-1", input); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Update(context.Background(), "scan-1", input); err != nil {
		t.Fatal(err)
	}
	if len(notifier.tasks) != 1 || notifier.tasks[0].Status != StatusCompleted {
		t.Fatalf("expected one completion notification, got %#v", notifier.tasks)
	}
}

func (verifier *recordingRepositoryAccessVerifier) Verify(_ context.Context, repositoryURL, gitRef, token string) error {
	verifier.repositoryURL = repositoryURL
	verifier.gitRef = gitRef
	verifier.token = token
	return verifier.err
}

func (verifier *recordingRepositoryAccessVerifier) ListBranches(_ context.Context, repositoryURL, token string) ([]string, error) {
	verifier.repositoryURL = repositoryURL
	verifier.token = token
	return verifier.branches, verifier.err
}

func TestCreatePlatformVerifiesRepositoryAccessBeforePersistence(t *testing.T) {
	for _, token := range []string{"", "repo-secret"} {
		t.Run(map[bool]string{true: "without token", false: "with token"}[token == ""], func(t *testing.T) {
			repository := &memoryRepository{}
			verifier := &recordingRepositoryAccessVerifier{err: errors.New("repository unavailable")}
			service := NewService(repository).WithSecretCipher(testSecretCipher{}).WithRepositoryAccessVerifier(verifier)
			ctx := auth.WithUser(context.Background(), auth.User{ID: "user-42", Role: "user"})

			_, err := service.CreatePlatform(ctx, CreateTaskInput{
				ProjectName: "payments", RepositoryURL: "https://git.example.com/payments.git", GitRef: "main", RepositoryToken: token,
			})

			if err == nil || verifier.repositoryURL != "https://git.example.com/payments.git" || verifier.gitRef != "main" || verifier.token != token {
				t.Fatalf("expected repository verification failure with token %q, got verifier=%#v err=%v", token, verifier, err)
			}
			if repository.task.ID != "" {
				t.Fatalf("scan was persisted before repository verification: %#v", repository.task)
			}
		})
	}
}

func TestReportStatisticsUsesCoverageFindingsAndSnapshotLines(t *testing.T) {
	input := UploadReportInput{
		ReportJSON: `{"coverage":{"checked":["src/a.go","src/b.go"]},"findings":[{"id":"SEC-1"}]}`,
		SourceSnapshot: SourceSnapshot{Files: []SourceSnapshotFile{
			{Path: "src/a.go", Content: "package main\n\nfunc main() {}"},
			{Path: "src/b.go", Content: ""},
		}},
	}

	statistics, err := reportStatistics(input)
	if err != nil {
		t.Fatal(err)
	}
	if statistics.ScannedFiles != 2 || statistics.CodeLines != 3 || statistics.FindingCount != 1 {
		t.Fatalf("unexpected report statistics: %#v", statistics)
	}
}

func TestNormalizedScanConfigurationAssignsIndependentScanLevels(t *testing.T) {
	checks := []struct {
		input CreateTaskInput
		level ScanLevel
		mode  ScanMode
	}{
		{CreateTaskInput{ScanLevel: ScanLevelLite}, ScanLevelLite, ScanModeStandard},
		{CreateTaskInput{Mode: ScanModeStandard}, ScanLevelStandard, ScanModeStandard},
		{CreateTaskInput{Mode: ScanModeDeep}, ScanLevelRelease, ScanModeDeep},
	}
	for _, check := range checks {
		configuration := normalizedScanConfiguration(check.input)
		if configuration.ScanLevel != check.level || configuration.Mode != check.mode {
			t.Fatalf("unexpected normalized configuration: %#v", configuration)
		}
	}
}

func TestValidateSourceSnapshotAcceptsEvidenceFiles(t *testing.T) {
	err := validateSourceSnapshot(SourceSnapshot{
		GitStatus: "M changed.go",
		Files: []SourceSnapshotFile{
			{Path: "changed.go", Kind: "changed", Content: "package main"},
			{Path: "internal/sink.go", Kind: "evidence", Content: "package internal"},
		},
	})
	if err != nil {
		t.Fatalf("expected evidence source file to be accepted: %v", err)
	}
}

func TestValidateUploadedSourceSnapshotAllowsEmptyPlatformCoverage(t *testing.T) {
	if err := validateUploadedSourceSnapshot(SourcePlatform, SourceSnapshot{}); err != nil {
		t.Fatalf("platform full scan with no matching files should upload an empty coverage report: %v", err)
	}
	if err := validateUploadedSourceSnapshot(SourcePlugin, SourceSnapshot{}); err == nil {
		t.Fatal("plugin reports must still include their source evidence")
	}
}

func TestFilterSourceSnapshotAppliesConfiguredScopeAndCodeFileFilter(t *testing.T) {
	configuration := ScanConfiguration{
		ExcludeDirectories: []string{"vendor"},
		ExcludePatterns:    []string{"*_generated.go"},
		ScanDirectories:    []string{"src"},
	}
	snapshot := SourceSnapshot{
		GitStatus: "M src/main.go\nM src/README.md\nM vendor/lib.go\nM src/api_generated.go",
		Files: []SourceSnapshotFile{
			{Path: "src/main.go", Kind: "changed", Content: "package main"},
			{Path: "src/README.md", Kind: "changed", Content: "documentation"},
			{Path: "vendor/lib.go", Kind: "changed", Content: "package vendor"},
			{Path: "src/api_generated.go", Kind: "changed", Content: "package main"},
		},
	}

	filtered := filterSourceSnapshot(snapshot, configuration)
	if len(filtered.Files) != 1 || filtered.Files[0].Path != "src/main.go" {
		t.Fatalf("expected only src/main.go, got %#v", filtered.Files)
	}
}

func TestServiceScopesPlatformReadsToRegularUser(t *testing.T) {
	repository := &memoryRepository{task: Task{ID: "scan-1", Source: SourcePlatform}}
	service := NewService(repository)
	ctx := auth.WithUser(context.Background(), auth.User{ID: "user-42", Role: "user"})

	if _, err := service.ListForUser(ctx, 20, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := service.GetForUser(ctx, "scan-1"); err != nil {
		t.Fatal(err)
	}
	if repository.listedActorID != "user-42" {
		t.Fatalf("expected reads scoped to user-42, got %q", repository.listedActorID)
	}
}

func TestStatisticsForUserBuildsSevenDayTrendAndComparison(t *testing.T) {
	repository := &memoryRepository{
		completedAt: []time.Time{
			time.Date(2026, 8, 9, 1, 0, 0, 0, time.UTC),
			time.Date(2026, 8, 9, 3, 0, 0, 0, time.UTC),
			time.Date(2026, 8, 3, 16, 30, 0, 0, time.UTC),
			time.Date(2026, 7, 31, 1, 0, 0, 0, time.UTC),
		},
		distribution: RiskDistribution{Critical: 2, High: 3, Medium: 5, Low: 7},
	}
	service := NewService(repository)
	service.now = func() time.Time { return time.Date(2026, 8, 9, 4, 0, 0, 0, time.UTC) }
	ctx := auth.WithUser(context.Background(), auth.User{ID: "user-42", Role: "user"})

	statistics, err := service.StatisticsForUser(ctx, 8*60)
	if err != nil {
		t.Fatal(err)
	}
	if len(statistics.Trend) != 7 || statistics.Trend[0].Date != "2026-08-03" || statistics.Trend[0].Completed != 0 || statistics.Trend[1].Completed != 1 || statistics.Trend[6].Completed != 2 {
		t.Fatalf("unexpected trend: %#v", statistics.Trend)
	}
	if statistics.CurrentPeriodCompleted != 3 || statistics.PreviousPeriodCompleted != 1 || statistics.ChangePercent == nil || *statistics.ChangePercent != 200 {
		t.Fatalf("unexpected comparison: %#v", statistics)
	}
	if statistics.RiskDistribution != repository.distribution || repository.listedActorID != "user-42" {
		t.Fatalf("expected actor-scoped risk distribution, got %#v", statistics.RiskDistribution)
	}
}

func TestStatisticsForUserLeavesChangeNullWhenPreviousWeekIsEmpty(t *testing.T) {
	repository := &memoryRepository{
		completedAt: []time.Time{time.Date(2026, 8, 9, 1, 0, 0, 0, time.UTC)},
		tokenUsage:  AITokenTotals{TaskCount: 3, InputTokens: 1200, OutputTokens: 300, TotalTokens: 1500},
	}
	service := NewService(repository)
	service.now = func() time.Time { return time.Date(2026, 8, 9, 4, 0, 0, 0, time.UTC) }
	ctx := auth.WithUser(context.Background(), auth.User{ID: "admin-1", Role: "admin"})

	statistics, err := service.StatisticsForUser(ctx, 8*60)
	if err != nil {
		t.Fatal(err)
	}
	if statistics.ChangePercent != nil || repository.listedActorID != "" {
		t.Fatalf("expected administrator-wide statistics and undefined growth, got %#v", statistics)
	}
	if statistics.AITokenUsage != repository.tokenUsage {
		t.Fatalf("expected administrator-wide token usage, got %#v", statistics.AITokenUsage)
	}
}

func TestStatisticsForUserUsesBeijingDayBoundaries(t *testing.T) {
	repository := &memoryRepository{completedAt: []time.Time{
		time.Date(2026, 8, 8, 16, 30, 0, 0, time.UTC),
	}}
	service := NewService(repository)
	service.now = func() time.Time { return time.Date(2026, 8, 9, 4, 0, 0, 0, time.UTC) }
	ctx := auth.WithUser(context.Background(), auth.User{ID: "user-42", Role: "user"})

	statistics, err := service.StatisticsForUser(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if statistics.Trend[6].Date != "2026-08-09" || statistics.Trend[6].Completed != 1 {
		t.Fatalf("expected 2026-08-09 00:30 Beijing to count on August 9, got %#v", statistics.Trend)
	}
}

func TestServiceAllowsAdminToListPlatformScans(t *testing.T) {
	repository := &memoryRepository{task: Task{ID: "scan-1", Source: SourcePlatform}}
	service := NewService(repository)
	ctx := auth.WithUser(context.Background(), auth.User{ID: "admin-1", Role: "admin"})

	tasks, err := service.ListForUser(ctx, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || repository.listedActorID != "" {
		t.Fatalf("expected administrator-wide platform query, got %#v", tasks)
	}
}
