ALTER TABLE scan_tasks
    ADD COLUMN creator_name VARCHAR(160) NOT NULL DEFAULT '' AFTER actor_id,
    ADD COLUMN creator_employee_no VARCHAR(80) NOT NULL DEFAULT '' AFTER creator_name;

UPDATE scan_tasks AS tasks
JOIN users ON users.id = tasks.actor_id
SET tasks.creator_name = users.display_name,
    tasks.creator_employee_no = users.employee_no
WHERE tasks.source = 'platform';