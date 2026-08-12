ALTER TABLE scan_tasks
    ADD COLUMN source ENUM('plugin', 'platform') NOT NULL DEFAULT 'platform' AFTER skill_source_id,
    ADD COLUMN actor_type ENUM('anonymous', 'user') NOT NULL DEFAULT 'user' AFTER source,
    ADD COLUMN actor_id VARCHAR(160) NULL AFTER actor_type,
    ADD COLUMN billing_mode ENUM('free', 'credit') NOT NULL DEFAULT 'credit' AFTER actor_id,
    ADD COLUMN estimated_credits INT UNSIGNED NOT NULL DEFAULT 0 AFTER billing_mode,
    ADD COLUMN charged_credits INT UNSIGNED NOT NULL DEFAULT 0 AFTER estimated_credits,
    ADD COLUMN report_markdown MEDIUMTEXT NULL AFTER status_message,
    ADD KEY ix_scan_tasks_source_created (source, created_at),
    ADD KEY ix_scan_tasks_actor_created (actor_id, created_at);