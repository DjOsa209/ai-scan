package auth

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type Repository struct {
	database *sql.DB
}

func NewRepository(database *sql.DB) *Repository {
	return &Repository{database: database}
}

func (repository *Repository) BootstrapAdmin(ctx context.Context, user storedUser, credits uint64, transactionID string) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer transaction.Rollback()

	var existingID string
	err = transaction.QueryRowContext(ctx, `SELECT id FROM users WHERE email = ?`, user.Email).Scan(&existingID)
	if err == nil {
		return transaction.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err = transaction.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')`,
		user.ID, user.Email, user.PasswordHash); err != nil {
		return err
	}
	if _, err = transaction.ExecContext(ctx, `
		INSERT INTO credit_accounts (user_id, available) VALUES (?, ?)`, user.ID, credits); err != nil {
		return err
	}
	if credits > 0 {
		if _, err = transaction.ExecContext(ctx, `
			INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, description)
			VALUES (?, ?, 'grant', ?, ?, 'Bootstrap administrator credits')`,
			transactionID, user.ID, credits, credits); err != nil {
			return err
		}
	}
	return transaction.Commit()
}

func (repository *Repository) UserByEmail(ctx context.Context, email string) (storedUser, error) {
	var user storedUser
	err := repository.database.QueryRowContext(ctx, `
		SELECT id, email, role, created_at, password_hash FROM users WHERE email = ? AND active = TRUE`, email).
		Scan(&user.ID, &user.Email, &user.Role, &user.CreatedAt, &user.PasswordHash)
	return user, err
}

func (repository *Repository) UserCredentialsByID(ctx context.Context, userID string) (storedUser, error) {
	var user storedUser
	err := repository.database.QueryRowContext(ctx, `
		SELECT id, email, role, created_at, password_hash FROM users WHERE id = ?`, userID).
		Scan(&user.ID, &user.Email, &user.Role, &user.CreatedAt, &user.PasswordHash)
	return user, err
}

func (repository *Repository) UpdateAdminPasswordHash(ctx context.Context, userID, passwordHash string) error {
	result, err := repository.database.ExecContext(ctx, `
		UPDATE users SET password_hash = ? WHERE id = ? AND role = 'admin'`, passwordHash, userID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (repository *Repository) CreateSession(ctx context.Context, tokenHash []byte, userID string, expiresAt time.Time) error {
	_, err := repository.database.ExecContext(ctx, `
		INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`, tokenHash, userID, expiresAt)
	return err
}

func (repository *Repository) UserBySession(ctx context.Context, tokenHash []byte, now time.Time) (User, error) {
	var user User
	err := repository.database.QueryRowContext(ctx, `
		SELECT users.id, users.email, users.role, users.display_name, users.employee_no, users.department,
		       users.auth_provider, users.created_at, users.last_login_at
		FROM user_sessions JOIN users ON users.id = user_sessions.user_id
		WHERE user_sessions.token_hash = ? AND user_sessions.expires_at > ? AND users.active = TRUE`, tokenHash, now).
		Scan(&user.ID, &user.Email, &user.Role, &user.Name, &user.EmployeeNo, &user.Department,
			&user.AuthProvider, &user.CreatedAt, &user.LastLoginAt)
	return user, err
}

func (repository *Repository) UserByAPIKey(ctx context.Context, keyHash []byte) (User, error) {
	var user User
	err := repository.database.QueryRowContext(ctx, `
		SELECT users.id, users.email, users.role, users.created_at
		FROM user_api_keys JOIN users ON users.id = user_api_keys.user_id
		WHERE user_api_keys.key_hash = ? AND users.active = TRUE`, keyHash).
		Scan(&user.ID, &user.Email, &user.Role, &user.CreatedAt)
	return user, err
}

func (repository *Repository) ListUserAPIKeyStatuses(ctx context.Context) ([]UserAPIKeyStatus, error) {
	rows, err := repository.database.QueryContext(ctx, `
		SELECT users.id, users.email, users.role, users.active, users.created_at, user_api_keys.key_prefix, user_api_keys.key_encrypted, user_api_keys.updated_at,
		       users.display_name, users.employee_no, users.department, users.auth_provider, users.last_login_at
		FROM users LEFT JOIN user_api_keys ON user_api_keys.user_id = users.id
		ORDER BY users.created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	statuses := make([]UserAPIKeyStatus, 0)
	for rows.Next() {
		var status UserAPIKeyStatus
		var prefix sql.NullString
		var encrypted sql.NullString
		var updatedAt sql.NullTime
		if err := rows.Scan(&status.UserID, &status.Email, &status.Role, &status.Active, &status.CreatedAt, &prefix, &encrypted, &updatedAt, &status.Name, &status.EmployeeNo, &status.Department, &status.AuthProvider, &status.LastLoginAt); err != nil {
			return nil, err
		}
		status.Configured = prefix.Valid
		status.KeyPrefix = prefix.String
		status.keyEncrypted = encrypted.String
		if updatedAt.Valid {
			status.UpdatedAt = &updatedAt.Time
		}
		statuses = append(statuses, status)
	}
	return statuses, rows.Err()
}

func (repository *Repository) EnsureSSOUser(ctx context.Context, userID, passwordHash string, identity SSOIdentity, now time.Time) (User, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer transaction.Rollback()
	_, err = transaction.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, role, auth_provider, external_subject, display_name, employee_no, department, last_login_at)
		VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE email = VALUES(email), auth_provider = VALUES(auth_provider), external_subject = VALUES(external_subject),
			display_name = VALUES(display_name), employee_no = VALUES(employee_no),
			department = VALUES(department), last_login_at = VALUES(last_login_at), active = TRUE`,
		userID, identity.Email, passwordHash, identity.Provider, identity.Subject, identity.Name, identity.EmployeeNo, identity.Department, now)
	if err != nil {
		return User{}, err
	}
	var user User
	err = transaction.QueryRowContext(ctx, `
		SELECT id, email, role, display_name, employee_no, department, auth_provider, created_at, last_login_at
		FROM users WHERE auth_provider = ? AND external_subject = ?`, identity.Provider, identity.Subject).
		Scan(&user.ID, &user.Email, &user.Role, &user.Name, &user.EmployeeNo, &user.Department, &user.AuthProvider, &user.CreatedAt, &user.LastLoginAt)
	if err != nil {
		return User{}, err
	}
	if _, err = transaction.ExecContext(ctx, `INSERT IGNORE INTO credit_accounts (user_id) VALUES (?)`, user.ID); err != nil {
		return User{}, err
	}
	if err := transaction.Commit(); err != nil {
		return User{}, err
	}
	return user, nil
}

func (repository *Repository) ReplaceAPIKey(ctx context.Context, userID string, keyHash []byte, prefix, encrypted string) error {
	result, err := repository.database.ExecContext(ctx, `
		INSERT INTO user_api_keys (user_id, key_hash, key_prefix, key_encrypted)
		SELECT id, ?, ?, ? FROM users WHERE id = ? AND active = TRUE
		ON DUPLICATE KEY UPDATE key_hash = VALUES(key_hash), key_prefix = VALUES(key_prefix), key_encrypted = VALUES(key_encrypted), updated_at = CURRENT_TIMESTAMP(6)`,
		keyHash, prefix, encrypted, userID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (repository *Repository) EnsureAPIKeyUser(ctx context.Context, user storedUser) (string, error) {
	var existingID string
	err := repository.database.QueryRowContext(ctx, `SELECT id FROM users WHERE email = ?`, user.Email).Scan(&existingID)
	if err == nil {
		return existingID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer transaction.Rollback()
	if _, err = transaction.ExecContext(ctx, `
		INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)`,
		user.ID, user.Email, user.PasswordHash, user.Role); err != nil {
		return "", err
	}
	if _, err = transaction.ExecContext(ctx, `INSERT INTO credit_accounts (user_id) VALUES (?)`, user.ID); err != nil {
		return "", err
	}
	if err := transaction.Commit(); err != nil {
		return "", err
	}
	return user.ID, nil
}

func (repository *Repository) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := repository.database.ExecContext(ctx, `DELETE FROM user_sessions WHERE token_hash = ?`, tokenHash)
	return err
}
