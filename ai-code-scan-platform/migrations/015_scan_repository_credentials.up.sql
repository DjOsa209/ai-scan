CREATE TABLE scan_repository_credentials (
    scan_task_id CHAR(36) PRIMARY KEY,
    token_ciphertext TEXT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_scan_repository_credentials_task
        FOREIGN KEY (scan_task_id) REFERENCES scan_tasks(id) ON DELETE CASCADE
);