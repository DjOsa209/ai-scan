package jobstore

import (
	"context"
	"path/filepath"
	"testing"
)

func TestReceiveIsIdempotentByTask(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "engine.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	status, err := store.Receive(context.Background(), "event-1", "task-1", []byte("first"))
	if err != nil || status != "received" {
		t.Fatalf("first receive: status=%q err=%v", status, err)
	}
	if err := store.SetStatus(context.Background(), "task-1", "completed", 100, nil); err != nil {
		t.Fatal(err)
	}
	status, err = store.Receive(context.Background(), "event-2", "task-1", []byte("duplicate"))
	if err != nil || status != "completed" {
		t.Fatalf("duplicate receive: status=%q err=%v", status, err)
	}
	progress, err := store.Progress(context.Background(), "task-1")
	if err != nil || progress != 100 {
		t.Fatalf("unexpected progress: progress=%d err=%v", progress, err)
	}
}
