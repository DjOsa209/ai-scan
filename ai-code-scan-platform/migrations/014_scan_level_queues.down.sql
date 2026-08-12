UPDATE scan_dispatch_outbox
SET payload = JSON_REMOVE(payload, '$.task.scanLevel', '$.task.scanConfiguration.scanLevel')
WHERE published_at IS NULL;

UPDATE scan_tasks
SET scan_configuration = JSON_REMOVE(scan_configuration, '$.scanLevel')
WHERE JSON_EXTRACT(scan_configuration, '$.scanLevel') IS NOT NULL;

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

