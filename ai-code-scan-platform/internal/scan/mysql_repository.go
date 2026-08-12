package scan

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"
)

var ErrInsufficientCredits = errors.New("insufficient credits")

type MySQLRepository struct {
	database        *sql.DB
	callbackBaseURL string
}

func NewMySQLRepository(database *sql.DB) *MySQLRepository {
	return &MySQLRepository{database: database, callbackBaseURL: "http://localhost:8080"}
}

func (repository *MySQLRepository) WithCallbackBaseURL(value string) *MySQLRepository {
	if value = strings.TrimRight(strings.TrimSpace(value), "/"); value != "" {
		repository.callbackBaseURL = value
	}
	return repository
}

func (repository *MySQLRepository) Create(ctx context.Context, task Task) (Task, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, err
	}
	defer transaction.Rollback()
	if err := insertTask(ctx, transaction, task); err != nil {
		return Task{}, err
	}
	if len(task.sourceArchive) > 0 {
		if _, err := transaction.ExecContext(ctx, `INSERT INTO scan_source_archives (scan_task_id, filename, content) VALUES (?, ?, ?)`, task.ID, path.Base(task.RepositoryURL), task.sourceArchive); err != nil {
			return Task{}, err
		}
	}
	if err := appendTaskLog(ctx, transaction, task.ID, "info", task.Stage, task.Progress, task.StatusMessage); err != nil {
		return Task{}, err
	}
	if err := transaction.Commit(); err != nil {
		return Task{}, err
	}
	return repository.Get(ctx, task.ID)
}

func (repository *MySQLRepository) CreatePlatformAtomic(ctx context.Context, task Task) (Task, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, err
	}
	defer transaction.Rollback()
	if task.Source == SourcePlatform {
		if err := lockScanQueue(ctx, transaction); err != nil {
			return Task{}, err
		}
		position, err := allocateQueuePosition(ctx, transaction, task.ScanConfiguration.Priority, task.ScanConfiguration.ScanLevel)
		if err != nil {
			return Task{}, err
		}
		task.QueuePosition = position
		task.Stage = "等待扫描"
		task.StatusMessage = fmt.Sprintf("任务等待执行，当前排队第 %d 位", position)
	}

	var available uint64
	var frozen uint64
	if err := transaction.QueryRowContext(ctx, `
		SELECT available, frozen FROM credit_accounts WHERE user_id = ? FOR UPDATE`, task.ActorID).Scan(&available, &frozen); err != nil {
		return Task{}, err
	}
	credits := uint64(task.EstimatedCredits)
	if available < credits {
		return Task{}, fmt.Errorf("%w: need %d, available %d", ErrInsufficientCredits, credits, available)
	}
	if _, err := transaction.ExecContext(ctx, `
		UPDATE credit_accounts SET available = available - ?, frozen = frozen + ? WHERE user_id = ?`,
		credits, credits, task.ActorID); err != nil {
		return Task{}, err
	}
	if err := insertTask(ctx, transaction, task); err != nil {
		return Task{}, err
	}
	if err := appendTaskLog(ctx, transaction, task.ID, "info", task.Stage, task.Progress, task.StatusMessage); err != nil {
		return Task{}, err
	}
	if task.Source == SourcePlatform {
		if err := repository.insertDispatchMessage(ctx, transaction, task); err != nil {
			return Task{}, err
		}
		if _, err := transaction.ExecContext(ctx, `UPDATE scan_queue_state SET revision = revision + 1 WHERE id = 1`); err != nil {
			return Task{}, err
		}
	}
	transactionID, err := repositoryID()
	if err != nil {
		return Task{}, err
	}
	if _, err := transaction.ExecContext(ctx, `
		INSERT INTO credit_transactions (id, user_id, scan_task_id, type, amount, balance_after, description)
		VALUES (?, ?, ?, 'freeze', ?, ?, ?)`, transactionID, task.ActorID, task.ID, -int64(credits), available-credits, task.ProjectName+" scan estimate"); err != nil {
		return Task{}, err
	}
	created, err := getTask(ctx, transaction, task.ID)
	if err != nil {
		return Task{}, err
	}
	if err := transaction.Commit(); err != nil {
		return Task{}, err
	}
	return created, nil
}

func lockScanQueue(ctx context.Context, transaction *sql.Tx) error {
	var revision uint64
	return transaction.QueryRowContext(ctx, `SELECT revision FROM scan_queue_state WHERE id = 1 FOR UPDATE`).Scan(&revision)
}

const scanLevelSQL = `COALESCE(
	NULLIF(JSON_UNQUOTE(JSON_EXTRACT(scan_configuration, '$.scanLevel')), 'null'),
	CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(scan_configuration, '$.mode')) = 'deep' THEN 'release' ELSE 'standard' END
)`

func allocateQueuePosition(ctx context.Context, transaction *sql.Tx, priority Priority, scanLevel ScanLevel) (int, error) {
	if priority == PriorityUrgent {
		var urgent int
		if err := transaction.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM scan_tasks
			WHERE source = 'platform' AND status = 'queued'
			  AND `+scanLevelSQL+` = ?
			  AND JSON_UNQUOTE(JSON_EXTRACT(scan_configuration, '$.priority')) = 'urgent'`, scanLevel).Scan(&urgent); err != nil {
			return 0, err
		}
		position := urgent + 1
		if _, err := transaction.ExecContext(ctx, `
			INSERT INTO scan_task_logs (scan_task_id, level, stage, progress, message)
			SELECT id, 'info', stage, progress, CONCAT('队列位次已更新，当前排队第 ', queue_position + 1, ' 位')
			FROM scan_tasks
			WHERE source = 'platform' AND status = 'queued' AND `+scanLevelSQL+` = ? AND queue_position >= ?`, scanLevel, position); err != nil {
			return 0, err
		}
		if _, err := transaction.ExecContext(ctx, `
			UPDATE scan_tasks SET
				status_message = CONCAT('任务等待执行，当前排队第 ', queue_position + 1, ' 位'),
				queue_position = queue_position + 1
			WHERE source = 'platform' AND status = 'queued' AND `+scanLevelSQL+` = ? AND queue_position >= ?`, scanLevel, position); err != nil {
			return 0, err
		}
		return position, nil
	}
	var maximum sql.NullInt64
	if err := transaction.QueryRowContext(ctx, `
		SELECT MAX(queue_position) FROM scan_tasks
		WHERE source = 'platform' AND status = 'queued' AND `+scanLevelSQL+` = ?`, scanLevel).Scan(&maximum); err != nil {
		return 0, err
	}
	return int(maximum.Int64) + 1, nil
}

func (repository *MySQLRepository) insertDispatchMessage(ctx context.Context, transaction *sql.Tx, task Task) error {
	outboxID, err := repositoryID()
	if err != nil {
		return err
	}
	eventID, err := repositoryID()
	if err != nil {
		return err
	}
	base := repository.callbackBaseURL
	credentialURL := ""
	archiveURL := ""
	if task.repositoryTokenCiphertext != "" {
		credentialURL = base + "/api/v1/admin/scans/" + task.ID + "/repository-credential"
	}
	if len(task.sourceArchive) > 0 {
		archiveURL = base + "/api/v1/admin/scans/" + task.ID + "/source-archive"
	}
	repositoryURL := task.RepositoryURL
	if archiveURL != "" {
		repositoryURL = ""
	}
	envelope := ScanRequestEnvelope{
		SchemaVersion: "1.0",
		EventID:       eventID,
		EventType:     "scan.requested",
		OccurredAt:    time.Now().UTC(),
		Task: ScanRequestMessage{
			ID: task.ID, ProjectName: task.ProjectName, RepositoryURL: repositoryURL, GitRef: task.GitRef,
			Mode: task.ScanConfiguration.Mode, ScanLevel: task.ScanConfiguration.ScanLevel,
			Priority: task.ScanConfiguration.Priority, QueuePosition: task.QueuePosition,
			ScanConfiguration: task.ScanConfiguration,
			Callbacks: ScanCallbacks{
				StatusURL:               base + "/api/v1/admin/scans/" + task.ID,
				ReportURL:               base + "/api/v1/admin/scans/" + task.ID + "/report",
				RepositoryCredentialURL: credentialURL,
				ArchiveURL:              archiveURL,
				AuthType:                "bearer", Header: "Authorization",
			},
		},
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	_, err = transaction.ExecContext(ctx, `
		INSERT INTO scan_dispatch_outbox (id, scan_task_id, payload)
		VALUES (?, ?, ?)`, outboxID, task.ID, payload)
	return err
}

type sqlExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type sqlQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func insertTask(ctx context.Context, executor sqlExecutor, task Task) error {
	configuration, err := json.Marshal(task.ScanConfiguration)
	if err != nil {
		return err
	}
	_, err = executor.ExecContext(ctx, `
		INSERT INTO scan_tasks (id, project_name, repository_url, git_ref, skill_source_id, source, actor_type, actor_id, creator_name, creator_employee_no, billing_mode, estimated_credits, charged_credits, status, stage, progress, status_message, scan_configuration, queue_position)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, task.ID, task.ProjectName, task.RepositoryURL,
		task.GitRef, task.SkillSourceID, task.Source, task.ActorType, task.ActorID, task.CreatorName, task.CreatorEmployeeNo, task.BillingMode, task.EstimatedCredits, task.ChargedCredits, task.Status, task.Stage, task.Progress, task.StatusMessage, configuration, task.QueuePosition)
	if err != nil || task.repositoryTokenCiphertext == "" {
		return err
	}
	_, err = executor.ExecContext(ctx, `
		INSERT INTO scan_repository_credentials (scan_task_id, token_ciphertext)
		VALUES (?, ?)`, task.ID, task.repositoryTokenCiphertext)
	return err
}

func (repository *MySQLRepository) GetRepositoryCredentialCiphertext(ctx context.Context, id string) (string, error) {
	var ciphertext string
	err := repository.database.QueryRowContext(ctx, `
		SELECT token_ciphertext FROM scan_repository_credentials WHERE scan_task_id = ?`, id).Scan(&ciphertext)
	return ciphertext, err
}

func (repository *MySQLRepository) GetSourceArchive(ctx context.Context, id string) ([]byte, string, error) {
	var content []byte
	var filename string
	err := repository.database.QueryRowContext(ctx, `SELECT content, filename FROM scan_source_archives WHERE scan_task_id = ?`, id).Scan(&content, &filename)
	return content, filename, err
}

func appendTaskLog(ctx context.Context, executor sqlExecutor, taskID, level, stage string, progress int, message string) error {
	_, err := executor.ExecContext(ctx, `
		INSERT INTO scan_task_logs (scan_task_id, level, stage, progress, message)
		VALUES (?, ?, ?, ?, ?)`, taskID, level, stage, progress, message)
	return err
}

func (repository *MySQLRepository) Get(ctx context.Context, id string) (Task, error) {
	return getTask(ctx, repository.database, id)
}

func (repository *MySQLRepository) GetPlatform(ctx context.Context, id string) (Task, error) {
	return queryTask(ctx, repository.database, `WHERE id = ? AND source = 'platform'`, id)
}

func (repository *MySQLRepository) GetByActor(ctx context.Context, id, actorID string) (Task, error) {
	return queryTask(ctx, repository.database, `WHERE id = ? AND actor_id = ?`, id, actorID)
}

func (repository *MySQLRepository) DeleteByActor(ctx context.Context, id, actorID string) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer transaction.Rollback()
	var ownedTaskID string
	if err := transaction.QueryRowContext(ctx, `
		SELECT id FROM scan_tasks
		WHERE id = ? AND actor_id = ? AND status IN ('completed', 'partial', 'failed', 'cancelled')
		FOR UPDATE`, id, actorID).Scan(&ownedTaskID); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE credit_transactions SET scan_task_id = NULL WHERE scan_task_id = ?`, id); err != nil {
		return err
	}
	result, err := transaction.ExecContext(ctx, `
		DELETE FROM scan_tasks
		WHERE id = ? AND actor_id = ? AND status IN ('completed', 'partial', 'failed', 'cancelled')`, id, actorID)
	if err != nil {
		return err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if deleted == 0 {
		return sql.ErrNoRows
	}
	return transaction.Commit()
}

func (repository *MySQLRepository) GetDetail(ctx context.Context, id string) (TaskDetail, error) {
	task, err := repository.Get(ctx, id)
	if err != nil {
		return TaskDetail{}, err
	}
	var reportMarkdown sql.NullString
	var sourceSnapshotJSON sql.NullString
	if err := repository.database.QueryRowContext(ctx, `SELECT report_markdown, source_snapshot FROM scan_tasks WHERE id = ?`, id).Scan(&reportMarkdown, &sourceSnapshotJSON); err != nil {
		return TaskDetail{}, err
	}
	detail := TaskDetail{Task: task}
	if json.Valid([]byte(reportMarkdown.String)) {
		detail.ReportJSON = reportMarkdown.String
	} else {
		detail.ReportMarkdown = reportMarkdown.String
	}
	if sourceSnapshotJSON.Valid {
		if err := json.Unmarshal([]byte(sourceSnapshotJSON.String), &detail.SourceSnapshot); err != nil {
			return TaskDetail{}, fmt.Errorf("decode source snapshot: %w", err)
		}
	}
	detail.Logs = make([]TaskLog, 0)
	rows, err := repository.database.QueryContext(ctx, `
		SELECT level, stage, progress, message, created_at
		FROM scan_task_logs WHERE scan_task_id = ? ORDER BY created_at, id`, id)
	if err != nil {
		return TaskDetail{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry TaskLog
		if err := rows.Scan(&entry.Level, &entry.Stage, &entry.Progress, &entry.Message, &entry.CreatedAt); err != nil {
			return TaskDetail{}, err
		}
		detail.Logs = append(detail.Logs, entry)
	}
	if err := rows.Err(); err != nil {
		return TaskDetail{}, err
	}
	return detail, nil
}

func getTask(ctx context.Context, queryer sqlQueryer, id string) (Task, error) {
	return queryTask(ctx, queryer, "WHERE id = ?", id)
}

func queryTask(ctx context.Context, queryer sqlQueryer, where string, arguments ...any) (Task, error) {
	return scanTask(queryer.QueryRowContext(ctx, `
			SELECT id, project_name, repository_url, git_ref, skill_source_id, source, actor_type, actor_id, creator_name, creator_employee_no, billing_mode, estimated_credits, charged_credits, ai_input_tokens, ai_output_tokens, ai_total_tokens, ai_token_usage_estimated, report_markdown IS NOT NULL, source_snapshot IS NOT NULL, scanned_files, code_lines, finding_count, status, stage, progress, status_message, scan_configuration, queue_position, created_at, updated_at
		FROM scan_tasks `+where, arguments...))
}

type rowScanner interface {
	Scan(...any) error
}

func scanTask(scanner rowScanner) (Task, error) {
	var task Task
	var skillSourceID sql.NullInt64
	var configurationJSON sql.NullString
	err := scanner.Scan(
		&task.ID, &task.ProjectName, &task.RepositoryURL, &task.GitRef,
		&skillSourceID, &task.Source, &task.ActorType, &task.ActorID, &task.CreatorName, &task.CreatorEmployeeNo, &task.BillingMode, &task.EstimatedCredits, &task.ChargedCredits, &task.AIInputTokens, &task.AIOutputTokens, &task.AITotalTokens, &task.AITokenEstimated, &task.HasReport, &task.HasSourceCode, &task.ScannedFiles, &task.CodeLines, &task.FindingCount, &task.Status, &task.Stage, &task.Progress, &task.StatusMessage, &configurationJSON, &task.QueuePosition, &task.CreatedAt, &task.UpdatedAt,
	)
	if err != nil {
		return Task{}, err
	}
	if skillSourceID.Valid {
		task.SkillSourceID = &skillSourceID.Int64
	}
	if configurationJSON.Valid && strings.TrimSpace(configurationJSON.String) != "" {
		if err := json.Unmarshal([]byte(configurationJSON.String), &task.ScanConfiguration); err != nil {
			return Task{}, fmt.Errorf("decode scan configuration: %w", err)
		}
	}
	if task.ScanConfiguration.Mode == "" {
		task.ScanConfiguration.Mode = ScanModeDeep
	}
	if task.ScanConfiguration.ScanLevel == "" {
		if task.ScanConfiguration.Mode == ScanModeDeep {
			task.ScanConfiguration.ScanLevel = ScanLevelRelease
		} else {
			task.ScanConfiguration.ScanLevel = ScanLevelStandard
		}
	}
	if task.ScanConfiguration.Priority == "" {
		task.ScanConfiguration.Priority = PriorityNormal
	}
	return task, nil
}

func repositoryID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}

func (repository *MySQLRepository) List(ctx context.Context, limit, offset int) ([]Task, error) {
	return repository.list(ctx, "", limit, offset)
}

func (repository *MySQLRepository) ListByActor(ctx context.Context, actorID string, limit, offset int) ([]Task, error) {
	return repository.list(ctx, "WHERE actor_id = ?", limit, offset, actorID)
}

func (repository *MySQLRepository) ListPlatform(ctx context.Context, limit, offset int) ([]Task, error) {
	return repository.list(ctx, "WHERE source = 'platform'", limit, offset)
}

func (repository *MySQLRepository) ListPlugin(ctx context.Context, limit, offset int) ([]Task, error) {
	return repository.list(ctx, "WHERE source = 'plugin' AND actor_type = 'anonymous' AND actor_id IS NULL", limit, offset)
}

func (repository *MySQLRepository) ListCompletedBetween(ctx context.Context, actorID *string, from, to time.Time) ([]time.Time, error) {
	query := `
		SELECT COALESCE(completed_at, updated_at)
		FROM scan_tasks
		WHERE status IN ('completed', 'partial')
			AND COALESCE(completed_at, updated_at) >= ?
			AND COALESCE(completed_at, updated_at) < ?`
	arguments := []any{from, to}
	if actorID != nil {
		query += " AND actor_id = ?"
		arguments = append(arguments, *actorID)
	}
	rows, err := repository.database.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	completed := make([]time.Time, 0)
	for rows.Next() {
		var value time.Time
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		completed = append(completed, value)
	}
	return completed, rows.Err()
}

func (repository *MySQLRepository) GetRiskDistribution(ctx context.Context, actorID *string) (RiskDistribution, error) {
	query := `
		SELECT
			COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(report_markdown, '$.summary.critical')) AS UNSIGNED)), 0),
			COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(report_markdown, '$.summary.high')) AS UNSIGNED)), 0),
			COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(report_markdown, '$.summary.medium')) AS UNSIGNED)), 0),
			COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(report_markdown, '$.summary.low')) AS UNSIGNED)), 0)
		FROM scan_tasks
		WHERE status IN ('completed', 'partial') AND JSON_VALID(report_markdown)`
	arguments := make([]any, 0, 1)
	if actorID != nil {
		query += " AND actor_id = ?"
		arguments = append(arguments, *actorID)
	}
	var distribution RiskDistribution
	err := repository.database.QueryRowContext(ctx, query, arguments...).Scan(
		&distribution.Critical, &distribution.High, &distribution.Medium, &distribution.Low,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return RiskDistribution{}, nil
	}
	return distribution, err
}

func (repository *MySQLRepository) GetAITokenUsage(ctx context.Context, actorID *string) (AITokenTotals, error) {
	query := `
		SELECT
			COALESCE(SUM(ai_total_tokens > 0), 0),
			COALESCE(SUM(ai_input_tokens), 0),
			COALESCE(SUM(ai_output_tokens), 0),
			COALESCE(SUM(ai_total_tokens), 0)
		FROM scan_tasks`
	arguments := make([]any, 0, 1)
	if actorID != nil {
		query += " WHERE actor_id = ?"
		arguments = append(arguments, *actorID)
	}
	var usage AITokenTotals
	err := repository.database.QueryRowContext(ctx, query, arguments...).Scan(
		&usage.TaskCount, &usage.InputTokens, &usage.OutputTokens, &usage.TotalTokens,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return AITokenTotals{}, nil
	}
	return usage, err
}

func (repository *MySQLRepository) list(ctx context.Context, where string, limit, offset int, arguments ...any) ([]Task, error) {
	arguments = append(arguments, limit, offset)
	rows, err := repository.database.QueryContext(ctx, `
			SELECT id, project_name, repository_url, git_ref, skill_source_id, source, actor_type, actor_id, creator_name, creator_employee_no, billing_mode, estimated_credits, charged_credits, ai_input_tokens, ai_output_tokens, ai_total_tokens, ai_token_usage_estimated, report_markdown IS NOT NULL, source_snapshot IS NOT NULL, scanned_files, code_lines, finding_count, status, stage, progress, status_message, scan_configuration, queue_position, created_at, updated_at
		FROM scan_tasks `+where+` ORDER BY created_at DESC LIMIT ? OFFSET ?`, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tasks := make([]Task, 0)
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (repository *MySQLRepository) SaveReport(ctx context.Context, id string, input UploadReportInput) (Task, error) {
	sourceSnapshot, err := json.Marshal(input.SourceSnapshot)
	if err != nil {
		return Task{}, err
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, err
	}
	defer transaction.Rollback()
	var existingReportID sql.NullString
	if err := transaction.QueryRowContext(ctx, `SELECT report_id FROM scan_tasks WHERE id = ? FOR UPDATE`, id).Scan(&existingReportID); err != nil {
		return Task{}, err
	}
	if existingReportID.Valid {
		if existingReportID.String != input.ReportID {
			return Task{}, fmt.Errorf("scan report already uploaded with different reportId")
		}
		return getTask(ctx, transaction, id)
	}
	result, err := transaction.ExecContext(ctx, `UPDATE scan_tasks SET report_id = ?, report_markdown = ?, source_snapshot = ?, ai_input_tokens = ?, ai_output_tokens = ?, ai_total_tokens = ?, ai_token_usage_estimated = ?, scanned_files = ?, code_lines = ?, finding_count = ? WHERE id = ?`, input.ReportID, input.ReportJSON, sourceSnapshot, input.AITokenUsage.InputTokens, input.AITokenUsage.OutputTokens, input.AITokenUsage.TotalTokens, input.AITokenUsage.Estimated, input.Statistics.ScannedFiles, input.Statistics.CodeLines, input.Statistics.FindingCount, id)
	if err != nil {
		return Task{}, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return Task{}, err
		}
		return Task{}, sql.ErrNoRows
	}
	if err := appendTaskLog(ctx, transaction, id, "success", "报告生成", 100, "扫描报告已保存"); err != nil {
		return Task{}, err
	}
	if err := transaction.Commit(); err != nil {
		return Task{}, err
	}
	return repository.Get(ctx, id)
}

func (repository *MySQLRepository) Update(ctx context.Context, id string, input UpdateTaskInput) (Task, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, err
	}
	defer transaction.Rollback()
	current, err := getTask(ctx, transaction, id)
	if err != nil {
		return Task{}, err
	}
	if current.BillingMode == BillingCredit && current.ChargedCredits == 0 && (input.Status == StatusCompleted || input.Status == StatusPartial) {
		if err := settleCredits(ctx, transaction, current); err != nil {
			return Task{}, err
		}
	}
	if current.BillingMode == BillingCredit && current.ChargedCredits == 0 &&
		current.Status != StatusFailed && current.Status != StatusCancelled &&
		(input.Status == StatusFailed || input.Status == StatusCancelled) {
		if err := refundCredits(ctx, transaction, current); err != nil {
			return Task{}, err
		}
	}
	if current.Status == StatusQueued && input.Status != StatusQueued && current.QueuePosition > 0 {
		if err := lockScanQueue(ctx, transaction); err != nil {
			return Task{}, err
		}
		var liveStatus Status
		var liveQueuePosition int
		if err := transaction.QueryRowContext(ctx, `
			SELECT status, queue_position FROM scan_tasks WHERE id = ? FOR UPDATE`, id).Scan(&liveStatus, &liveQueuePosition); err != nil {
			return Task{}, err
		}
		if liveStatus == StatusQueued && liveQueuePosition > 0 {
			if _, err := transaction.ExecContext(ctx, `
				INSERT INTO scan_task_logs (scan_task_id, level, stage, progress, message)
				SELECT id, 'info', stage, progress, CONCAT('队列位次已更新，当前排队第 ', queue_position - 1, ' 位')
				FROM scan_tasks
				WHERE source = 'platform' AND status = 'queued' AND `+scanLevelSQL+` = ? AND queue_position > ?`, current.ScanConfiguration.ScanLevel, liveQueuePosition); err != nil {
				return Task{}, err
			}
			if _, err := transaction.ExecContext(ctx, `
				UPDATE scan_tasks SET
					status_message = CONCAT('任务等待执行，当前排队第 ', queue_position - 1, ' 位'),
					queue_position = queue_position - 1
				WHERE source = 'platform' AND status = 'queued' AND `+scanLevelSQL+` = ? AND queue_position > ?`, current.ScanConfiguration.ScanLevel, liveQueuePosition); err != nil {
				return Task{}, err
			}
			if _, err := transaction.ExecContext(ctx, `UPDATE scan_queue_state SET revision = revision + 1 WHERE id = 1`); err != nil {
				return Task{}, err
			}
		}
	}
	result, err := transaction.ExecContext(ctx, `
			UPDATE scan_tasks SET status = ?, stage = ?, progress = ?, status_message = ?,
				queue_position = CASE WHEN ? = 'queued' THEN queue_position ELSE 0 END,
				completed_at = CASE WHEN completed_at IS NULL AND ? IN ('completed', 'partial') THEN CURRENT_TIMESTAMP(6) ELSE completed_at END
			WHERE id = ?`, input.Status, input.Stage, input.Progress, input.StatusMessage, input.Status, input.Status, id)
	if err != nil {
		return Task{}, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return Task{}, err
		}
		return Task{}, sql.ErrNoRows
	}
	level := "info"
	if input.Status == StatusFailed {
		level = "error"
	} else if input.Status == StatusCompleted {
		level = "success"
	} else if input.Status == StatusPartial || input.Status == StatusCancelled {
		level = "warning"
	}
	if err := appendTaskLog(ctx, transaction, id, level, input.Stage, input.Progress, input.StatusMessage); err != nil {
		return Task{}, err
	}
	if err := transaction.Commit(); err != nil {
		return Task{}, err
	}
	return repository.Get(ctx, id)
}

func settleCredits(ctx context.Context, transaction *sql.Tx, task Task) error {
	credits := uint64(task.EstimatedCredits)
	var available uint64
	var frozen uint64
	if err := transaction.QueryRowContext(ctx, `SELECT available, frozen FROM credit_accounts WHERE user_id = ? FOR UPDATE`, task.ActorID).Scan(&available, &frozen); err != nil {
		return err
	}
	if frozen < credits {
		return fmt.Errorf("settle scan credits: frozen balance %d is less than charge %d", frozen, credits)
	}
	if _, err := transaction.ExecContext(ctx, `
		UPDATE credit_accounts SET frozen = frozen - ?, lifetime_used = lifetime_used + ?
		WHERE user_id = ? AND frozen >= ?`, credits, credits, task.ActorID, credits); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE scan_tasks SET charged_credits = ? WHERE id = ?`, task.EstimatedCredits, task.ID); err != nil {
		return err
	}
	transactionID, err := repositoryID()
	if err != nil {
		return err
	}
	_, err = transaction.ExecContext(ctx, `
		INSERT INTO credit_transactions (id, user_id, scan_task_id, type, amount, balance_after, description)
		VALUES (?, ?, ?, 'settlement', ?, ?, ?)`, transactionID, task.ActorID, task.ID, -int64(credits), available, task.ProjectName+" scan settlement")
	return err
}

func refundCredits(ctx context.Context, transaction *sql.Tx, task Task) error {
	credits := uint64(task.EstimatedCredits)
	var available uint64
	var frozen uint64
	if err := transaction.QueryRowContext(ctx, `SELECT available, frozen FROM credit_accounts WHERE user_id = ? FOR UPDATE`, task.ActorID).Scan(&available, &frozen); err != nil {
		return err
	}
	if frozen < credits {
		return fmt.Errorf("refund scan credits: frozen balance %d is less than refund %d", frozen, credits)
	}
	if _, err := transaction.ExecContext(ctx, `
		UPDATE credit_accounts SET available = available + ?, frozen = frozen - ?
		WHERE user_id = ? AND frozen >= ?`, credits, credits, task.ActorID, credits); err != nil {
		return err
	}
	transactionID, err := repositoryID()
	if err != nil {
		return err
	}
	_, err = transaction.ExecContext(ctx, `
		INSERT INTO credit_transactions (id, user_id, scan_task_id, type, amount, balance_after, description)
		VALUES (?, ?, ?, 'refund', ?, ?, ?)`, transactionID, task.ActorID, task.ID, int64(credits), available+credits, task.ProjectName+" scan refund")
	return err
}
