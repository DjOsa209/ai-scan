package scan

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

type safeCredentialPayload struct{}

func (safeCredentialPayload) Match(value driver.Value) bool {
	payload, ok := value.([]byte)
	if !ok {
		return false
	}
	text := string(payload)
	return strings.Contains(text, "/repository-credential") && !strings.Contains(text, "cipher-secret")
}

var taskColumns = []string{
	"id", "project_name", "repository_url", "git_ref", "skill_source_id", "source", "actor_type", "actor_id",
	"creator_name", "creator_employee_no",
	"billing_mode", "estimated_credits", "charged_credits", "ai_input_tokens", "ai_output_tokens", "ai_total_tokens", "ai_token_usage_estimated",
	"has_report", "has_source_code", "scanned_files", "code_lines", "finding_count", "status", "stage", "progress", "status_message", "scan_configuration", "queue_position", "created_at", "updated_at",
}

func TestGetPlatformFiltersPlatformTask(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)
	mock.ExpectQuery(regexp.QuoteMeta("WHERE id = ? AND source = 'platform'")).
		WithArgs("scan-1").
		WillReturnRows(taskRows(SourcePlatform, ActorUser, "user-42"))

	if _, err := repository.GetPlatform(context.Background(), "scan-1"); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetAITokenUsageScopesTotalsByActor(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)
	actorID := "user-42"
	mock.ExpectQuery("SELECT(.|\\s)+FROM scan_tasks WHERE actor_id = \\?").
		WithArgs(actorID).
		WillReturnRows(sqlmock.NewRows([]string{"task_count", "input_tokens", "output_tokens", "total_tokens"}).AddRow(2, 1200, 300, 1500))

	usage, err := repository.GetAITokenUsage(context.Background(), &actorID)
	if err != nil {
		t.Fatal(err)
	}
	if usage.TaskCount != 2 || usage.InputTokens != 1200 || usage.OutputTokens != 300 || usage.TotalTokens != 1500 {
		t.Fatalf("unexpected token usage: %#v", usage)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePersistsScanConfigurationAndInitialLog(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)
	actorID := "user-42"
	task := Task{
		ID: "scan-1", ProjectName: "payments", RepositoryURL: "https://git.example.com/payments.git", GitRef: "main",
		Source: SourcePlatform, ActorType: ActorUser, ActorID: &actorID, BillingMode: BillingCredit, EstimatedCredits: 40,
		CreatorName: "张伟", CreatorEmployeeNo: "A0042",
		Status: StatusQueued, Stage: "等待扫描", StatusMessage: "扫描任务已创建",
		ScanConfiguration: ScanConfiguration{Mode: ScanModeStandard, Priority: PriorityNormal, ExcludeDirectories: []string{"vendor"}},
	}
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO scan_tasks").
		WithArgs(task.ID, task.ProjectName, task.RepositoryURL, task.GitRef, nil, task.Source, task.ActorType, task.ActorID, task.CreatorName, task.CreatorEmployeeNo, task.BillingMode, task.EstimatedCredits, 0, task.Status, task.Stage, 0, task.StatusMessage, sqlmock.AnyArg(), 0).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO scan_task_logs").
		WithArgs(task.ID, "info", task.Stage, 0, task.StatusMessage).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	mock.ExpectQuery("WHERE id = \\?").WithArgs(task.ID).
		WillReturnRows(taskRowsWithConfiguration(SourcePlatform, ActorUser, actorID, `{"mode":"standard","priority":"normal","excludeDirectories":["vendor"],"excludePatterns":null,"scanDirectories":null,"vulnerabilityTypes":null}`))

	created, err := repository.Create(context.Background(), task)
	if err != nil {
		t.Fatal(err)
	}
	if len(created.ScanConfiguration.ExcludeDirectories) != 1 || created.ScanConfiguration.ExcludeDirectories[0] != "vendor" {
		t.Fatalf("configuration was not persisted: %#v", created.ScanConfiguration)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreatePlatformAtomicAssignsQueuePositionAndCreatesOutbox(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database).WithCallbackBaseURL("https://security.example.com/")
	actorID := "user-42"
	task := Task{
		ID: "scan-12", ProjectName: "payments", RepositoryURL: "https://git.example.com/payments.git", GitRef: "main",
		Source: SourcePlatform, ActorType: ActorUser, ActorID: &actorID, BillingMode: BillingCredit, EstimatedCredits: 40,
		CreatorName: "张伟", CreatorEmployeeNo: "A0042",
		Status: StatusQueued, Stage: "等待扫描", StatusMessage: "扫描任务已创建",
		ScanConfiguration:         ScanConfiguration{Mode: ScanModeDeep, ScanLevel: ScanLevelRelease, Priority: PriorityNormal},
		repositoryTokenCiphertext: "cipher-secret",
	}
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT revision FROM scan_queue_state").WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(11))
	mock.ExpectQuery("SELECT MAX\\(queue_position\\) FROM scan_tasks").WithArgs(ScanLevelRelease).WillReturnRows(sqlmock.NewRows([]string{"maximum"}).AddRow(11))
	mock.ExpectQuery("SELECT available, frozen FROM credit_accounts").WithArgs(task.ActorID).
		WillReturnRows(sqlmock.NewRows([]string{"available", "frozen"}).AddRow(100, 0))
	mock.ExpectExec("UPDATE credit_accounts").WithArgs(uint64(40), uint64(40), task.ActorID).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO scan_tasks").WithArgs(
		task.ID, task.ProjectName, task.RepositoryURL, task.GitRef, nil, task.Source, task.ActorType, task.ActorID,
		task.CreatorName, task.CreatorEmployeeNo,
		task.BillingMode, task.EstimatedCredits, 0, task.Status, "等待扫描", 0, "任务等待执行，当前排队第 12 位", sqlmock.AnyArg(), 12,
	).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO scan_repository_credentials").WithArgs(task.ID, "cipher-secret").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO scan_task_logs").WithArgs(task.ID, "info", "等待扫描", 0, "任务等待执行，当前排队第 12 位").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO scan_dispatch_outbox").WithArgs(sqlmock.AnyArg(), task.ID, safeCredentialPayload{}).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE scan_queue_state").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO credit_transactions").WithArgs(sqlmock.AnyArg(), task.ActorID, task.ID, int64(-40), uint64(60), task.ProjectName+" scan estimate").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("WHERE id = \\?").WithArgs(task.ID).WillReturnRows(taskRowsAtPosition(SourcePlatform, ActorUser, actorID, 12))
	mock.ExpectCommit()

	created, err := repository.CreatePlatformAtomic(context.Background(), task)
	if err != nil {
		t.Fatal(err)
	}
	if created.QueuePosition != 12 {
		t.Fatalf("expected queue position 12, got %d", created.QueuePosition)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateCompletedSettlesFrozenCredits(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)
	actorID := "user-42"

	mock.ExpectBegin()
	mock.ExpectQuery("WHERE id = \\?").WithArgs("scan-1").WillReturnRows(taskRowsForSettlement(actorID))
	mock.ExpectQuery("SELECT available, frozen FROM credit_accounts").WithArgs(actorID).
		WillReturnRows(sqlmock.NewRows([]string{"available", "frozen"}).AddRow(80, 20))
	mock.ExpectExec("UPDATE credit_accounts SET frozen = frozen - \\?, lifetime_used = lifetime_used \\+ \\?").
		WithArgs(uint64(20), uint64(20), actorID, uint64(20)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE scan_tasks SET charged_credits = \\?").
		WithArgs(20, "scan-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO credit_transactions").
		WithArgs(sqlmock.AnyArg(), actorID, "scan-1", int64(-20), uint64(80), "payments scan settlement").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE scan_tasks SET status").
		WithArgs(StatusCompleted, "扫描完成", 100, "扫描完成，报告已生成", StatusCompleted, StatusCompleted, "scan-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO scan_task_logs").
		WithArgs("scan-1", "success", "扫描完成", 100, "扫描完成，报告已生成").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	mock.ExpectQuery("WHERE id = \\?").WithArgs("scan-1").WillReturnRows(taskRowsForCompletedSettlement(actorID))

	updated, err := repository.Update(context.Background(), "scan-1", UpdateTaskInput{
		Status: StatusCompleted, Stage: "扫描完成", Progress: 100, StatusMessage: "扫描完成，报告已生成",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.ChargedCredits != 20 {
		t.Fatalf("expected 20 charged credits, got %d", updated.ChargedCredits)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateFailedReleasesFrozenCredits(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)
	actorID := "user-42"

	mock.ExpectBegin()
	mock.ExpectQuery("WHERE id = \\?").WithArgs("scan-1").WillReturnRows(taskRowsForSettlement(actorID))
	mock.ExpectQuery("SELECT available, frozen FROM credit_accounts").WithArgs(actorID).
		WillReturnRows(sqlmock.NewRows([]string{"available", "frozen"}).AddRow(80, 20))
	mock.ExpectExec("UPDATE credit_accounts SET available = available \\+ \\?, frozen = frozen - \\?").
		WithArgs(uint64(20), uint64(20), actorID, uint64(20)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO credit_transactions").
		WithArgs(sqlmock.AnyArg(), actorID, "scan-1", int64(20), uint64(100), "payments scan refund").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE scan_tasks SET status").
		WithArgs(StatusFailed, "扫描失败", 5, "扫描引擎未能完成任务", StatusFailed, StatusFailed, "scan-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO scan_task_logs").
		WithArgs("scan-1", "error", "扫描失败", 5, "扫描引擎未能完成任务").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	mock.ExpectQuery("WHERE id = \\?").WithArgs("scan-1").WillReturnRows(taskRowsForFailedRelease(actorID))

	updated, err := repository.Update(context.Background(), "scan-1", UpdateTaskInput{
		Status: StatusFailed, Stage: "扫描失败", Progress: 5, StatusMessage: "扫描引擎未能完成任务",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.ChargedCredits != 0 {
		t.Fatalf("expected no charged credits, got %d", updated.ChargedCredits)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetByActorFiltersPlatformTask(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)
	mock.ExpectQuery(regexp.QuoteMeta("WHERE id = ? AND actor_id = ?")).
		WithArgs("scan-1", "user-42").
		WillReturnRows(taskRows(SourcePlatform, ActorUser, "user-42"))

	if _, err := repository.GetByActor(context.Background(), "scan-1", "user-42"); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteByActorPermanentlyDeletesOwnedCompletedTask(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM scan_tasks").
		WithArgs("scan-1", "user-42").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("scan-1"))
	mock.ExpectExec("UPDATE credit_transactions SET scan_task_id = NULL").
		WithArgs("scan-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM scan_tasks").
		WithArgs("scan-1", "user-42").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := repository.DeleteByActor(context.Background(), "scan-1", "user-42"); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteByActorDoesNotChangeCreditsForUnownedTask(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM scan_tasks").
		WithArgs("scan-1", "user-42").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	if err := repository.DeleteByActor(context.Background(), "scan-1", "user-42"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("expected sql.ErrNoRows, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestListByActorFiltersPlatformTasks(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)
	mock.ExpectQuery(regexp.QuoteMeta("WHERE actor_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")).
		WithArgs("user-42", 20, 40).
		WillReturnRows(taskRows(SourcePlatform, ActorUser, "user-42"))

	tasks, err := repository.ListByActor(context.Background(), "user-42", 20, 40)
	if err != nil || len(tasks) != 1 {
		t.Fatalf("unexpected result: %#v, %v", tasks, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestListPluginFiltersAnonymousTasks(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)
	mock.ExpectQuery(regexp.QuoteMeta("WHERE source = 'plugin' AND actor_type = 'anonymous' AND actor_id IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?")).
		WithArgs(100, 0).
		WillReturnRows(taskRows(SourcePlugin, ActorAnonymous, nil))

	tasks, err := repository.ListPlugin(context.Background(), 100, 0)
	if err != nil || len(tasks) != 1 || tasks[0].ActorID != nil {
		t.Fatalf("unexpected result: %#v, %v", tasks, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStatisticsQueriesAreScopedToActor(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)
	from := time.Date(2026, 7, 27, 16, 0, 0, 0, time.UTC)
	to := time.Date(2026, 8, 10, 16, 0, 0, 0, time.UTC)
	actorID := "user-42"
	mock.ExpectQuery("SELECT COALESCE\\(completed_at, updated_at\\)[\\s\\S]+AND actor_id = \\?").
		WithArgs(from, to, actorID).
		WillReturnRows(sqlmock.NewRows([]string{"completed_at"}).AddRow(time.Date(2026, 8, 9, 1, 0, 0, 0, time.UTC)))
	mock.ExpectQuery("SELECT[\\s\\S]+JSON_EXTRACT[\\s\\S]+AND actor_id = \\?").
		WithArgs(actorID).
		WillReturnRows(sqlmock.NewRows([]string{"critical", "high", "medium", "low"}).AddRow(1, 2, 3, 4))

	completed, err := repository.ListCompletedBetween(context.Background(), &actorID, from, to)
	if err != nil || len(completed) != 1 {
		t.Fatalf("unexpected completion result: %#v, %v", completed, err)
	}
	distribution, err := repository.GetRiskDistribution(context.Background(), &actorID)
	if err != nil || distribution != (RiskDistribution{Critical: 1, High: 2, Medium: 3, Low: 4}) {
		t.Fatalf("unexpected risk distribution: %#v, %v", distribution, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEmptyRiskDistributionReturnsZeroCounts(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)
	actorID := "user-42"
	mock.ExpectQuery("SELECT[\\s\\S]+JSON_EXTRACT[\\s\\S]+AND actor_id = \\?").
		WithArgs(actorID).
		WillReturnRows(sqlmock.NewRows([]string{"critical", "high", "medium", "low"}))

	distribution, err := repository.GetRiskDistribution(context.Background(), &actorID)
	if err != nil {
		t.Fatalf("empty reports should produce zero risk counts, got %v", err)
	}
	if distribution != (RiskDistribution{}) {
		t.Fatalf("expected zero risk counts, got %#v", distribution)
	}
}

func TestGetDetailReturnsPersistentReportSourceAndLogs(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewMySQLRepository(database)
	now := time.Now()
	mock.ExpectQuery("WHERE id = \\?").WithArgs("scan-1").WillReturnRows(taskRows(SourcePlugin, ActorUser, "user-42"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT report_markdown, source_snapshot FROM scan_tasks WHERE id = ?")).
		WithArgs("scan-1").
		WillReturnRows(sqlmock.NewRows([]string{"report_markdown", "source_snapshot"}).AddRow(`{"schemaVersion":"2.0"}`, `{"gitStatus":"M main.go","diff":"","files":[{"path":"main.go","kind":"changed","content":"package main"}]}`))
	mock.ExpectQuery("SELECT level, stage, progress, message, created_at[\\s\\S]+FROM scan_task_logs").
		WithArgs("scan-1").
		WillReturnRows(sqlmock.NewRows([]string{"level", "stage", "progress", "message", "created_at"}).
			AddRow("info", "获取代码", 10, "代码已获取", now).
			AddRow("success", "报告生成", 100, "扫描报告已保存", now.Add(time.Second)))

	detail, err := repository.GetDetail(context.Background(), "scan-1")
	if err != nil {
		t.Fatal(err)
	}
	if detail.ReportJSON == "" || len(detail.SourceSnapshot.Files) != 1 || len(detail.Logs) != 2 || detail.Logs[1].Message != "扫描报告已保存" {
		t.Fatalf("unexpected detail: %#v", detail)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func taskRows(source Source, actorType ActorType, actorID any) *sqlmock.Rows {
	return taskRowsWithConfiguration(source, actorType, actorID, `{}`)
}

func taskRowsAtPosition(source Source, actorType ActorType, actorID any, position int) *sqlmock.Rows {
	return taskRowsWithConfigurationAndPosition(source, actorType, actorID, `{}`, position)
}

func taskRowsWithConfiguration(source Source, actorType ActorType, actorID any, configuration string) *sqlmock.Rows {
	return taskRowsWithConfigurationAndPosition(source, actorType, actorID, configuration, 1)
}

func taskRowsWithConfigurationAndPosition(source Source, actorType ActorType, actorID any, configuration string, position int) *sqlmock.Rows {
	now := time.Now()
	return sqlmock.NewRows(taskColumns).AddRow(
		"scan-1", "payments", "https://git.example.com/payments.git", "main", nil, source, actorType, actorID,
		"张伟", "A0042",
		BillingCredit, 20, 0, 1200, 300, 1500, true, false, false, 0, 0, 0, StatusQueued, "queued", 0, "created", configuration, position, now, now,
	)
}

func taskRowsForSettlement(actorID string) *sqlmock.Rows {
	now := time.Now()
	return sqlmock.NewRows(taskColumns).AddRow(
		"scan-1", "payments", "https://git.example.com/payments.git", "main", nil, SourcePlatform, ActorUser, actorID,
		"张伟", "A0042",
		BillingCredit, 20, 0, 1200, 300, 1500, true, true, false, 10, 200, 1, StatusNormalizing, "结果归一化", 90, "正在生成安全扫描报告", `{}`, 0, now, now,
	)
}

func taskRowsForCompletedSettlement(actorID string) *sqlmock.Rows {
	now := time.Now()
	return sqlmock.NewRows(taskColumns).AddRow(
		"scan-1", "payments", "https://git.example.com/payments.git", "main", nil, SourcePlatform, ActorUser, actorID,
		"张伟", "A0042",
		BillingCredit, 20, 20, 1200, 300, 1500, true, true, false, 10, 200, 1, StatusCompleted, "扫描完成", 100, "扫描完成，报告已生成", `{}`, 0, now, now,
	)
}

func taskRowsForFailedRelease(actorID string) *sqlmock.Rows {
	now := time.Now()
	return sqlmock.NewRows(taskColumns).AddRow(
		"scan-1", "payments", "https://git.example.com/payments.git", "main", nil, SourcePlatform, ActorUser, actorID,
		"张伟", "A0042",
		BillingCredit, 20, 0, 1200, 300, 1500, true, true, false, 10, 200, 1, StatusFailed, "扫描失败", 5, "扫描引擎未能完成任务", `{}`, 0, now, now,
	)
}
