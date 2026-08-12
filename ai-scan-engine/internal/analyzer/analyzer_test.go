package analyzer

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ai-scan-engine/internal/codeindex"
	"ai-scan-engine/internal/message"
	"ai-scan-engine/internal/report"
)

func TestDecodeModelOutputIgnoresUnknownFields(t *testing.T) {
	output, err := decodeModelOutput(`{"findings":[{"title":"SQL 注入","severity":"high","rule":"CWE-89","locations":[{"path":"app.go","line":2}],"confidence":"high","evidence":"外部输入拼接 SQL","impact":"可读取数据库","remediation":"使用参数化查询","verification":"使用注入载荷回归测试","dataFlow":{"source":"input","sink":"query"}}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(output.Findings) != 1 || output.Findings[0].Rule != "CWE-89" {
		t.Fatalf("unexpected model output: %#v", output)
	}
}

func TestAnalyzeSendsSourceAndValidatesFindingLocation(t *testing.T) {
	var requestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/chat/completions" || request.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("unexpected request: %s headers=%v", request.URL.Path, request.Header)
		}
		if err := json.NewDecoder(request.Body).Decode(&requestBody); err != nil {
			t.Errorf("decode request: %v", err)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{\"findings\":[{\"title\":\"SQL 注入\",\"severity\":\"high\",\"rule\":\"CWE-89\",\"locations\":[{\"path\":\"app.go\",\"line\":2}],\"confidence\":\"high\",\"evidence\":\"外部输入拼接 SQL\",\"impact\":\"可读取数据库\",\"remediation\":\"使用参数化查询\",\"verification\":\"使用注入载荷回归测试\"}]}"}}],"usage":{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150}}`))
	}))
	defer server.Close()

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "app.go"), []byte("package main\nfunc query(input string) {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	skillRoot := writeTestSkill(t)
	codeAnalyzer, err := New(Config{APIProtocol: "chat-completions", Endpoint: server.URL + "/v1", ModelID: "test", APIKey: "secret", SkillRoot: skillRoot, MaxContextBytes: 4096, MaxBatches: 2}, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	findings, skipped, usage, err := codeAnalyzer.Analyze(context.Background(), root, []string{"app.go"}, message.Task{ProjectName: "sample", GitRef: "main", ScanLevel: "release"})
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 0 || len(findings) != 1 || findings[0].Rule != "CWE-89" || findings[0].Locations[0].Line != 2 {
		t.Fatalf("unexpected analysis: findings=%#v skipped=%#v", findings, skipped)
	}
	if usage.InputTokens != 120 || usage.OutputTokens != 30 || usage.TotalTokens != 150 || usage.Estimated {
		t.Fatalf("unexpected token usage: %#v", usage)
	}
	messages := requestBody["messages"].([]any)
	user := messages[1].(map[string]any)["content"].(string)
	if !strings.Contains(user, "2|func query") {
		t.Fatalf("model did not receive numbered source: %s", user)
	}
}

func TestAnalyzeAccumulatesTokenUsageAcrossBatches(t *testing.T) {
	root := t.TempDir()
	content := "package sample\n" + strings.Repeat("var value = 1\n", 220)
	if err := os.WriteFile(filepath.Join(root, "app.go"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	proxy := &batchUsageModelProxy{usages: []report.TokenUsage{
		{InputTokens: 10, OutputTokens: 1, TotalTokens: 11},
		{InputTokens: 20, OutputTokens: 2, TotalTokens: 22, Estimated: true},
	}}
	codeAnalyzer, err := NewPlatform(Config{SkillRoot: writeTestSkill(t), MaxContextBytes: 4096, MaxBatches: 2}, proxy)
	if err != nil {
		t.Fatal(err)
	}

	_, skipped, usage, err := codeAnalyzer.Analyze(context.Background(), root, []string{"app.go"}, message.Task{ID: "task-1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 0 || proxy.completeCalls != 2 {
		t.Fatalf("expected exactly two complete batches, calls=%d skipped=%#v", proxy.completeCalls, skipped)
	}
	if usage.InputTokens != 30 || usage.OutputTokens != 3 || usage.TotalTokens != 33 || !usage.Estimated {
		t.Fatalf("expected accumulated token usage, got %#v", usage)
	}
}

type batchUsageModelProxy struct {
	usages        []report.TokenUsage
	completeCalls int
}

func (proxy *batchUsageModelProxy) IssueModelSession(context.Context, string) (string, time.Time, error) {
	return "session-token", time.Now().Add(10 * time.Minute), nil
}

func (proxy *batchUsageModelProxy) CompletePrompt(context.Context, string, string, string) (string, report.TokenUsage, error) {
	usage := proxy.usages[proxy.completeCalls]
	proxy.completeCalls++
	return `{"findings":[]}`, usage, nil
}

func TestBuildBatchesIncludesAllFilesWhenBatchLimitIsDisabled(t *testing.T) {
	root := t.TempDir()
	files := []string{"a.go", "b.go", "c.go"}
	for _, name := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte("package sample\n"+strings.Repeat("var value = 1\n", 300)), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	codeAnalyzer := &Analyzer{config: Config{MaxContextBytes: 4096, MaxBatches: 0}}
	batches, skipped, err := codeAnalyzer.buildBatches(root, files)
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 0 {
		t.Fatalf("full scan must not skip files because of a default batch limit: %#v", skipped)
	}
	seen := map[string]bool{}
	for _, sourceBatch := range batches {
		for name := range sourceBatch.ranges {
			seen[name] = true
		}
	}
	for _, name := range files {
		if !seen[name] {
			t.Fatalf("source file %s was not included in any AI batch", name)
		}
	}
}

func TestAddCrossFileEvidenceSupportsIndexedLanguages(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"handler.go":    "package sample\nfunc Handle(value string) { SaveUser(value) }\n",
		"store.go":      "package sample\nfunc SaveUser(value string) { database.Exec(value) }\n",
		"view.py":       "def render(value):\n    return load_template(value)\n",
		"loader.py":     "def load_template(value):\n    return templates.open(value)\n",
		"controller.js": "export function submit(value) { return persist(value); }\n",
		"storage.js":    "export const persist = (value) => { return database.execute(value); };\n",
		"route.ts":      "export const route = (service: UserService) => service.loadUser();\n",
		"service.ts":    "export class UserService {\n  loadUser(): User { return repository.findUser(); }\n}\n",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	index, err := codeindex.Build(root, []string{"handler.go", "store.go", "view.py", "loader.py", "controller.js", "storage.js", "route.ts", "service.ts"})
	if err != nil {
		t.Fatal(err)
	}
	batches := []batch{
		{content: "2|func Handle(value string) { SaveUser(value) }\n", ranges: map[string][]lineRange{"handler.go": {{first: 2, last: 2}}}},
		{content: "1|def render(value):\n2|    return load_template(value)\n", ranges: map[string][]lineRange{"view.py": {{first: 1, last: 2}}}},
		{content: "1|export function submit(value) { return persist(value); }\n", ranges: map[string][]lineRange{"controller.js": {{first: 1, last: 1}}}},
		{content: "1|export const route = (service: UserService) => service.loadUser();\n", ranges: map[string][]lineRange{"route.ts": {{first: 1, last: 1}}}},
	}
	codeAnalyzer := &Analyzer{config: Config{MaxContextBytes: 4096}}
	codeAnalyzer.addCrossFileEvidence(batches, index)

	if !strings.Contains(batches[0].content, "RELATED FUNCTION: store.go") || !allowedLocation(batches[0].ranges["store.go"], 2) {
		t.Fatalf("Go cross-file evidence was not added: %#v", batches[0])
	}
	if !strings.Contains(batches[1].content, "RELATED FUNCTION: loader.py") || !allowedLocation(batches[1].ranges["loader.py"], 2) {
		t.Fatalf("Python cross-file evidence was not added: %#v", batches[1])
	}
	if !strings.Contains(batches[2].content, "RELATED FUNCTION: storage.js") || !allowedLocation(batches[2].ranges["storage.js"], 1) {
		t.Fatalf("JavaScript cross-file evidence was not added: %#v", batches[2])
	}
	if !strings.Contains(batches[3].content, "RELATED FUNCTION: service.ts") || !allowedLocation(batches[3].ranges["service.ts"], 2) {
		t.Fatalf("TypeScript cross-file evidence was not added: %#v", batches[3])
	}
}

func TestAnalyzeRenewsExpiringPlatformModelSession(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "app.go"), []byte("package main\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	proxy := &renewingModelProxy{}
	codeAnalyzer, err := NewPlatform(Config{SkillRoot: writeTestSkill(t), MaxContextBytes: 4096}, proxy)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := codeAnalyzer.Analyze(context.Background(), root, []string{"app.go"}, message.Task{ID: "task-1"}); err != nil {
		t.Fatal(err)
	}
	if proxy.issueCalls != 2 || proxy.completedWith != "fresh-token" {
		t.Fatalf("expected an expiring session to be renewed, issues=%d token=%q", proxy.issueCalls, proxy.completedWith)
	}
}

type renewingModelProxy struct {
	issueCalls    int
	completedWith string
}

func (proxy *renewingModelProxy) IssueModelSession(context.Context, string) (string, time.Time, error) {
	proxy.issueCalls++
	if proxy.issueCalls == 1 {
		return "expiring-token", time.Now().Add(30 * time.Second), nil
	}
	return "fresh-token", time.Now().Add(10 * time.Minute), nil
}

func (proxy *renewingModelProxy) CompletePrompt(_ context.Context, token, _, _ string) (string, report.TokenUsage, error) {
	proxy.completedWith = token
	return `{"findings":[]}`, report.TokenUsage{InputTokens: 80, OutputTokens: 20, TotalTokens: 100, Estimated: true}, nil
}

func TestValidateFindingsDropsInventedLocationWithoutBlockingValidFindings(t *testing.T) {
	findings, err := validateFindings(modelOutput{Findings: []candidate{
		{
			Title: "bad", Severity: "high", Rule: "CWE-1", Confidence: "high", Evidence: "e", Impact: "i", Remediation: "r", Verification: "v",
			Locations: []modelLocation{{Path: "other.go", Line: 99}},
		},
		{
			Title: "valid", Severity: "high", Rule: "CWE-2", Confidence: "high", Evidence: "e", Impact: "i", Remediation: "r", Verification: "v",
			Locations: []modelLocation{{Path: "app.go", Line: 2}},
		},
	}}, map[string][]lineRange{"app.go": {{first: 1, last: 2}}})
	if err != nil {
		t.Fatalf("an invalid model finding must not fail the batch: %v", err)
	}
	if len(findings) != 1 || findings[0].Title != "valid" {
		t.Fatalf("expected only the source-supported finding, got %#v", findings)
	}
}

func TestDecodeModelOutputAcceptsIgnoredFindingID(t *testing.T) {
	output, err := decodeModelOutput(`{"findings":[{"id":"model-chosen-id","title":"问题","severity":"high","rule":"RULE-1","locations":[],"confidence":"high","evidence":"e","impact":"i","remediation":"r","verification":"v"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(output.Findings) != 1 {
		t.Fatalf("unexpected findings: %#v", output.Findings)
	}
}

func TestAnalysisPolicyUsesRequestedTypesAndReleaseDepth(t *testing.T) {
	policy, err := loadAnalysisPolicy(writeTestSkill(t))
	if err != nil {
		t.Fatal(err)
	}
	prompt := policy.prompt(message.Task{
		ScanLevel:         "release",
		ScanConfiguration: message.ScanConfiguration{VulnerabilityTypes: []string{"SQL注入", "权限绕过"}},
	})
	for _, expected := range []string{"SQL注入, 权限绕过", "RULE-AC-01", "sole source of security rules", "Release:", "applicable baseline rule ID"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("analysis policy does not contain %q:\n%s", expected, prompt)
		}
	}
}

func TestAnalysisPolicyDefaultsToFullBaseline(t *testing.T) {
	policy, err := loadAnalysisPolicy(writeTestSkill(t))
	if err != nil {
		t.Fatal(err)
	}
	prompt := policy.prompt(message.Task{ScanLevel: "standard"})
	for _, expected := range []string{"安全基线中的全部检查项", "RULE-AC-01", "Standard:"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("default policy does not contain %q", expected)
		}
	}
}

func TestLoadAnalysisPolicyRequiresBaselineReference(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "SKILL.md"), []byte("scan using baseline"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadAnalysisPolicy(root); err == nil || !strings.Contains(err.Error(), "sec-baseline.md") {
		t.Fatalf("expected missing baseline error, got %v", err)
	}
}

func writeTestSkill(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "references"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "SKILL.md"), []byte("Use sec-baseline.md as the sole policy."), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "references", "sec-baseline.md"), []byte("RULE-AC-01: resources must be authorized for the current subject."), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}
