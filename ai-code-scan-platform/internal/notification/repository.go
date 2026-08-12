package notification

import (
	"context"
	"database/sql"
)

type Repository struct {
	database *sql.DB
}

type Target struct {
	Email                string
	ApplicationEnabled   bool
	WebhookEnabled       bool
	WebhookURLCiphertext string
}

func NewRepository(database *sql.DB) *Repository {
	return &Repository{database: database}
}

func (repository *Repository) TargetForUser(ctx context.Context, userID string) (Target, error) {
	var target Target
	var ciphertext sql.NullString
	err := repository.database.QueryRowContext(ctx, `
		SELECT users.email, COALESCE(preferences.application_enabled, TRUE), COALESCE(preferences.webhook_enabled, FALSE), preferences.webhook_url_ciphertext
		FROM users
		LEFT JOIN user_notification_preferences AS preferences ON preferences.user_id = users.id
		WHERE users.id = ? AND users.active = TRUE`, userID).
		Scan(&target.Email, &target.ApplicationEnabled, &target.WebhookEnabled, &ciphertext)
	target.WebhookURLCiphertext = ciphertext.String
	return target, err
}

func (repository *Repository) SavePreference(ctx context.Context, userID string, applicationEnabled, webhookEnabled bool, ciphertext string) error {
	_, err := repository.database.ExecContext(ctx, `
		INSERT INTO user_notification_preferences (user_id, application_enabled, webhook_enabled, webhook_url_ciphertext)
		VALUES (?, ?, ?, NULLIF(?, ''))
		ON DUPLICATE KEY UPDATE
			application_enabled = VALUES(application_enabled),
			webhook_enabled = VALUES(webhook_enabled),
			webhook_url_ciphertext = COALESCE(VALUES(webhook_url_ciphertext), webhook_url_ciphertext)`,
		userID, applicationEnabled, webhookEnabled, ciphertext)
	return err
}
