CREATE TABLE users (
    id CHAR(36) NOT NULL,
    email VARCHAR(320) NOT NULL,
    password_hash VARCHAR(60) NOT NULL,
    role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
);

CREATE TABLE user_sessions (
    token_hash BINARY(32) NOT NULL,
    user_id CHAR(36) NOT NULL,
    expires_at TIMESTAMP(6) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (token_hash),
    KEY ix_user_sessions_user (user_id),
    KEY ix_user_sessions_expires (expires_at),
    CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE credit_accounts (
    user_id CHAR(36) NOT NULL,
    available BIGINT UNSIGNED NOT NULL DEFAULT 0,
    frozen BIGINT UNSIGNED NOT NULL DEFAULT 0,
    lifetime_used BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id),
    CONSTRAINT fk_credit_accounts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE credit_transactions (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    scan_task_id CHAR(36) NULL,
    type ENUM('grant', 'freeze', 'settlement', 'refund', 'adjustment') NOT NULL,
    amount BIGINT NOT NULL,
    balance_after BIGINT UNSIGNED NOT NULL,
    description VARCHAR(500) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY ix_credit_transactions_user_created (user_id, created_at),
    KEY ix_credit_transactions_scan (scan_task_id),
    CONSTRAINT fk_credit_transactions_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_credit_transactions_scan FOREIGN KEY (scan_task_id) REFERENCES scan_tasks(id)
);