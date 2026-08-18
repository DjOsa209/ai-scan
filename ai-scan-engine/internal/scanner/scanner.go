package scanner

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"ai-scan-engine/internal/message"
	"ai-scan-engine/internal/report"
)

type Progress func(status, stage string, progress int, statusMessage string) error

type Scanner struct {
	workRoot     string
	maxFileBytes int64
	analyzer     CodeAnalyzer
}

type CodeAnalyzer interface {
	Analyze(context.Context, string, []string, message.Task) ([]report.Finding, []string, report.TokenUsage, error)
}

type Option func(*Scanner)

func WithAnalyzer(codeAnalyzer CodeAnalyzer) Option {
	return func(scanner *Scanner) { scanner.analyzer = codeAnalyzer }
}

type rule struct {
	id, baselineRule, title, severity, category, impact, remediation, verification string
	pattern                                                                        *regexp.Regexp
}

var rules = []rule{
	{id: "SEC-SECRET-001", baselineRule: "安全基线 7.2 敏感数据处理", title: "疑似硬编码密钥", severity: "high", category: "硬编码密钥", pattern: regexp.MustCompile(`(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']`), impact: "凭据泄露后可能导致未授权访问。", remediation: "从代码中移除凭据并通过 Secret 管理系统注入。", verification: "轮换暴露的凭据，并确认仓库历史中不再包含该值。"},
	{id: "SEC-KEY-002", baselineRule: "安全基线 7.2 敏感数据处理", title: "私钥材料进入源码", severity: "critical", category: "硬编码密钥", pattern: regexp.MustCompile(`-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----`), impact: "攻击者可使用泄露私钥冒充合法身份。", remediation: "立即吊销私钥并从版本历史中彻底清除。", verification: "确认旧私钥已失效且新私钥只保存在 Secret 系统中。"},
	{id: "SEC-HASH-003", baselineRule: "安全基线 V06 敏感数据泄露", title: "使用弱哈希算法", severity: "medium", category: "不安全加密", pattern: regexp.MustCompile(`(?i)\b(md5|sha1)\s*\(`), impact: "弱哈希可能被碰撞或快速破解，不能保护安全敏感数据。", remediation: "密码使用 Argon2id/bcrypt，完整性校验使用 SHA-256 或更强算法。", verification: "运行测试确认所有安全用途均不再调用弱哈希。"},
	{id: "SEC-EXEC-004", baselineRule: "安全基线 V03 命令注入", title: "疑似执行拼接命令", severity: "high", category: "命令注入", pattern: regexp.MustCompile(`(?i)(exec|system|popen|Command)\s*\([^\n]*(\+|sprintf|format\s*\()`), impact: "外部输入进入命令字符串时可能导致任意命令执行。", remediation: "使用参数数组调用进程，并对允许的命令和值建立白名单。", verification: "使用包含 shell 元字符的输入进行负向测试。"},
}

var scannableExtension = regexp.MustCompile(`(?i)\.(aspx?|bash|c|cc|cfg|cjs|clj|cljs|conf|cpp|cs|cshtml|css|cxx|dart|env|erl|ex|exs|fs|fsx|go|gql|gradle|graphql|groovy|h|hcl|hh|hpp|hrl|html?|ini|java|js|json|jsp|jsx|kt|kts|less|lock|lua|mjs|php|properties|proto|ps1|py|rb|rs|scala|scss|sh|sol|sql|svelte|swift|tf|tfvars|toml|ts|tsx|vue|xml|ya?ml|zsh)$`)

func New(workRoot string, maxFileBytes int64, options ...Option) *Scanner {
	codeScanner := &Scanner{workRoot: workRoot, maxFileBytes: maxFileBytes}
	for _, option := range options {
		option(codeScanner)
	}
	return codeScanner
}

func (scanner *Scanner) Run(ctx context.Context, task message.Task, progress Progress) (report.Report, error) {
	workspace := filepath.Join(scanner.workRoot, task.ID)
	if err := os.RemoveAll(workspace); err != nil {
		return report.Report{}, err
	}
	if err := os.MkdirAll(scanner.workRoot, 0o750); err != nil {
		return report.Report{}, err
	}
	if err := progress("cloning", "获取代码", 5, "正在获取仓库代码"); err != nil {
		return report.Report{}, err
	}
	if len(task.Archive) > 0 {
		if err := extractZIP(task.Archive, workspace); err != nil {
			return report.Report{}, err
		}
	} else {
		if err := clone(ctx, task.RepositoryURL, task.GitRef, task.RepositoryAuthorization, workspace); err != nil {
			return report.Report{}, err
		}
	}
	defer os.RemoveAll(workspace)
	if err := progress("indexing", "文件索引", 20, "正在建立扫描文件清单"); err != nil {
		return report.Report{}, err
	}
	if err := progress("indexing", "文件过滤", 30, "正在排除代码类型以外的文件..."); err != nil {
		return report.Report{}, err
	}
	findings, checked, skipped, err := scanner.ScanDirectory(ctx, workspace, task.ScanConfiguration)
	if err != nil {
		return report.Report{}, err
	}
	tools := []string{"ai-scan-engine/builtin-rules"}
	var tokenUsage report.TokenUsage
	if scanner.analyzer != nil && task.ScanConfiguration.AIEnabled {
		if err := progress("analyzing", "AI 深度分析", 45, fmt.Sprintf("正在分析 %d 个文件", len(checked))); err != nil {
			return report.Report{}, err
		}
		aiFindings, aiSkipped, aiTokenUsage, err := scanner.analyzer.Analyze(ctx, workspace, checked, task)
		if err != nil {
			return report.Report{}, err
		}
		findings = append(findings, aiFindings...)
		skipped = append(skipped, aiSkipped...)
		tokenUsage = aiTokenUsage
		tools = append(tools, "ai-scan-engine/openai-compatible")
	}
	if err := progress("analyzing", "安全分析", 80, fmt.Sprintf("已检查 %d 个文件", len(checked))); err != nil {
		return report.Report{}, err
	}
	result := report.NewWithTools(task.ProjectName+"@"+task.GitRef, findings, checked, skipped, tools)
	result.AITokenUsage = tokenUsage
	result.EvidenceFiles, err = collectEvidenceFiles(workspace, checked, findings)
	if err != nil {
		return report.Report{}, err
	}
	return result, nil
}

func extractZIP(content []byte, destination string) error {
	reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return fmt.Errorf("open source ZIP: %w", err)
	}
	const maxExtractedBytes int64 = 256 * 1024 * 1024
	var extractedBytes int64
	for _, entry := range reader.File {
		name := filepath.ToSlash(entry.Name)
		clean := path.Clean(name)
		if clean == "." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") || filepath.IsAbs(entry.Name) {
			return fmt.Errorf("source ZIP contains an unsafe path: %s", entry.Name)
		}
		if entry.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("source ZIP contains a symbolic link: %s", entry.Name)
		}
		extractedBytes += int64(entry.UncompressedSize64)
		if extractedBytes > maxExtractedBytes {
			return fmt.Errorf("extracted source archive exceeds 256 MiB")
		}
		target := filepath.Join(destination, filepath.FromSlash(clean))
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o750); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return err
		}
		source, err := entry.Open()
		if err != nil {
			return err
		}
		file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			source.Close()
			return err
		}
		_, copyErr := io.Copy(file, source)
		closeErr := errors.Join(source.Close(), file.Close())
		if copyErr != nil || closeErr != nil {
			return errors.Join(copyErr, closeErr)
		}
	}
	return nil
}

func collectEvidenceFiles(root string, checked []string, findings []report.Finding) ([]report.EvidenceFile, error) {
	checkedFiles := make(map[string]struct{}, len(checked))
	for _, filePath := range checked {
		checkedFiles[filePath] = struct{}{}
	}
	locations := make(map[string][]int)
	var paths []string
	for _, finding := range findings {
		for _, location := range finding.Locations {
			if _, ok := checkedFiles[location.Path]; !ok || location.Line < 1 {
				continue
			}
			if _, seen := locations[location.Path]; !seen {
				paths = append(paths, location.Path)
			}
			locations[location.Path] = append(locations[location.Path], location.Line)
		}
	}

	evidenceFiles := make([]report.EvidenceFile, 0, len(paths))
	for _, relative := range paths {
		content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(relative)))
		if err != nil {
			return nil, fmt.Errorf("read evidence file %s: %w", relative, err)
		}
		lines := strings.Split(string(content), "\n")
		keep := make([]bool, len(lines))
		for _, line := range locations[relative] {
			start := max(1, line-4)
			end := min(len(lines), line+4)
			for index := start - 1; index < end; index++ {
				keep[index] = true
			}
		}
		for index := range lines {
			if !keep[index] {
				lines[index] = ""
			}
		}
		evidenceFiles = append(evidenceFiles, report.EvidenceFile{Path: relative, Content: strings.Join(lines, "\n")})
	}
	return evidenceFiles, nil
}

func clone(ctx context.Context, repositoryURL, gitRef, authorizationHeader, destination string) error {
	parsed, err := url.Parse(repositoryURL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http" && parsed.Scheme != "ssh" && parsed.Scheme != "git" && parsed.Scheme != "file") {
		return fmt.Errorf("repository URL must use https, http, ssh, git, or file")
	}
	command := exec.CommandContext(ctx, "git", "clone", "--depth", "1", "--single-branch", "--branch", gitRef, repositoryURL, destination)
	command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if authorizationHeader != "" {
		configKey := "http." + parsed.Scheme + "://" + parsed.Host + "/.extraHeader"
		command.Env = append(command.Env, "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0="+configKey, "GIT_CONFIG_VALUE_0=Authorization: "+authorizationHeader)
	}
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("clone repository: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func (scanner *Scanner) ScanDirectory(ctx context.Context, root string, configuration message.ScanConfiguration) ([]report.Finding, []string, []string, error) {
	excludedDirectories := append([]string{".git", "node_modules", "vendor", "dist", "build"}, configuration.ExcludeDirectories...)
	var findings []report.Finding
	checked, skipped := []string{}, []string{}
	err := filepath.WalkDir(root, func(filePath string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		relative, err := filepath.Rel(root, filePath)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if entry.IsDir() {
			if relative != "." && slices.Contains(excludedDirectories, entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		agentAsset := slices.Contains(configuration.Capabilities, "agent-skill-security") && isAgentSkillAsset(relative)
		if !inScope(relative, configuration.ScanDirectories) || excluded(relative, configuration.ExcludePatterns) || (!isScannableSourcePath(relative) && !agentAsset) || !capabilityPathAllowed(relative, configuration.Capabilities) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Size() > scanner.maxFileBytes {
			skipped = append(skipped, relative+": 文件过大")
			return nil
		}
		fileFindings, binary, err := scanner.scanFile(filePath, relative, configuration.VulnerabilityTypes)
		if err != nil {
			skipped = append(skipped, relative+": 无法读取")
			return nil
		}
		if binary {
			return nil
		}
		checked = append(checked, relative)
		findings = append(findings, fileFindings...)
		return nil
	})
	return findings, checked, skipped, err
}

func capabilityPathAllowed(relative string, capabilities []string) bool {
	if !slices.Contains(capabilities, "agent-skill-security") {
		return true
	}
	return isAgentSkillAsset(relative)
}

func isAgentSkillAsset(relative string) bool {
	lower := strings.ToLower(filepath.ToSlash(relative))
	base := path.Base(lower)
	if base == "agents.md" || base == "claude.md" || base == "copilot-instructions.md" || base == ".mcp.json" || strings.Contains(base, "mcp") {
		return true
	}
	for _, marker := range []string{"/.github/agents/", "/.github/prompts/", "/.github/skills/", "/.claude/", "/agents/", "/prompts/", "/skills/", "/mcp/", "/tools/"} {
		if strings.Contains("/"+lower, marker) {
			return true
		}
	}
	return strings.HasSuffix(lower, ".agent.md") || strings.HasSuffix(lower, ".prompt.md") || strings.HasSuffix(lower, "skill.md")
}

func (scanner *Scanner) scanFile(filePath, relative string, categories []string) ([]report.Finding, bool, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, false, err
	}
	defer file.Close()
	probe := make([]byte, 8000)
	count, err := file.Read(probe)
	if err != nil && err != io.EOF {
		return nil, false, err
	}
	if strings.IndexByte(string(probe[:count]), 0) >= 0 {
		return nil, true, nil
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, false, err
	}
	var findings []report.Finding
	lineNumber := 0
	lines := bufio.NewScanner(file)
	lines.Buffer(make([]byte, 64*1024), int(scanner.maxFileBytes))
	for lines.Scan() {
		lineNumber++
		line := lines.Text()
		for _, candidate := range rules {
			if len(categories) > 0 && !slices.Contains(categories, candidate.category) {
				continue
			}
			if !candidate.pattern.MatchString(line) {
				continue
			}
			digest := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%d", candidate.id, relative, lineNumber)))
			evidence := strings.TrimSpace(line)
			if len(evidence) > 240 {
				evidence = evidence[:240]
			}
			findings = append(findings, report.Finding{ID: fmt.Sprintf("%s-%x", candidate.id, digest[:4]), Title: candidate.title, Severity: candidate.severity, Rule: candidate.baselineRule, Locations: []report.Location{{Path: relative, Line: lineNumber}}, Confidence: "medium", Evidence: evidence, Impact: candidate.impact, Remediation: candidate.remediation, Verification: candidate.verification})
		}
	}
	return findings, false, lines.Err()
}

func inScope(relative string, directories []string) bool {
	if len(directories) == 0 {
		return true
	}
	for _, directory := range directories {
		directory = strings.Trim(strings.TrimSpace(filepath.ToSlash(directory)), "/")
		if relative == directory || strings.HasPrefix(relative, directory+"/") {
			return true
		}
	}
	return false
}

func excluded(relative string, patterns []string) bool {
	for _, pattern := range patterns {
		if matched, _ := path.Match(pattern, relative); matched {
			return true
		}
		if matched, _ := path.Match(pattern, path.Base(relative)); matched {
			return true
		}
	}
	return false
}

func isScannableSourcePath(candidate string) bool {
	base := strings.ToLower(path.Base(candidate))
	if strings.HasPrefix(base, "dockerfile") || strings.HasPrefix(base, ".env") || strings.HasPrefix(base, "requirements") && strings.HasSuffix(base, ".txt") || strings.HasPrefix(base, "tsconfig") && strings.HasSuffix(base, ".json") {
		return true
	}
	switch base {
	case "cargo.lock", "cargo.toml", "composer.json", "composer.lock", "gemfile", "go.mod", "go.sum", "jenkinsfile", "makefile", "package-lock.json", "package.json", "pnpm-lock.yaml", "pom.xml", "pyproject.toml", "rakefile", "yarn.lock":
		return true
	}
	return scannableExtension.MatchString(base)
}
