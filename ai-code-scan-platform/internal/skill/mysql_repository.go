package skill

import (
	"context"
	"database/sql"
	"fmt"
)

type MySQLRepository struct {
	database *sql.DB
}

func NewMySQLRepository(database *sql.DB) *MySQLRepository {
	return &MySQLRepository{database: database}
}

func (repository *MySQLRepository) CreateSource(ctx context.Context, input CreateSourceInput) (Source, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return Source{}, err
	}
	defer transaction.Rollback()

	if input.IsDefault {
		if _, err := transaction.ExecContext(ctx, "UPDATE skill_sources SET is_default = FALSE WHERE is_default = TRUE"); err != nil {
			return Source{}, err
		}
	}
	result, err := transaction.ExecContext(ctx, `
		INSERT INTO skill_sources (name, source_url, enabled, is_default)
		VALUES (?, ?, TRUE, ?)`, input.Name, input.SourceURL, input.IsDefault)
	if err != nil {
		return Source{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return Source{}, err
	}
	if err := transaction.Commit(); err != nil {
		return Source{}, err
	}
	return repository.GetSource(ctx, id)
}

func (repository *MySQLRepository) GetSource(ctx context.Context, id int64) (Source, error) {
	var source Source
	err := repository.database.QueryRowContext(ctx, `
		SELECT id, name, source_url, enabled, is_default, created_at, updated_at
		FROM skill_sources WHERE id = ?`, id).Scan(
		&source.ID, &source.Name, &source.SourceURL, &source.Enabled,
		&source.IsDefault, &source.CreatedAt, &source.UpdatedAt,
	)
	return source, err
}

func (repository *MySQLRepository) SaveVersion(ctx context.Context, sourceID int64, hash, content string) (Version, error) {
	versionName := hash[:12]
	_, err := repository.database.ExecContext(ctx, `
		INSERT INTO skill_versions (source_id, version, sha256, content)
		VALUES (?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE content = VALUES(content)`, sourceID, versionName, hash, content)
	if err != nil {
		return Version{}, err
	}

	var version Version
	err = repository.database.QueryRowContext(ctx, `
		SELECT id, source_id, version, sha256, content, fetched_at
		FROM skill_versions WHERE source_id = ? AND sha256 = ?`, sourceID, hash).Scan(
		&version.ID, &version.SourceID, &version.Version, &version.SHA256,
		&version.Content, &version.FetchedAt,
	)
	return version, err
}

func (repository *MySQLRepository) ResolveDefault(ctx context.Context) (Source, Version, error) {
	var source Source
	var version Version
	err := repository.database.QueryRowContext(ctx, `
		SELECT s.id, s.name, s.source_url, s.enabled, s.is_default, s.created_at, s.updated_at,
		       v.id, v.source_id, v.version, v.sha256, v.content, v.fetched_at
		FROM skill_sources s
		JOIN skill_versions v ON v.source_id = s.id
		WHERE s.enabled = TRUE AND s.is_default = TRUE
		ORDER BY v.fetched_at DESC, v.id DESC
		LIMIT 1`).Scan(
		&source.ID, &source.Name, &source.SourceURL, &source.Enabled,
		&source.IsDefault, &source.CreatedAt, &source.UpdatedAt,
		&version.ID, &version.SourceID, &version.Version, &version.SHA256,
		&version.Content, &version.FetchedAt,
	)
	if err != nil {
		return Source{}, Version{}, fmt.Errorf("resolve default skill: %w", err)
	}
	return source, version, nil
}
