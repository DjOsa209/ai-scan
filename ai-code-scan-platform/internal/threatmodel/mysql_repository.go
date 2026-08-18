package threatmodel

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

var (
	ErrNotFound       = errors.New("threat model not found")
	ErrAlreadyRunning = errors.New("threat model already has a running analysis")
)

type Repository interface {
	CreateModel(context.Context, Model) error
	ListModels(context.Context, string) ([]Model, error)
	GetModel(context.Context, string, string) (Model, error)
	CreateRun(context.Context, Run) error
	CompleteRun(context.Context, string, Result, time.Time) error
	FailRun(context.Context, string, string, time.Time) error
	UpdateRunResult(context.Context, string, Result) error
}

type MySQLRepository struct {
	database *sql.DB
}

func NewMySQLRepository(database *sql.DB) *MySQLRepository {
	return &MySQLRepository{database: database}
}

func (repository *MySQLRepository) CreateModel(ctx context.Context, model Model) error {
	configuration, err := json.Marshal(model.Configuration)
	if err != nil {
		return err
	}
	_, err = repository.database.ExecContext(ctx, `
		INSERT INTO threat_models (id, actor_id, title, status, configuration)
		VALUES (?, ?, ?, ?, ?)`, model.ID, model.ActorID, model.Title, model.Status, configuration)
	return err
}

func (repository *MySQLRepository) ListModels(ctx context.Context, actorID string) ([]Model, error) {
	rows, err := repository.database.QueryContext(ctx, `
		SELECT id, actor_id, title, status, configuration, created_at, updated_at
		FROM threat_models WHERE actor_id = ? ORDER BY created_at DESC`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	models := []Model{}
	for rows.Next() {
		model, err := scanModel(rows)
		if err != nil {
			return nil, err
		}
		if err := repository.attachRuns(ctx, &model); err != nil {
			return nil, err
		}
		models = append(models, model)
	}
	return models, rows.Err()
}

func (repository *MySQLRepository) GetModel(ctx context.Context, id, actorID string) (Model, error) {
	row := repository.database.QueryRowContext(ctx, `
		SELECT id, actor_id, title, status, configuration, created_at, updated_at
		FROM threat_models WHERE id = ? AND actor_id = ?`, id, actorID)
	model, err := scanModel(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Model{}, ErrNotFound
	}
	if err != nil {
		return Model{}, err
	}
	if err := repository.attachRuns(ctx, &model); err != nil {
		return Model{}, err
	}
	return model, nil
}

func (repository *MySQLRepository) CreateRun(ctx context.Context, run Run) error {
	configuration, err := json.Marshal(run.Configuration)
	if err != nil {
		return err
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer transaction.Rollback()
	var status ModelStatus
	if err := transaction.QueryRowContext(ctx, `SELECT status FROM threat_models WHERE id = ? FOR UPDATE`, run.ModelID).Scan(&status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status == ModelRunning {
		return ErrAlreadyRunning
	}
	if _, err := transaction.ExecContext(ctx, `
		INSERT INTO threat_model_runs (id, threat_model_id, status, stage, progress, status_message, configuration, started_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, run.ID, run.ModelID, run.Status, run.Stage, run.Progress, run.StatusMessage, configuration, run.StartedAt); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE threat_models SET status = 'running' WHERE id = ?`, run.ModelID); err != nil {
		return err
	}
	return transaction.Commit()
}

func (repository *MySQLRepository) CompleteRun(ctx context.Context, runID string, result Result, completedAt time.Time) error {
	return repository.finishRun(ctx, runID, RunCompleted, result, "", completedAt)
}

func (repository *MySQLRepository) FailRun(ctx context.Context, runID, message string, completedAt time.Time) error {
	return repository.finishRun(ctx, runID, RunFailed, Result{}, message, completedAt)
}

func (repository *MySQLRepository) finishRun(ctx context.Context, runID string, status RunStatus, result Result, errorMessage string, completedAt time.Time) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer transaction.Rollback()
	var modelID string
	if err := transaction.QueryRowContext(ctx, `SELECT threat_model_id FROM threat_model_runs WHERE id = ? FOR UPDATE`, runID).Scan(&modelID); err != nil {
		return err
	}
	var resultJSON any
	if status == RunCompleted {
		encoded, err := json.Marshal(result)
		if err != nil {
			return err
		}
		resultJSON = encoded
	}
	stage, progress, message, modelStatus := "分析失败", 100, errorMessage, ModelFailed
	if status == RunCompleted {
		stage, progress, message, modelStatus = "分析完成", 100, "威胁模型已生成", ModelCompleted
	}
	if _, err := transaction.ExecContext(ctx, `
		UPDATE threat_model_runs SET status = ?, stage = ?, progress = ?, status_message = ?, result = ?, error_message = ?, completed_at = ?
		WHERE id = ?`, status, stage, progress, message, resultJSON, errorMessage, completedAt, runID); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE threat_models SET status = ? WHERE id = ?`, modelStatus, modelID); err != nil {
		return err
	}
	return transaction.Commit()
}

func (repository *MySQLRepository) UpdateRunResult(ctx context.Context, runID string, result Result) error {
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	updated, err := repository.database.ExecContext(ctx, `UPDATE threat_model_runs SET result = ? WHERE id = ? AND status = 'completed'`, encoded, runID)
	if err != nil {
		return err
	}
	affected, err := updated.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrNotFound
	}
	return nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanModel(row rowScanner) (Model, error) {
	var model Model
	var configuration []byte
	err := row.Scan(&model.ID, &model.ActorID, &model.Title, &model.Status, &configuration, &model.CreatedAt, &model.UpdatedAt)
	if err != nil {
		return Model{}, err
	}
	if err := json.Unmarshal(configuration, &model.Configuration); err != nil {
		return Model{}, fmt.Errorf("decode threat model configuration: %w", err)
	}
	return model, nil
}

func (repository *MySQLRepository) attachRuns(ctx context.Context, model *Model) error {
	rows, err := repository.database.QueryContext(ctx, `
		SELECT id, threat_model_id, status, stage, progress, status_message, configuration, result, error_message, started_at, completed_at
		FROM threat_model_runs WHERE threat_model_id = ? ORDER BY created_at DESC`, model.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	model.Runs = []RunSummary{}
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return err
		}
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
	return rows.Err()
}

func scanRun(row rowScanner) (Run, error) {
	var run Run
	var configuration []byte
	var result sql.NullString
	var completedAt sql.NullTime
	if err := row.Scan(&run.ID, &run.ModelID, &run.Status, &run.Stage, &run.Progress, &run.StatusMessage, &configuration, &result, &run.ErrorMessage, &run.StartedAt, &completedAt); err != nil {
		return Run{}, err
	}
	if err := json.Unmarshal(configuration, &run.Configuration); err != nil {
		return Run{}, fmt.Errorf("decode threat model run configuration: %w", err)
	}
	if result.Valid && result.String != "" {
		var decoded Result
		if err := json.Unmarshal([]byte(result.String), &decoded); err != nil {
			return Run{}, fmt.Errorf("decode threat model result: %w", err)
		}
		run.Result = &decoded
	}
	if completedAt.Valid {
		run.CompletedAt = &completedAt.Time
	}
	return run, nil
}
