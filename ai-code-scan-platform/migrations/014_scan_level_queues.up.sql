UPDATE scan_tasks
SET scan_configuration = JSON_SET(
    COALESCE(scan_configuration, JSON_OBJECT()),
    '$.scanLevel',
    CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(scan_configuration, '$.mode')) = 'deep' THEN 'release'
        ELSE 'standard'
    END
)
WHERE JSON_EXTRACT(scan_configuration, '$.scanLevel') IS NULL;

UPDATE scan_tasks AS task
JOIN (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY JSON_UNQUOTE(JSON_EXTRACT(scan_configuration, '$.scanLevel'))
               ORDER BY CASE JSON_UNQUOTE(JSON_EXTRACT(scan_configuration, '$.priority')) WHEN 'urgent' THEN 0 ELSE 1 END,
                        created_at,
                        id
           ) AS position
    FROM scan_tasks
    WHERE source = 'platform' AND status = 'queued'
) AS ranked ON ranked.id = task.id
SET task.queue_position = ranked.position,
    task.status_message = CONCAT('任务等待执行，当前排队第 ', ranked.position, ' 位');

UPDATE scan_dispatch_outbox AS outbox
JOIN scan_tasks AS task ON task.id = outbox.scan_task_id
SET outbox.payload = JSON_SET(
    outbox.payload,
    '$.task.scanLevel', JSON_UNQUOTE(JSON_EXTRACT(task.scan_configuration, '$.scanLevel')),
    '$.task.scanConfiguration.scanLevel', JSON_UNQUOTE(JSON_EXTRACT(task.scan_configuration, '$.scanLevel')),
    '$.task.queuePosition', task.queue_position
)
WHERE outbox.published_at IS NULL;

