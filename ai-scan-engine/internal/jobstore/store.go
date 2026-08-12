package jobstore

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type Store struct{ database *sql.DB }

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, err
	}
	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if _, err = database.Exec(`CREATE TABLE IF NOT EXISTS jobs (
		event_id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, payload BLOB NOT NULL,
		status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
		last_error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		database.Close()
		return nil, fmt.Errorf("initialize job store: %w", err)
	}
	return &Store{database: database}, nil
}

func (store *Store) Receive(ctx context.Context, eventID, taskID string, payload []byte) (string, error) {
	_, err := store.database.ExecContext(ctx, `INSERT INTO jobs(event_id, task_id, payload, status) VALUES(?, ?, ?, 'received') ON CONFLICT DO NOTHING`, eventID, taskID, payload)
	if err != nil {
		return "", fmt.Errorf("persist received job: %w", err)
	}
	var status string
	if err := store.database.QueryRowContext(ctx, `SELECT status FROM jobs WHERE task_id = ?`, taskID).Scan(&status); err != nil {
		return "", err
	}
	return status, nil
}

func (store *Store) Progress(ctx context.Context, taskID string) (int, error) {
	var progress int
	err := store.database.QueryRowContext(ctx, `SELECT progress FROM jobs WHERE task_id = ?`, taskID).Scan(&progress)
	return progress, err
}

func (store *Store) SetStatus(ctx context.Context, taskID, status string, progress int, processingError error) error {
	message := ""
	if processingError != nil {
		message = processingError.Error()
	}
	_, err := store.database.ExecContext(ctx, `UPDATE jobs SET status = ?, progress = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?`, status, progress, message, taskID)
	return err
}

func (store *Store) Close() error { return store.database.Close() }
