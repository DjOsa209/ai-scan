ALTER TABLE scan_tasks
    ADD COLUMN scanned_files INT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN code_lines INT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN finding_count INT UNSIGNED NOT NULL DEFAULT 0;

UPDATE scan_tasks
SET scanned_files = COALESCE(JSON_LENGTH(JSON_EXTRACT(report_markdown, '$.coverage.checked')), 0),
    finding_count = COALESCE(JSON_LENGTH(JSON_EXTRACT(report_markdown, '$.findings')), 0)
WHERE report_markdown IS NOT NULL AND JSON_VALID(report_markdown);

UPDATE scan_tasks
SET code_lines = COALESCE((
    SELECT SUM(CASE
        WHEN snapshot_file.content = '' THEN 0
        ELSE 1 + LENGTH(snapshot_file.content) - LENGTH(REPLACE(snapshot_file.content, '\n', ''))
    END)
    FROM JSON_TABLE(
        source_snapshot,
        '$.files[*]' COLUMNS(content LONGTEXT PATH '$.content')
    ) AS snapshot_file
), 0)
WHERE source_snapshot IS NOT NULL AND JSON_VALID(source_snapshot);