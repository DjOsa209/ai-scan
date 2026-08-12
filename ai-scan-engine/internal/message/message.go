package message

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type Envelope struct {
	SchemaVersion string    `json:"schemaVersion"`
	EventID       string    `json:"eventId"`
	EventType     string    `json:"eventType"`
	OccurredAt    time.Time `json:"occurredAt"`
	Task          Task      `json:"task"`
}

type Task struct {
	ID                      string            `json:"id"`
	ProjectName             string            `json:"projectName"`
	RepositoryURL           string            `json:"repositoryUrl,omitempty"`
	GitRef                  string            `json:"gitRef"`
	Archive                 []byte            `json:"-"`
	RepositoryAuthorization string            `json:"-"`
	Mode                    string            `json:"mode"`
	ScanLevel               string            `json:"scanLevel"`
	Priority                string            `json:"priority"`
	ScanConfiguration       ScanConfiguration `json:"scanConfiguration"`
	Callbacks               Callbacks         `json:"callbacks"`
}

type ScanConfiguration struct {
	AIEnabled          bool     `json:"aiEnabled"`
	AIModelID          string   `json:"aiModelId,omitempty"`
	ExcludeDirectories []string `json:"excludeDirectories"`
	ExcludePatterns    []string `json:"excludePatterns"`
	ScanDirectories    []string `json:"scanDirectories"`
	VulnerabilityTypes []string `json:"vulnerabilityTypes"`
}

type Callbacks struct {
	StatusURL               string `json:"statusUrl"`
	ReportURL               string `json:"reportUrl"`
	RepositoryCredentialURL string `json:"repositoryCredentialUrl,omitempty"`
	ArchiveURL              string `json:"archiveUrl,omitempty"`
	Header                  string `json:"header"`
}

func Decode(payload []byte) (Envelope, error) {
	var envelope Envelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return Envelope{}, fmt.Errorf("decode task message: %w", err)
	}
	if envelope.SchemaVersion != "1.0" || envelope.EventType != "scan.requested" {
		return Envelope{}, fmt.Errorf("unsupported message schema or event type")
	}
	if blank(envelope.EventID, envelope.Task.ID, envelope.Task.GitRef, envelope.Task.Callbacks.StatusURL, envelope.Task.Callbacks.ReportURL) || (strings.TrimSpace(envelope.Task.RepositoryURL) == "" && strings.TrimSpace(envelope.Task.Callbacks.ArchiveURL) == "") {
		return Envelope{}, fmt.Errorf("task message has missing required fields")
	}
	return envelope, nil
}

func blank(values ...string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return true
		}
	}
	return false
}
