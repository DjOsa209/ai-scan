ALTER TABLE scan_tasks
    ADD COLUMN scan_configuration JSON NULL AFTER status_message;

CREATE TABLE scan_task_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    scan_task_id CHAR(36) NOT NULL,
    level ENUM('info', 'success', 'warning', 'error') NOT NULL DEFAULT 'info',
    stage VARCHAR(160) NOT NULL,
    progress INT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY ix_scan_task_logs_task_created (scan_task_id, created_at),
    CONSTRAINT fk_scan_task_logs_task FOREIGN KEY (scan_task_id) REFERENCES scan_tasks(id) ON DELETE CASCADE
);

INSERT INTO scan_task_logs (scan_task_id, level, stage, progress, message, created_at)
SELECT id,
       CASE
           WHEN status = 'failed' THEN 'error'
           WHEN status = 'completed' THEN 'success'
           WHEN status IN ('partial', 'cancelled') THEN 'warning'
           ELSE 'info'
       END,
       stage,
       progress,
       status_message,
       updated_at
FROM scan_tasks
WHERE status_message <> '';
