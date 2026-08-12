package report

import "time"

type Report struct {
	SchemaVersion string         `json:"schemaVersion"`
	Metadata      Metadata       `json:"metadata"`
	Result        string         `json:"result"`
	Summary       Summary        `json:"summary"`
	Findings      []Finding      `json:"findings"`
	ManualReview  []ManualItem   `json:"manualReview"`
	Coverage      Coverage       `json:"coverage"`
	EvidenceFiles []EvidenceFile `json:"-"`
	AITokenUsage  TokenUsage     `json:"-"`
}

type TokenUsage struct {
	InputTokens  uint64
	OutputTokens uint64
	TotalTokens  uint64
	Estimated    bool
}

type EvidenceFile struct {
	Path    string
	Content string
}

type Metadata struct {
	Baseline    string `json:"baseline"`
	Scope       string `json:"scope"`
	GeneratedAt string `json:"generatedAt"`
}

type Summary struct {
	Critical     int `json:"critical"`
	High         int `json:"high"`
	Medium       int `json:"medium"`
	Low          int `json:"low"`
	ManualReview int `json:"manualReview"`
}

type Location struct {
	Path string `json:"path"`
	Line int    `json:"line"`
}

type Finding struct {
	ID           string     `json:"id"`
	Title        string     `json:"title"`
	Severity     string     `json:"severity"`
	Rule         string     `json:"rule"`
	Locations    []Location `json:"locations"`
	Confidence   string     `json:"confidence"`
	Evidence     string     `json:"evidence"`
	Impact       string     `json:"impact"`
	Remediation  string     `json:"remediation"`
	Verification string     `json:"verification"`
}

type ManualItem struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	Rule             string `json:"rule"`
	Reason           string `json:"reason"`
	RequiredEvidence string `json:"requiredEvidence"`
}

type Coverage struct {
	Checked    []string `json:"checked"`
	NotChecked []string `json:"notChecked"`
	Tools      []string `json:"tools"`
}

func New(scope string, findings []Finding, checked, notChecked []string) Report {
	return NewWithTools(scope, findings, checked, notChecked, []string{"ai-scan-engine/builtin-rules"})
}

func NewWithTools(scope string, findings []Finding, checked, notChecked, tools []string) Report {
	summary := Summary{}
	for _, finding := range findings {
		switch finding.Severity {
		case "critical":
			summary.Critical++
		case "high":
			summary.High++
		case "medium":
			summary.Medium++
		case "low":
			summary.Low++
		}
	}
	result := "pass"
	if len(findings) > 0 {
		result = "findings"
	}
	if len(notChecked) > 0 {
		result = "incomplete"
	}
	return Report{
		SchemaVersion: "2.0",
		Metadata: Metadata{
			Baseline:    "sec-baseline.md",
			Scope:       scope,
			GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		},
		Result:       result,
		Summary:      summary,
		Findings:     findings,
		ManualReview: []ManualItem{},
		Coverage: Coverage{
			Checked:    checked,
			NotChecked: notChecked,
			Tools:      tools,
		},
	}
}
