DROP TABLE IF EXISTS scan_task_logs;

ALTER TABLE scan_tasks
    DROP COLUMN scan_configuration;
