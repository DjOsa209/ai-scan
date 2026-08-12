ALTER TABLE scan_tasks
    DROP INDEX ix_scan_tasks_actor_completed,
    DROP COLUMN completed_at;
