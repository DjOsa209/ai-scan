CREATE TABLE skill_sources (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(160) NOT NULL,
    source_url VARCHAR(2048) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_skill_sources_name (name)
);

CREATE TABLE skill_versions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_id BIGINT UNSIGNED NOT NULL,
    version VARCHAR(64) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    fetched_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_skill_versions_source_hash (source_id, sha256),
    CONSTRAINT fk_skill_versions_source FOREIGN KEY (source_id) REFERENCES skill_sources(id)
);

CREATE TABLE skill_assignments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    scope_type ENUM('default', 'project', 'repository') NOT NULL,
    scope_key VARCHAR(512) NOT NULL,
    source_id BIGINT UNSIGNED NOT NULL,
    priority INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_skill_assignments_scope (scope_type, scope_key, priority),
    CONSTRAINT fk_skill_assignments_source FOREIGN KEY (source_id) REFERENCES skill_sources(id)
);

CREATE TABLE scan_tasks (
    id CHAR(36) NOT NULL,
    project_name VARCHAR(160) NOT NULL,
    repository_url VARCHAR(2048) NOT NULL,
    git_ref VARCHAR(255) NOT NULL,
    skill_source_id BIGINT UNSIGNED NULL,
    status ENUM('queued', 'cloning', 'indexing', 'analyzing', 'normalizing', 'completed', 'partial', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY ix_scan_tasks_status_created (status, created_at),
    CONSTRAINT fk_scan_tasks_skill_source FOREIGN KEY (skill_source_id) REFERENCES skill_sources(id)
);
