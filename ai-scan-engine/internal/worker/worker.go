package worker

import (
	"context"
	"errors"
	"fmt"
	"log"

	"ai-scan-engine/internal/jobstore"
	"ai-scan-engine/internal/message"
	"ai-scan-engine/internal/platformclient"
	"ai-scan-engine/internal/scanner"
)

type Worker struct {
	store   *jobstore.Store
	scanner *scanner.Scanner
	client  *platformclient.Client
}

func New(store *jobstore.Store, codeScanner *scanner.Scanner, client *platformclient.Client) *Worker {
	return &Worker{store: store, scanner: codeScanner, client: client}
}

func (worker *Worker) Handle(ctx context.Context, payload []byte) error {
	envelope, err := message.Decode(payload)
	if err != nil {
		log.Printf("discard invalid queue message: %v", err)
		return nil
	}
	status, err := worker.store.Receive(ctx, envelope.EventID, envelope.Task.ID, payload)
	if err != nil {
		return err
	}
	if status == "completed" || status == "failed" {
		return nil
	}
	progress, err := worker.store.Progress(ctx, envelope.Task.ID)
	if err != nil {
		return err
	}
	if envelope.Task.Callbacks.RepositoryCredentialURL != "" {
		envelope.Task.RepositoryAuthorization, err = worker.client.GetRepositoryCredential(ctx, envelope.Task.Callbacks.RepositoryCredentialURL)
		if err != nil {
			return fmt.Errorf("get repository credential: %w", err)
		}
	}
	if envelope.Task.Callbacks.ArchiveURL != "" {
		envelope.Task.Archive, err = worker.client.GetArchive(ctx, envelope.Task.Callbacks.ArchiveURL)
		if err != nil {
			return fmt.Errorf("get source archive: %w", err)
		}
	}

	notify := func(status, stage string, nextProgress int, statusMessage string) error {
		if nextProgress <= progress {
			return nil
		}
		update := platformclient.StatusUpdate{Status: status, Stage: stage, Progress: nextProgress, StatusMessage: statusMessage}
		if err := worker.client.Update(ctx, envelope.Task.Callbacks, update); err != nil {
			return err
		}
		progress = nextProgress
		return worker.store.SetStatus(ctx, envelope.Task.ID, status, progress, nil)
	}

	result, err := worker.scanner.Run(ctx, envelope.Task, notify)
	if err != nil {
		callbackErr := worker.client.Update(ctx, envelope.Task.Callbacks, platformclient.StatusUpdate{Status: "failed", Stage: "扫描失败", Progress: progress, StatusMessage: "扫描引擎未能完成任务"})
		if callbackErr == nil {
			_ = worker.store.SetStatus(ctx, envelope.Task.ID, "failed", progress, err)
			return nil
		}
		return errors.Join(fmt.Errorf("scan task: %w", err), callbackErr)
	}
	if err := notify("normalizing", "结果归一化", 90, "正在生成安全扫描报告"); err != nil {
		return err
	}
	if err := worker.client.Upload(ctx, envelope.Task, result); err != nil {
		return err
	}
	finalStatus := "completed"
	if result.Result == "incomplete" {
		finalStatus = "partial"
	}
	if err := notify(finalStatus, "扫描完成", 100, "扫描完成，报告已生成"); err != nil {
		return err
	}
	return worker.store.SetStatus(ctx, envelope.Task.ID, "completed", 100, nil)
}
