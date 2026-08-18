package skill

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Application interface {
	Register(context.Context, CreateSourceInput) (Source, Version, error)
	Refresh(context.Context, int64) (Version, error)
	Resolve(context.Context) (ResolvedSkill, error)
}

type Handler struct {
	application      Application
	adminToken       string
	builtInRoot      string
	distributionRoot string
}

type DistributionSkill struct {
	Name           string `json:"name"`
	Title          string `json:"title"`
	Description    string `json:"description"`
	APIPath        string `json:"apiPath"`
	SkillURL       string `json:"skillUrl"`
	InstallPrompt  string `json:"installPrompt"`
	InstallCommand string `json:"installCommand"`
	DownloadURL    string `json:"downloadUrl"`
}

var distributionSkills = []DistributionSkill{
	{Name: "code-security", Title: "代码安全扫描", Description: "通过代码扫描 API 提交仓库或代码包并获取安全报告。", APIPath: "/api/v1/code-scans"},
	{Name: "threat-modeling", Title: "威胁建模", Description: "通过威胁建模 API 创建、运行并读取威胁模型。", APIPath: "/api/v1/threat-models"},
	{Name: "agent-skill-security", Title: "Agent / Skill 安全检测", Description: "通过 Agent/Skill 扫描 API 审计不可信 Agent、Skill、Prompt 与 MCP 资产包。", APIPath: "/api/v1/agent-skill-scans"},
}

func NewHandler(application Application, adminToken string) *Handler {
	return &Handler{application: application, adminToken: adminToken}
}

func (handler *Handler) WithBuiltInRoot(root string) *Handler {
	handler.builtInRoot = root
	return handler
}

func (handler *Handler) WithDistributionRoot(root string) *Handler {
	handler.distributionRoot = root
	return handler
}

func (handler *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/plugin/skills/resolve", handler.resolve)
	mux.HandleFunc("GET /api/v1/plugin/skills/security-baseline-review/{path...}", handler.builtInAsset)
	mux.HandleFunc("GET /api/v1/skills", handler.listDistributionSkills)
	mux.HandleFunc("GET /api/v1/skills/installer.tgz", handler.downloadInstaller)
	mux.HandleFunc("GET /api/v1/skills/{name}/download", handler.downloadDistributionSkill)
	mux.HandleFunc("GET /api/v1/skills/{name}/bundle", handler.distributionBundle)
	mux.HandleFunc("GET /api/v1/skills/{name}/assets/{path...}", handler.distributionAsset)
	mux.Handle("POST /api/v1/admin/skills", handler.requireAdmin(http.HandlerFunc(handler.register)))
	mux.Handle("POST /api/v1/admin/skills/{id}/refresh", handler.requireAdmin(http.HandlerFunc(handler.refresh)))
}

func (handler *Handler) listDistributionSkills(response http.ResponseWriter, request *http.Request) {
	baseURL := requestBaseURL(request)
	items := make([]DistributionSkill, 0, len(distributionSkills))
	for _, skill := range distributionSkills {
		skill.SkillURL = fmt.Sprintf("%s/api/v1/skills/%s/assets/SKILL.md", baseURL, skill.Name)
		skill.InstallPrompt = fmt.Sprintf("请安装 %s Skill：%s\n安装完成后请提醒我开启新会话。", skill.Title, skill.SkillURL)
		skill.InstallCommand = fmt.Sprintf("npx --yes %s/api/v1/skills/installer.tgz %s --base-url %s", baseURL, skill.Name, baseURL)
		skill.DownloadURL = fmt.Sprintf("/api/v1/skills/%s/download", skill.Name)
		items = append(items, skill)
	}
	writeJSON(response, http.StatusOK, map[string]any{"skills": items})
}

func (handler *Handler) downloadInstaller(response http.ResponseWriter, _ *http.Request) {
	root := filepath.Join(handler.distributionRoot, "installer")
	files := []struct {
		path string
		mode int64
	}{
		{path: "package.json", mode: 0o644},
		{path: filepath.Join("bin", "install.js"), mode: 0o755},
	}
	for _, file := range files {
		if _, err := os.Stat(filepath.Join(root, file.path)); err != nil {
			writeError(response, http.StatusNotFound, "skill_installer_not_found", "Skill installer not found")
			return
		}
	}
	response.Header().Set("Content-Type", "application/gzip")
	response.Header().Set("Content-Disposition", `attachment; filename="secscan-skill-installer.tgz"`)
	response.Header().Set("Cache-Control", "public, max-age=300")
	gzipWriter := gzip.NewWriter(response)
	tarWriter := tar.NewWriter(gzipWriter)
	for _, file := range files {
		content, err := os.ReadFile(filepath.Join(root, file.path))
		if err != nil {
			return
		}
		header := &tar.Header{Name: filepath.ToSlash(filepath.Join("package", file.path)), Mode: file.mode, Size: int64(len(content))}
		if err := tarWriter.WriteHeader(header); err != nil {
			return
		}
		if _, err := tarWriter.Write(content); err != nil {
			return
		}
	}
	_ = tarWriter.Close()
	_ = gzipWriter.Close()
}

func requestBaseURL(request *http.Request) string {
	protocol := request.Header.Get("X-Forwarded-Proto")
	if protocol == "" {
		protocol = request.URL.Scheme
	}
	if protocol == "" {
		protocol = "http"
	}
	host := request.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = request.Host
	}
	return protocol + "://" + host
}

func (handler *Handler) distributionSkillRoot(name string) (string, bool) {
	for _, skill := range distributionSkills {
		if skill.Name == name && handler.distributionRoot != "" {
			return filepath.Join(handler.distributionRoot, name), true
		}
	}
	return "", false
}

func (handler *Handler) distributionAsset(response http.ResponseWriter, request *http.Request) {
	root, ok := handler.distributionSkillRoot(request.PathValue("name"))
	relativePath := filepath.Clean(request.PathValue("path"))
	if !ok || filepath.IsAbs(relativePath) || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		writeError(response, http.StatusNotFound, "skill_asset_not_found", "Skill asset not found")
		return
	}
	http.ServeFile(response, request, filepath.Join(root, relativePath))
}

func (handler *Handler) distributionBundle(response http.ResponseWriter, request *http.Request) {
	name := request.PathValue("name")
	root, ok := handler.distributionSkillRoot(name)
	if !ok {
		writeError(response, http.StatusNotFound, "skill_not_found", "Skill not found")
		return
	}
	type bundleFile struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	files := make([]bundleFile, 0)
	err := filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil || info.IsDir() {
			return walkErr
		}
		relativePath, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		files = append(files, bundleFile{Path: filepath.ToSlash(relativePath), Content: base64.StdEncoding.EncodeToString(content)})
		return nil
	})
	if err != nil {
		writeError(response, http.StatusInternalServerError, "skill_bundle_failed", "Skill bundle could not be created")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"name": name, "files": files})
}

func (handler *Handler) downloadDistributionSkill(response http.ResponseWriter, request *http.Request) {
	name := request.PathValue("name")
	root, ok := handler.distributionSkillRoot(name)
	if !ok {
		writeError(response, http.StatusNotFound, "skill_not_found", "Skill not found")
		return
	}
	if _, err := os.Stat(filepath.Join(root, "SKILL.md")); err != nil {
		writeError(response, http.StatusNotFound, "skill_not_found", "Skill not found")
		return
	}
	response.Header().Set("Content-Type", "application/zip")
	response.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.zip"`, name))
	archive := zip.NewWriter(response)
	err := filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil || info.IsDir() {
			return walkErr
		}
		relativePath, err := filepath.Rel(handler.distributionRoot, path)
		if err != nil {
			return err
		}
		entry, err := archive.Create(filepath.ToSlash(relativePath))
		if err != nil {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		_, err = entry.Write(content)
		return err
	})
	if closeErr := archive.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return
	}
}

func (handler *Handler) builtInAsset(response http.ResponseWriter, request *http.Request) {
	relativePath := filepath.Clean(request.PathValue("path"))
	if relativePath == "." {
		relativePath = "SKILL.md"
	}
	if handler.builtInRoot == "" || filepath.IsAbs(relativePath) || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		writeError(response, http.StatusNotFound, "skill_asset_not_found", "Skill asset not found")
		return
	}
	content, err := os.ReadFile(filepath.Join(handler.builtInRoot, relativePath))
	if err != nil {
		writeError(response, http.StatusNotFound, "skill_asset_not_found", "Skill asset not found")
		return
	}
	contentType := mime.TypeByExtension(filepath.Ext(relativePath))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	response.Header().Set("Content-Type", contentType)
	response.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = response.Write(content)
}

func (handler *Handler) resolve(response http.ResponseWriter, request *http.Request) {
	resolved, err := handler.application.Resolve(request.Context())
	if err != nil {
		writeError(response, http.StatusNotFound, "default_skill_not_found", err.Error())
		return
	}
	etag := `"` + resolved.SHA256 + `"`
	response.Header().Set("ETag", etag)
	response.Header().Set("Cache-Control", "private, max-age=300")
	if request.Header.Get("If-None-Match") == etag {
		response.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(response, http.StatusOK, resolved)
}

func (handler *Handler) register(response http.ResponseWriter, request *http.Request) {
	var input CreateSourceInput
	decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	source, version, err := handler.application.Register(request.Context(), input)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "skill_registration_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusCreated, map[string]any{"source": source, "version": version})
}

func (handler *Handler) refresh(response http.ResponseWriter, request *http.Request) {
	sourceID, err := strconv.ParseInt(request.PathValue("id"), 10, 64)
	if err != nil || sourceID <= 0 {
		writeError(response, http.StatusBadRequest, "invalid_skill_id", "skill id must be a positive integer")
		return
	}
	version, err := handler.application.Refresh(request.Context(), sourceID)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, "skill_refresh_failed", err.Error())
		return
	}
	writeJSON(response, http.StatusOK, version)
}

func (handler *Handler) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if handler.adminToken == "" || request.Header.Get("Authorization") != "Bearer "+handler.adminToken {
			writeError(response, http.StatusUnauthorized, "unauthorized", "valid administrator token required")
			return
		}
		next.ServeHTTP(response, request)
	})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, map[string]string{"code": code, "message": message})
}
