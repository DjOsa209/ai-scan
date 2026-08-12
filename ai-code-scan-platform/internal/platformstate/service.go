package platformstate

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

var ErrNotFound = errors.New("platform state not found")

type Snapshot struct {
	Revision uint64          `json:"revision"`
	State    json.RawMessage `json:"state"`
}

type Service struct {
	database *sql.DB
	secrets  SecretCipher
}

type ScanQueueConfiguration struct {
	Enabled             bool   `json:"enabled"`
	Protocol            string `json:"protocol"`
	BrokerURL           string `json:"-"`
	BrokerURLEncrypted  string `json:"brokerUrlEncrypted"`
	Exchange            string `json:"exchange"`
	LiteQueue           string `json:"liteQueue"`
	LiteRoutingKey      string `json:"liteRoutingKey"`
	StandardQueue       string `json:"standardQueue"`
	StandardRoutingKey  string `json:"standardRoutingKey"`
	ReleaseQueue        string `json:"releaseQueue"`
	ReleaseRoutingKey   string `json:"releaseRoutingKey"`
	LiteTopic           string `json:"liteTopic"`
	StandardTopic       string `json:"standardTopic"`
	ReleaseTopic        string `json:"releaseTopic"`
	LiteUrgentTopic     string `json:"liteUrgentTopic"`
	StandardUrgentTopic string `json:"standardUrgentTopic"`
	ReleaseUrgentTopic  string `json:"releaseUrgentTopic"`
}

type FeishuApplicationConfiguration struct {
	AppID              string `json:"appId"`
	AppSecret          string `json:"-"`
	AppSecretEncrypted string `json:"appSecretEncrypted"`
}

func NewService(database *sql.DB, secrets SecretCipher) *Service {
	return &Service{database: database, secrets: secrets}
}

func (service *Service) Get(ctx context.Context, workspaceID string) (Snapshot, error) {
	var snapshot Snapshot
	var state []byte
	err := service.database.QueryRowContext(ctx,
		`SELECT revision, payload FROM platform_state WHERE workspace_id = ?`, workspaceID,
	).Scan(&snapshot.Revision, &state)
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, ErrNotFound
	}
	if err == nil {
		snapshot.State = json.RawMessage(state)
	}
	return snapshot, err
}

func (service *Service) GetPublic(ctx context.Context, workspaceID string) (Snapshot, error) {
	snapshot, err := service.Get(ctx, workspaceID)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot.State, err = redactModelSecrets(snapshot.State)
	return snapshot, err
}

func (service *Service) GetScanQueueConfiguration(ctx context.Context, workspaceID string) (ScanQueueConfiguration, error) {
	snapshot, err := service.Get(ctx, workspaceID)
	if err != nil {
		return ScanQueueConfiguration{}, err
	}
	var root struct {
		ScanQueue ScanQueueConfiguration `json:"scanQueue"`
	}
	if err := json.Unmarshal(snapshot.State, &root); err != nil {
		return ScanQueueConfiguration{}, fmt.Errorf("decode scan queue configuration: %w", err)
	}
	configuration := root.ScanQueue
	if configuration.BrokerURLEncrypted != "" {
		configuration.BrokerURL, err = service.secrets.Decrypt(configuration.BrokerURLEncrypted)
		if err != nil {
			return ScanQueueConfiguration{}, fmt.Errorf("decrypt scan queue broker URL: %w", err)
		}
	}
	return configuration, nil
}

func (service *Service) GetFeishuApplicationConfiguration(ctx context.Context, workspaceID string) (FeishuApplicationConfiguration, error) {
	snapshot, err := service.Get(ctx, workspaceID)
	if err != nil {
		return FeishuApplicationConfiguration{}, err
	}
	var root struct {
		FeishuApplication FeishuApplicationConfiguration `json:"feishuApplication"`
	}
	if err := json.Unmarshal(snapshot.State, &root); err != nil {
		return FeishuApplicationConfiguration{}, fmt.Errorf("decode Feishu application configuration: %w", err)
	}
	configuration := root.FeishuApplication
	if configuration.AppSecretEncrypted != "" {
		configuration.AppSecret, err = service.secrets.Decrypt(configuration.AppSecretEncrypted)
		if err != nil {
			return FeishuApplicationConfiguration{}, fmt.Errorf("decrypt Feishu application secret: %w", err)
		}
	}
	return configuration, nil
}

func (service *Service) Save(ctx context.Context, workspaceID string, expectedRevision uint64, state json.RawMessage) (Snapshot, error) {
	if !json.Valid(state) || len(state) == 0 || state[0] != '{' {
		return Snapshot{}, fmt.Errorf("state must be a JSON object")
	}
	transaction, err := service.database.BeginTx(ctx, nil)
	if err != nil {
		return Snapshot{}, err
	}
	defer transaction.Rollback()

	var currentRevision uint64
	var currentStateBytes []byte
	err = transaction.QueryRowContext(ctx,
		`SELECT revision, payload FROM platform_state WHERE workspace_id = ? FOR UPDATE`, workspaceID,
	).Scan(&currentRevision, &currentStateBytes)
	if errors.Is(err, sql.ErrNoRows) {
		if expectedRevision != 0 {
			return Snapshot{}, fmt.Errorf("state revision conflict")
		}
		state, err = protectModelSecrets(state, nil, service.secrets)
		if err != nil {
			return Snapshot{}, err
		}
		_, err = transaction.ExecContext(ctx,
			`INSERT INTO platform_state (workspace_id, revision, payload) VALUES (?, 1, ?)`, workspaceID, []byte(state))
		currentRevision = 1
	} else if err == nil {
		if expectedRevision != currentRevision {
			return Snapshot{}, fmt.Errorf("state revision conflict")
		}
		state, err = protectModelSecrets(state, json.RawMessage(currentStateBytes), service.secrets)
		if err != nil {
			return Snapshot{}, err
		}
		currentRevision++
		_, err = transaction.ExecContext(ctx,
			`UPDATE platform_state SET revision = ?, payload = ? WHERE workspace_id = ?`, currentRevision, []byte(state), workspaceID)
	}
	if err != nil {
		return Snapshot{}, err
	}
	if err := transaction.Commit(); err != nil {
		return Snapshot{}, err
	}
	return Snapshot{Revision: currentRevision, State: state}, nil
}
