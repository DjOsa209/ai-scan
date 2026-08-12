package skill

import (
	"context"
	"errors"
	"testing"
)

type stubFetcher struct {
	content string
	err     error
}

func (fetcher stubFetcher) Fetch(context.Context, string) (string, error) {
	return fetcher.content, fetcher.err
}

type memoryRepository struct {
	source  Source
	version Version
}

func (repository *memoryRepository) CreateSource(_ context.Context, input CreateSourceInput) (Source, error) {
	repository.source = Source{ID: 7, Name: input.Name, SourceURL: input.SourceURL, Enabled: true, IsDefault: input.IsDefault}
	return repository.source, nil
}

func (repository *memoryRepository) GetSource(context.Context, int64) (Source, error) {
	if repository.source.ID == 0 {
		return Source{}, errors.New("not found")
	}
	return repository.source, nil
}

func (repository *memoryRepository) SaveVersion(_ context.Context, sourceID int64, hash, content string) (Version, error) {
	repository.version = Version{ID: 11, SourceID: sourceID, Version: hash[:12], SHA256: hash, Content: content}
	return repository.version, nil
}

func (repository *memoryRepository) ResolveDefault(context.Context) (Source, Version, error) {
	if repository.version.ID == 0 {
		return Source{}, Version{}, errors.New("not found")
	}
	return repository.source, repository.version, nil
}

func TestRegisterAndResolve(t *testing.T) {
	repository := &memoryRepository{}
	service := NewService(repository, stubFetcher{content: "# Security Skill\nReview access control."})

	source, version, err := service.Register(context.Background(), CreateSourceInput{
		Name: "security-baseline", SourceURL: "https://skills.example.com/security.md", IsDefault: true,
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if !source.IsDefault || version.SHA256 == "" {
		t.Fatalf("unexpected source or version: %#v %#v", source, version)
	}

	resolved, err := service.Resolve(context.Background())
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if resolved.SkillID != source.ID || resolved.Content != version.Content {
		t.Fatalf("unexpected resolved Skill: %#v", resolved)
	}
}

func TestValidateRemoteURL(t *testing.T) {
	fetcher := NewHTTPFetcher(0, 1024)
	for _, rawURL := range []string{"http://example.com/SKILL.md", "https://user:secret@example.com/SKILL.md"} {
		if _, err := fetcher.Fetch(context.Background(), rawURL); err == nil {
			t.Fatalf("expected %s to be rejected", rawURL)
		}
	}
}
