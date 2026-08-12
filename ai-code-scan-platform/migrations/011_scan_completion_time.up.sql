ALTER TABLE scan_tasks
    ADD COLUMN completed_at TIMESTAMP(6) NULL AFTER updated_at,
    ADD KEY ix_scan_tasks_actor_completed (actor_id, completed_at);

UPDATE scan_tasks
SET completed_at = updated_at
WHERE status IN ('completed', 'partial') AND completed_at IS NULL;
