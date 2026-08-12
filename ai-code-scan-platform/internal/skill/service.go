package skill

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Fetcher interface {
	Fetch(context.Context, string) (string, error)
}

type Service struct {
	repository Repository
	fetcher    Fetcher
	builtInRoot string
}

func NewService(repository Repository, fetcher Fetcher) *Service {
	return &Service{repository: repository, fetcher: fetcher}
}

func NewServiceWithBuiltIn(repository Repository, fetcher Fetcher, builtInRoot string) *Service {
	return &Service{repository: repository, fetcher: fetcher, builtInRoot: builtInRoot}
}

func (service *Service) Register(ctx context.Context, input CreateSourceInput) (Source, Version, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.SourceURL = strings.TrimSpace(input.SourceURL)
	if input.Name == "" || input.SourceURL == "" {
		return Source{}, Version{}, fmt.Errorf("name and sourceUrl are required")
	}

	content, err := service.fetcher.Fetch(ctx, input.SourceURL)
	if err != nil {
		return Source{}, Version{}, err
	}
	source, err := service.repository.CreateSource(ctx, input)
	if err != nil {
		return Source{}, Version{}, err
	}
	version, err := service.saveVersion(ctx, source.ID, content)
	return source, version, err
}

func (service *Service) Refresh(ctx context.Context, sourceID int64) (Version, error) {
	source, err := service.repository.GetSource(ctx, sourceID)
	if err != nil {
		return Version{}, err
	}
	content, err := service.fetcher.Fetch(ctx, source.SourceURL)
	if err != nil {
		return Version{}, err
	}
	return service.saveVersion(ctx, source.ID, content)
}

func (service *Service) Resolve(ctx context.Context) (ResolvedSkill, error) {
	source, version, err := service.repository.ResolveDefault(ctx)
	if err != nil {
		return service.resolveBuiltIn()
	}
	return ResolvedSkill{
		SkillID:   source.ID,
		Name:      source.Name,
		Version:   version.Version,
		SHA256:    version.SHA256,
		Content:   version.Content,
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	}, nil
}

var relativeAssetPattern = regexp.MustCompile(`\[[^\]]*\]\((\./(?:references|assets)/[^)#]+)(?:#[^)]*)?\)`)

func (service *Service) resolveBuiltIn() (ResolvedSkill, error) {
	if strings.TrimSpace(service.builtInRoot) == "" {
		return ResolvedSkill{}, fmt.Errorf("default Skill is not configured")
	}
	skillPath := filepath.Join(service.builtInRoot, "SKILL.md")
	contentBytes, err := os.ReadFile(skillPath)
	if err != nil {
		return ResolvedSkill{}, fmt.Errorf("read built-in Skill: %w", err)
	}
	content := string(contentBytes)
	seen := make(map[string]bool)
	for _, match := range relativeAssetPattern.FindAllStringSubmatch(content, -1) {
		relativePath := strings.TrimPrefix(filepath.Clean(match[1]), "./")
		if seen[relativePath] {
			continue
		}
		seen[relativePath] = true
		assetBytes, readErr := os.ReadFile(filepath.Join(service.builtInRoot, relativePath))
		if readErr != nil {
			return ResolvedSkill{}, fmt.Errorf("read built-in Skill asset %s: %w", relativePath, readErr)
		}
		content += fmt.Sprintf("\n\n<skill_reference path=\"%s\">\n%s\n</skill_reference>", relativePath, assetBytes)
	}
	hashBytes := sha256.Sum256([]byte(content))
	hash := hex.EncodeToString(hashBytes[:])
	return ResolvedSkill{
		SkillID: 1, Name: "security-baseline-review", Version: "builtin-" + hash[:12],
		SHA256: hash, Content: content, ExpiresAt: time.Now().UTC().Add(time.Hour),
	}, nil
}

func (service *Service) saveVersion(ctx context.Context, sourceID int64, content string) (Version, error) {
	hashBytes := sha256.Sum256([]byte(content))
	return service.repository.SaveVersion(ctx, sourceID, hex.EncodeToString(hashBytes[:]), content)
}
