package analyzer

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"ai-scan-engine/internal/codeindex"
	"ai-scan-engine/internal/message"
	"ai-scan-engine/internal/report"
)

type Config struct {
	APIProtocol       string
	Endpoint          string
	ModelID           string
	APIKey            string
	SkillRoot         string
	ProxyUserNo       string
	ProxyUserName     string
	ProxyUserDeptName string
	Temperature       float64
	MaxTokens         int
	MaxContextBytes   int
	MaxBatches        int
}

type Analyzer struct {
	config Config
	http   *http.Client
	policy analysisPolicy
	proxy  ModelProxy
}

type ModelProxy interface {
	IssueModelSession(context.Context, string) (string, time.Time, error)
	CompletePrompt(context.Context, string, string, string) (string, report.TokenUsage, error)
}

type batch struct {
	content string
	ranges  map[string][]lineRange
}

type lineRange struct {
	first int
	last  int
}

type modelOutput struct {
	Findings []candidate `json:"findings"`
}

type candidate struct {
	ID           string          `json:"id,omitempty"`
	Title        string          `json:"title"`
	Severity     string          `json:"severity"`
	Rule         string          `json:"rule"`
	Locations    []modelLocation `json:"locations"`
	Confidence   string          `json:"confidence"`
	Evidence     string          `json:"evidence"`
	Impact       string          `json:"impact"`
	Remediation  string          `json:"remediation"`
	Verification string          `json:"verification"`
}

type modelLocation struct {
	Path string `json:"path"`
	Line int    `json:"line"`
}

func New(configuration Config, timeout time.Duration) (*Analyzer, error) {
	policy, err := loadAnalysisPolicy(configuration.SkillRoot)
	if err != nil {
		return nil, err
	}
	return &Analyzer{config: configuration, http: &http.Client{Timeout: timeout}, policy: policy}, nil
}

func NewPlatform(configuration Config, proxy ModelProxy) (*Analyzer, error) {
	policy, err := loadAnalysisPolicy(configuration.SkillRoot)
	if err != nil {
		return nil, err
	}
	return &Analyzer{config: configuration, policy: policy, proxy: proxy}, nil
}

func (analyzer *Analyzer) Analyze(ctx context.Context, root string, files []string, task message.Task) ([]report.Finding, []string, report.TokenUsage, error) {
	batches, notAnalyzed, err := analyzer.buildBatches(root, files)
	if err != nil {
		return nil, nil, report.TokenUsage{}, err
	}
	index, err := codeindex.Build(root, files)
	if err != nil {
		return nil, nil, report.TokenUsage{}, fmt.Errorf("build source index: %w", err)
	}
	analyzer.addCrossFileEvidence(batches, index)
	var findings []report.Finding
	var tokenUsage report.TokenUsage
	var sessionToken string
	var sessionExpiresAt time.Time
	if analyzer.proxy != nil {
		sessionToken, sessionExpiresAt, err = analyzer.proxy.IssueModelSession(ctx, task.ID)
		if err != nil {
			return nil, nil, report.TokenUsage{}, fmt.Errorf("issue model session: %w", err)
		}
	}
	for index, sourceBatch := range batches {
		if analyzer.proxy != nil && time.Until(sessionExpiresAt) <= time.Minute {
			sessionToken, sessionExpiresAt, err = analyzer.proxy.IssueModelSession(ctx, task.ID)
			if err != nil {
				return nil, nil, report.TokenUsage{}, fmt.Errorf("renew model session before source batch %d/%d: %w", index+1, len(batches), err)
			}
		}
		output, batchUsage, err := analyzer.complete(ctx, task, sessionToken, index+1, len(batches), sourceBatch.content)
		if err != nil {
			return nil, nil, report.TokenUsage{}, fmt.Errorf("analyze source batch %d/%d: %w", index+1, len(batches), err)
		}
		tokenUsage.InputTokens += batchUsage.InputTokens
		tokenUsage.OutputTokens += batchUsage.OutputTokens
		tokenUsage.TotalTokens += batchUsage.TotalTokens
		tokenUsage.Estimated = tokenUsage.Estimated || batchUsage.Estimated
		batchFindings, err := validateFindings(output, sourceBatch.ranges)
		if err != nil {
			return nil, nil, report.TokenUsage{}, fmt.Errorf("validate source batch %d/%d: %w", index+1, len(batches), err)
		}
		findings = append(findings, batchFindings...)
	}
	return deduplicate(findings), notAnalyzed, tokenUsage, nil
}

func (analyzer *Analyzer) buildBatches(root string, files []string) ([]batch, []string, error) {
	maxBytes := analyzer.config.MaxContextBytes
	if maxBytes < 4096 {
		maxBytes = 4096
	}
	sourceBytes := maxBytes * 3 / 4
	maxBatches := analyzer.config.MaxBatches
	var batches []batch
	var skipped []string
	current := batch{ranges: map[string][]lineRange{}}
	var content strings.Builder

	flush := func() bool {
		if content.Len() == 0 {
			return true
		}
		if maxBatches > 0 && len(batches) >= maxBatches {
			return false
		}
		current.content = content.String()
		batches = append(batches, current)
		content.Reset()
		current = batch{ranges: map[string][]lineRange{}}
		return true
	}

	for fileIndex, relative := range files {
		clean := filepath.Clean(filepath.FromSlash(relative))
		if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return nil, nil, fmt.Errorf("invalid source path %q", relative)
		}
		file, err := os.Open(filepath.Join(root, clean))
		if err != nil {
			skipped = append(skipped, relative+": AI 分析无法读取")
			continue
		}
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 64*1024), maxBytes)
		lineNumber := 0
		for scanner.Scan() {
			lineNumber++
			line := fmt.Sprintf("%d|%s\n", lineNumber, scanner.Text())
			header := "\n--- FILE: " + relative + " ---\n"
			if _, exists := current.ranges[relative]; !exists {
				line = header + line
			}
			if content.Len()+len(line) > sourceBytes && content.Len() > 0 {
				if !flush() {
					skipped = append(skipped, remainingFiles(files, fileIndex, relative)...)
					_ = file.Close()
					return batches, unique(skipped), nil
				}
				line = header + fmt.Sprintf("%d|%s\n", lineNumber, scanner.Text())
			}
			content.WriteString(line)
			ranges := current.ranges[relative]
			if len(ranges) == 0 || ranges[len(ranges)-1].last+1 != lineNumber {
				current.ranges[relative] = append(ranges, lineRange{first: lineNumber, last: lineNumber})
			} else {
				current.ranges[relative][len(ranges)-1].last = lineNumber
			}
		}
		scanErr := scanner.Err()
		_ = file.Close()
		if scanErr != nil {
			skipped = append(skipped, relative+": AI 分析无法读取完整文件")
		}
	}
	if !flush() {
		for path := range current.ranges {
			skipped = append(skipped, path+": 超出 AI 分析批次上限")
		}
	}
	return batches, unique(skipped), nil
}

func (analyzer *Analyzer) addCrossFileEvidence(batches []batch, index *codeindex.Index) {
	maxBytes := analyzer.config.MaxContextBytes
	if maxBytes < 4096 {
		maxBytes = 4096
	}
	const evidenceHeader = "\n--- CROSS-FILE INDEX EVIDENCE ---\n"
	for batchIndex := range batches {
		sourceBatch := &batches[batchIndex]
		remainingBytes := maxBytes - len(sourceBatch.content) - len(evidenceHeader)
		if remainingBytes <= 0 {
			continue
		}
		excludedPaths := make(map[string]struct{}, len(sourceBatch.ranges))
		for path := range sourceBatch.ranges {
			excludedPaths[path] = struct{}{}
		}
		related := index.Related(sourceBatch.content, excludedPaths, codeindex.Options{
			MaxDepth: 3, MaxFunctions: 8, MaxBytes: remainingBytes,
		})
		if len(related) == 0 {
			continue
		}
		var evidence strings.Builder
		evidence.WriteString(evidenceHeader)
		for _, function := range related {
			evidence.WriteString(function.Content)
			sourceBatch.ranges[function.Path] = append(sourceBatch.ranges[function.Path], lineRange{
				first: function.StartLine,
				last:  function.EndLine,
			})
		}
		sourceBatch.content += evidence.String()
	}
}

func remainingFiles(files []string, fileIndex int, current string) []string {
	skipped := []string{current + ": 超出 AI 分析批次上限"}
	for _, relative := range files[fileIndex+1:] {
		skipped = append(skipped, relative+": 超出 AI 分析批次上限")
	}
	return skipped
}

func (analyzer *Analyzer) complete(ctx context.Context, task message.Task, sessionToken string, batchNumber, batchCount int, source string) (modelOutput, report.TokenUsage, error) {
	if analyzer.proxy != nil {
		system, user := analyzer.prompts(task, batchNumber, batchCount, source)
		text, usage, err := analyzer.proxy.CompletePrompt(ctx, sessionToken, system, user)
		if err != nil {
			return modelOutput{}, report.TokenUsage{}, err
		}
		output, err := decodeModelOutput(text)
		return output, usage, err
	}
	endpoint, payload, err := analyzer.request(task, batchNumber, batchCount, source)
	if err != nil {
		return modelOutput{}, report.TokenUsage{}, err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return modelOutput{}, report.TokenUsage{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return modelOutput{}, report.TokenUsage{}, err
	}
	request.Header.Set("Authorization", "Bearer "+analyzer.config.APIKey)
	request.Header.Set("Content-Type", "application/json")
	setIdentityHeaders(request.Header, analyzer.config)
	response, err := analyzer.http.Do(request)
	if err != nil {
		return modelOutput{}, report.TokenUsage{}, err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024))
	if err != nil {
		return modelOutput{}, report.TokenUsage{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return modelOutput{}, report.TokenUsage{}, fmt.Errorf("model endpoint returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	text, usage, err := decodeResponse(analyzer.config.APIProtocol, responseBody)
	if err != nil {
		return modelOutput{}, report.TokenUsage{}, err
	}
	if usage.TotalTokens == 0 {
		usage.InputTokens = estimateTokens(body)
		usage.OutputTokens = estimateTokens([]byte(text))
		usage.TotalTokens = usage.InputTokens + usage.OutputTokens
		usage.Estimated = true
	}
	output, err := decodeModelOutput(text)
	return output, usage, err
}

func decodeModelOutput(text string) (modelOutput, error) {
	decoder := json.NewDecoder(strings.NewReader(text))
	var output modelOutput
	if err := decoder.Decode(&output); err != nil {
		return modelOutput{}, fmt.Errorf("decode structured model output: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return modelOutput{}, fmt.Errorf("model output must contain exactly one JSON object")
	}
	return output, nil
}

func (analyzer *Analyzer) request(task message.Task, batchNumber, batchCount int, source string) (string, any, error) {
	endpoint, err := endpointURL(analyzer.config.Endpoint, analyzer.config.APIProtocol)
	if err != nil {
		return "", nil, err
	}
	system, user := analyzer.prompts(task, batchNumber, batchCount, source)
	if analyzer.config.APIProtocol == "responses" {
		return endpoint, struct {
			Model           string  `json:"model"`
			Instructions    string  `json:"instructions"`
			Input           string  `json:"input"`
			Temperature     float64 `json:"temperature,omitempty"`
			MaxOutputTokens int     `json:"max_output_tokens,omitempty"`
		}{analyzer.config.ModelID, system, user, analyzer.config.Temperature, analyzer.config.MaxTokens}, nil
	}
	return endpoint, struct {
		Model       string        `json:"model"`
		Messages    []chatMessage `json:"messages"`
		Temperature float64       `json:"temperature,omitempty"`
		MaxTokens   int           `json:"max_tokens,omitempty"`
	}{analyzer.config.ModelID, []chatMessage{{"system", system}, {"user", user}}, analyzer.config.Temperature, analyzer.config.MaxTokens}, nil
}

func (analyzer *Analyzer) prompts(task message.Task, batchNumber, batchCount int, source string) (string, string) {
	return analyzer.policy.prompt(task), fmt.Sprintf("Project: %s\nGit ref: %s\nScan level: %s\nRequested vulnerability types: %s\nBatch: %d/%d\n\nSOURCE WITH ORIGINAL LINE NUMBERS:\n%s", task.ProjectName, task.GitRef, task.ScanLevel, strings.Join(task.ScanConfiguration.VulnerabilityTypes, ", "), batchNumber, batchCount, source)
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func endpointURL(raw, protocol string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return "", fmt.Errorf("invalid model endpoint")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && slices.Contains([]string{"localhost", "127.0.0.1"}, parsed.Hostname())) {
		return "", fmt.Errorf("model endpoint must use HTTPS outside localhost")
	}
	suffix := "/chat/completions"
	if protocol == "responses" {
		suffix = "/responses"
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if !strings.HasSuffix(parsed.Path, suffix) {
		parsed.Path += suffix
	}
	return parsed.String(), nil
}

func decodeResponse(protocol string, body []byte) (string, report.TokenUsage, error) {
	if protocol == "responses" {
		var response struct {
			OutputText string `json:"output_text"`
			Usage      struct {
				InputTokens  uint64 `json:"input_tokens"`
				OutputTokens uint64 `json:"output_tokens"`
				TotalTokens  uint64 `json:"total_tokens"`
			} `json:"usage"`
			Output []struct {
				Content []struct {
					Text string `json:"text"`
				} `json:"content"`
			} `json:"output"`
		}
		if err := json.Unmarshal(body, &response); err != nil {
			return "", report.TokenUsage{}, err
		}
		parts := []string{response.OutputText}
		for _, output := range response.Output {
			for _, content := range output.Content {
				parts = append(parts, content.Text)
			}
		}
		text := strings.TrimSpace(strings.Join(parts, ""))
		if text == "" {
			return "", report.TokenUsage{}, fmt.Errorf("model response contains no output text")
		}
		return text, report.TokenUsage{InputTokens: response.Usage.InputTokens, OutputTokens: response.Usage.OutputTokens, TotalTokens: response.Usage.TotalTokens}, nil
	}
	var completion struct {
		Usage struct {
			InputTokens  uint64 `json:"prompt_tokens"`
			OutputTokens uint64 `json:"completion_tokens"`
			TotalTokens  uint64 `json:"total_tokens"`
		} `json:"usage"`
		Choices []struct {
			Message chatMessage `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &completion); err != nil {
		return "", report.TokenUsage{}, err
	}
	if len(completion.Choices) == 0 || strings.TrimSpace(completion.Choices[0].Message.Content) == "" {
		return "", report.TokenUsage{}, fmt.Errorf("model response contains no choices")
	}
	return completion.Choices[0].Message.Content, report.TokenUsage{InputTokens: completion.Usage.InputTokens, OutputTokens: completion.Usage.OutputTokens, TotalTokens: completion.Usage.TotalTokens}, nil
}

func estimateTokens(value []byte) uint64 {
	return uint64((len(value) + 3) / 4)
}

func validateFindings(output modelOutput, allowed map[string][]lineRange) ([]report.Finding, error) {
	severity := []string{"critical", "high", "medium", "low"}
	confidence := []string{"high", "medium", "low"}
	findings := make([]report.Finding, 0, len(output.Findings))
	for _, value := range output.Findings {
		if blank(value.Title, value.Rule, value.Evidence, value.Impact, value.Remediation, value.Verification) || !slices.Contains(severity, value.Severity) || !slices.Contains(confidence, value.Confidence) || len(value.Locations) == 0 {
			continue
		}
		locations := make([]report.Location, 0, len(value.Locations))
		valid := true
		for _, location := range value.Locations {
			if !allowedLocation(allowed[location.Path], location.Line) {
				valid = false
				break
			}
			locations = append(locations, report.Location{Path: location.Path, Line: location.Line})
		}
		if !valid {
			continue
		}
		digest := sha256.Sum256([]byte(value.Rule + ":" + locations[0].Path + ":" + fmt.Sprint(locations[0].Line) + ":" + value.Title))
		findings = append(findings, report.Finding{ID: fmt.Sprintf("AI-%x", digest[:6]), Title: value.Title, Severity: value.Severity, Rule: value.Rule, Locations: locations, Confidence: value.Confidence, Evidence: value.Evidence, Impact: value.Impact, Remediation: value.Remediation, Verification: value.Verification})
	}
	return findings, nil
}

func allowedLocation(ranges []lineRange, line int) bool {
	for _, value := range ranges {
		if line >= value.first && line <= value.last {
			return true
		}
	}
	return false
}

func setIdentityHeaders(header http.Header, configuration Config) {
	if configuration.ProxyUserNo != "" {
		header.Set("x-user-no", configuration.ProxyUserNo)
	}
	if configuration.ProxyUserName != "" {
		header.Set("x-user-name", strings.ReplaceAll(url.QueryEscape(configuration.ProxyUserName), "+", "%20"))
	}
	if configuration.ProxyUserDeptName != "" {
		header.Set("x-user-dept-name", strings.ReplaceAll(url.QueryEscape(configuration.ProxyUserDeptName), "+", "%20"))
	}
}

func deduplicate(findings []report.Finding) []report.Finding {
	seen := map[string]bool{}
	result := make([]report.Finding, 0, len(findings))
	for _, finding := range findings {
		if seen[finding.ID] {
			continue
		}
		seen[finding.ID] = true
		result = append(result, finding)
	}
	return result
}

func unique(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func blank(values ...string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return true
		}
	}
	return false
}
