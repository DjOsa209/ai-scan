ALTER TABLE users
    ADD COLUMN auth_provider VARCHAR(32) NOT NULL DEFAULT 'local',
    ADD COLUMN external_subject VARCHAR(255) NULL,
    ADD COLUMN display_name VARCHAR(160) NOT NULL DEFAULT '',
    ADD COLUMN employee_no VARCHAR(80) NOT NULL DEFAULT '',
    ADD COLUMN department VARCHAR(160) NOT NULL DEFAULT '',
    ADD COLUMN last_login_at TIMESTAMP(6) NULL,
    ADD UNIQUE KEY uq_users_external_identity (auth_provider, external_subject);