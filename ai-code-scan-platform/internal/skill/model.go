package skill

import "time"

type Source struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	SourceURL string    `json:"sourceUrl"`
	Enabled   bool      `json:"enabled"`
	IsDefault bool      `json:"isDefault"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Version struct {
	ID        int64     `json:"id"`
	SourceID  int64     `json:"skillId"`
	Version   string    `json:"version"`
	SHA256    string    `json:"sha256"`
	Content   string    `json:"content"`
	FetchedAt time.Time `json:"fetchedAt"`
}

type CreateSourceInput struct {
	Name      string `json:"name"`
	SourceURL string `json:"sourceUrl"`
	IsDefault bool   `json:"isDefault"`
}

type ResolvedSkill struct {
	SkillID   int64     `json:"skillId"`
	Name      string    `json:"name"`
	Version   string    `json:"version"`
	SHA256    string    `json:"sha256"`
	Content   string    `json:"content"`
	ExpiresAt time.Time `json:"expiresAt"`
}
