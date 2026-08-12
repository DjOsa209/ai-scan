DROP TABLE IF EXISTS scan_dispatch_outbox;
DROP TABLE IF EXISTS scan_queue_state;

ALTER TABLE scan_tasks
    DROP COLUMN report_id,
    DROP COLUMN queue_position;

