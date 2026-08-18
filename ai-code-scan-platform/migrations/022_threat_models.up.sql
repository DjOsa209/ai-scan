CREATE TABLE threat_models (
    id CHAR(36) NOT NULL,
    actor_id CHAR(36) NOT NULL,
    title VARCHAR(200) NOT NULL,
    status ENUM('draft', 'running', 'completed', 'failed', 'stopped') NOT NULL DEFAULT 'draft',
    configuration MEDIUMTEXT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY ix_threat_models_actor_created (actor_id, created_at),
    CONSTRAINT fk_threat_models_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE threat_model_runs (
    id CHAR(36) NOT NULL,
    threat_model_id CHAR(36) NOT NULL,
    status ENUM('running', 'completed', 'failed', 'stopped') NOT NULL,
    stage VARCHAR(120) NOT NULL,
    progress INT NOT NULL DEFAULT 0,
    status_message VARCHAR(500) NOT NULL DEFAULT '',
    configuration MEDIUMTEXT NOT NULL,
    result MEDIUMTEXT NULL,
    error_message VARCHAR(1000) NOT NULL DEFAULT '',
    started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    completed_at TIMESTAMP(6) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY ix_threat_model_runs_model_created (threat_model_id, created_at),
    CONSTRAINT fk_threat_model_runs_model FOREIGN KEY (threat_model_id) REFERENCES threat_models(id) ON DELETE CASCADE
);
