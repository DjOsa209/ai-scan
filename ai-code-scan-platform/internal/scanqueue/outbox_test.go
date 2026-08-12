package scanqueue

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestOutboxClaimAndPublishLifecycle(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewOutboxRepository(database)

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id, scan_task_id, payload, attempts").
		WillReturnRows(sqlmock.NewRows([]string{"id", "scan_task_id", "payload", "attempts"}).AddRow("outbox-1", "scan-1", []byte(`{"eventType":"scan.requested"}`), 0))
	mock.ExpectExec("UPDATE scan_dispatch_outbox").WithArgs(1, "outbox-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	item, err := repository.ClaimNext(context.Background())
	if err != nil || item.Attempts != 1 || item.ScanTaskID != "scan-1" {
		t.Fatalf("unexpected claimed item %#v: %v", item, err)
	}

	mock.ExpectBegin()
	mock.ExpectExec("UPDATE scan_dispatch_outbox").WithArgs("outbox-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO scan_task_logs").WithArgs("scan-1").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	if err := repository.MarkPublished(context.Background(), item); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOutboxFailureSchedulesRetry(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository := NewOutboxRepository(database)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE scan_dispatch_outbox")).
		WithArgs("broker unavailable", 4, "outbox-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	if err := repository.MarkFailed(context.Background(), OutboxItem{ID: "outbox-1", Attempts: 2}, errors.New("broker unavailable")); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
