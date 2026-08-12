ALTER TABLE users
    DROP INDEX uq_users_external_identity,
    DROP COLUMN last_login_at,
    DROP COLUMN department,
    DROP COLUMN employee_no,
    DROP COLUMN display_name,
    DROP COLUMN external_subject,
    DROP COLUMN auth_provider;