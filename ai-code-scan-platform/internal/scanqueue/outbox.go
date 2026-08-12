package scanqueue

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"time"
)

type OutboxItem struct {
	ID         string
	ScanTaskID string
	Payload    []byte
	Attempts   int
}

type OutboxRepository struct {
	database *sql.DB
}

func NewOutboxRepository(database *sql.DB) *OutboxRepository {
	return &OutboxRepository{database: database}
}

func (repository *OutboxRepository) ClaimNext(ctx context.Context) (OutboxItem, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return OutboxItem{}, err
	}
	defer transaction.Rollback()
	var item OutboxItem
	err = transaction.QueryRowContext(ctx, `
		SELECT id, scan_task_id, payload, attempts
		FROM scan_dispatch_outbox
		WHERE published_at IS NULL AND next_attempt_at <= CURRENT_TIMESTAMP(6)
		ORDER BY created_at, id
		LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&item.ID, &item.ScanTaskID, &item.Payload, &item.Attempts)
	if err != nil {
		return OutboxItem{}, err
	}
	item.Attempts++
	if _, err := transaction.ExecContext(ctx, `
		UPDATE scan_dispatch_outbox
		SET attempts = ?, next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 30 SECOND)
		WHERE id = ?`, item.Attempts, item.ID); err != nil {
		return OutboxItem{}, err
	}
	if err := transaction.Commit(); err != nil {
		return OutboxItem{}, err
	}
	return item, nil
}

func (repository *OutboxRepository) MarkPublished(ctx context.Context, item OutboxItem) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer transaction.Rollback()
	result, err := transaction.ExecContext(ctx, `
		UPDATE scan_dispatch_outbox
		SET published_at = CURRENT_TIMESTAMP(6), last_error = NULL
		WHERE id = ? AND published_at IS NULL`, item.ID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 1 {
		if _, err := transaction.ExecContext(ctx, `
			INSERT INTO scan_task_logs (scan_task_id, level, stage, progress, message)
			SELECT id, 'info', stage, progress,
				CASE WHEN queue_position > 0
					THEN CONCAT('任务已发送至扫描中心，当前排队第 ', queue_position, ' 位')
					ELSE '任务已发送至扫描中心' END
			FROM scan_tasks WHERE id = ?`, item.ScanTaskID); err != nil {
			return err
		}
	}
	return transaction.Commit()
}

func (repository *OutboxRepository) MarkFailed(ctx context.Context, item OutboxItem, publishErr error) error {
	delaySeconds := int(math.Min(300, math.Pow(2, float64(min(item.Attempts, 8)))))
	message := publishErr.Error()
	if len(message) > 1000 {
		message = message[:1000]
	}
	_, err := repository.database.ExecContext(ctx, `
		UPDATE scan_dispatch_outbox
		SET last_error = ?, next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND)
		WHERE id = ? AND published_at IS NULL`, message, delaySeconds, item.ID)
	if err != nil {
		return fmt.Errorf("record queue publish failure: %w", err)
	}
	return nil
}

func (repository *OutboxRepository) WaitForPending(ctx context.Context, interval time.Duration) bool {
	timer := time.NewTimer(interval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
