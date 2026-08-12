ALTER TABLE scan_tasks
    ADD COLUMN source_snapshot MEDIUMTEXT NULL AFTER report_markdown;