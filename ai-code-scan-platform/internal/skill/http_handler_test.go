package skill

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type stubApplication struct {
	resolved ResolvedSkill
}

func TestDistributionSkillsExposeInstallCommandAndDownload(t *testing.T) {
	root := t.TempDir()
	skillRoot := filepath.Join(root, "code-security")
	if err := os.MkdirAll(skillRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillRoot, "SKILL.md"), []byte("---\nname: code-security\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	NewHandler(stubApplication{}, "admin").WithDistributionRoot(root).RegisterRoutes(mux)

	list := httptest.NewRecorder()
	mux.ServeHTTP(list, httptest.NewRequest(http.MethodGet, "https://security.example/api/v1/skills", nil))
	if list.Code != http.StatusOK ||
		!strings.Contains(list.Body.String(), "请安装 代码安全扫描 Skill") ||
		!strings.Contains(list.Body.String(), "https://security.example/api/v1/skills/code-security/assets/SKILL.md") ||
		!strings.Contains(list.Body.String(), "npx --yes https://security.example/api/v1/skills/installer.tgz code-security --base-url https://security.example") {
		t.Fatalf("unexpected skill list: %d %s", list.Code, list.Body.String())
	}

	download := httptest.NewRecorder()
	mux.ServeHTTP(download, httptest.NewRequest(http.MethodGet, "https://security.example/api/v1/skills/code-security/download", nil))
	if download.Code != http.StatusOK || download.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("unexpected download response: %d %s", download.Code, download.Body.String())
	}
	archive, err := zip.NewReader(bytes.NewReader(download.Body.Bytes()), int64(download.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.File) != 1 || archive.File[0].Name != "code-security/SKILL.md" {
		t.Fatalf("unexpected archive entries: %#v", archive.File)
	}
}

func TestDistributionInstallerIsNPMPackage(t *testing.T) {
	root := t.TempDir()
	installerRoot := filepath.Join(root, "installer")
	if err := os.MkdirAll(filepath.Join(installerRoot, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installerRoot, "package.json"), []byte(`{"name":"installer"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installerRoot, "bin", "install.js"), []byte("#!/usr/bin/env node\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	NewHandler(stubApplication{}, "admin").WithDistributionRoot(root).RegisterRoutes(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "https://security.example/api/v1/skills/installer.tgz", nil))
	gzipReader, err := gzip.NewReader(bytes.NewReader(response.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	tarReader := tar.NewReader(gzipReader)
	entries := map[string]int64{}
	for {
		header, err := tarReader.Next()
		if err != nil {
			break
		}
		entries[header.Name] = header.Mode
	}
	if response.Code != http.StatusOK || entries["package/package.json"] == 0 || entries["package/bin/install.js"] != 0o755 {
		t.Fatalf("unexpected installer package: %d %#v", response.Code, entries)
	}
}

func TestDistributionBundleContainsSkillFiles(t *testing.T) {
	root := t.TempDir()
	skillRoot := filepath.Join(root, "code-security")
	if err := os.MkdirAll(skillRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillRoot, "SKILL.md"), []byte("content"), 0o644); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	NewHandler(stubApplication{}, "admin").WithDistributionRoot(root).RegisterRoutes(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/skills/code-security/bundle", nil))
	var bundle struct {
		Name  string                           `json:"name"`
		Files []struct{ Path, Content string } `json:"files"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &bundle); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || bundle.Name != "code-security" || len(bundle.Files) != 1 || bundle.Files[0].Path != "SKILL.md" {
		t.Fatalf("unexpected bundle: %d %#v", response.Code, bundle)
	}
}

func TestDistributionSkillsUseForwardedPublicHost(t *testing.T) {
	mux := http.NewServeMux()
	NewHandler(stubApplication{}, "admin").RegisterRoutes(mux)
	request := httptest.NewRequest(http.MethodGet, "http://api:8081/api/v1/skills", nil)
	request.Header.Set("X-Forwarded-Proto", "https")
	request.Header.Set("X-Forwarded-Host", "security.example")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if !strings.Contains(response.Body.String(), "https://security.example/api/v1/skills/installer.tgz") {
		t.Fatalf("expected forwarded public host, got %s", response.Body.String())
	}
}

func (application stubApplication) Register(context.Context, CreateSourceInput) (Source, Version, error) {
	return Source{}, Version{}, nil
}
func (application stubApplication) Refresh(context.Context, int64) (Version, error) {
	return Version{}, nil
}
func (application stubApplication) Resolve(context.Context) (ResolvedSkill, error) {
	return application.resolved, nil
}

func TestResolveSupportsETag(t *testing.T) {
	mux := http.NewServeMux()
	NewHandler(stubApplication{resolved: ResolvedSkill{SkillID: 1, SHA256: "abc", Content: "skill"}}, "admin").RegisterRoutes(mux)

	first := httptest.NewRecorder()
	mux.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/api/v1/plugin/skills/resolve", nil))
	if first.Code != http.StatusOK || first.Header().Get("ETag") != `"abc"` {
		t.Fatalf("unexpected first response: %d %s", first.Code, first.Body.String())
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/plugin/skills/resolve", nil)
	request.Header.Set("If-None-Match", `"abc"`)
	cached := httptest.NewRecorder()
	mux.ServeHTTP(cached, request)
	if cached.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", cached.Code)
	}
}

func TestAdminRoutesRequireToken(t *testing.T) {
	mux := http.NewServeMux()
	NewHandler(stubApplication{}, "admin-secret").RegisterRoutes(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/admin/skills", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
}
