CREATE TABLE scan_source_archives (
    scan_task_id CHAR(36) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    content LONGBLOB NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_scan_source_archives_task
        FOREIGN KEY (scan_task_id) REFERENCES scan_tasks(id) ON DELETE CASCADE
);