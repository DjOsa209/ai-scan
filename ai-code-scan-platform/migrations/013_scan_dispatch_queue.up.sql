ALTER TABLE scan_tasks
    ADD COLUMN queue_position INT NOT NULL DEFAULT 0 AFTER scan_configuration,
    ADD COLUMN report_id VARCHAR(160) NULL AFTER report_markdown;

CREATE TABLE scan_queue_state (
    id TINYINT UNSIGNED NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id)
);

INSERT INTO scan_queue_state (id, revision) VALUES (1, 0);

UPDATE scan_tasks AS task
JOIN (
    SELECT id,
           ROW_NUMBER() OVER (
               ORDER BY CASE JSON_UNQUOTE(JSON_EXTRACT(scan_configuration, '$.priority')) WHEN 'urgent' THEN 0 ELSE 1 END,
                        created_at,
                        id
           ) AS position
    FROM scan_tasks
    WHERE source = 'platform' AND status = 'queued'
) AS ranked ON ranked.id = task.id
SET task.queue_position = ranked.position,
    task.status_message = CONCAT('任务等待执行，当前排队第 ', ranked.position, ' 位');

CREATE TABLE scan_dispatch_outbox (
    id CHAR(36) NOT NULL,
    scan_task_id CHAR(36) NOT NULL,
    payload JSON NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_error VARCHAR(1000) NULL,
    published_at TIMESTAMP(6) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_scan_dispatch_outbox_task (scan_task_id),
    KEY ix_scan_dispatch_outbox_pending (published_at, next_attempt_at, created_at),
    CONSTRAINT fk_scan_dispatch_outbox_task FOREIGN KEY (scan_task_id) REFERENCES scan_tasks(id) ON DELETE CASCADE
);

INSERT INTO scan_dispatch_outbox (id, scan_task_id, payload)
SELECT UUID(), task.id, JSON_OBJECT(
    'schemaVersion', '1.0',
    'eventId', UUID(),
    'eventType', 'scan.requested',
    'occurredAt', DATE_FORMAT(UTC_TIMESTAMP(6), '%Y-%m-%dT%H:%i:%s.%fZ'),
    'task', JSON_OBJECT(
        'id', task.id,
        'projectName', task.project_name,
        'repositoryUrl', task.repository_url,
        'gitRef', task.git_ref,
        'mode', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(task.scan_configuration, '$.mode')), 'deep'),
        'priority', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(task.scan_configuration, '$.priority')), 'normal'),
        'queuePosition', task.queue_position,
        'scanConfiguration', task.scan_configuration,
        'callbacks', JSON_OBJECT(
            'statusUrl', CONCAT('/api/v1/admin/scans/', task.id),
            'reportUrl', CONCAT('/api/v1/admin/scans/', task.id, '/report'),
            'authType', 'bearer',
            'header', 'Authorization'
        )
    )
)
FROM scan_tasks AS task
WHERE task.source = 'platform' AND task.status = 'queued';
