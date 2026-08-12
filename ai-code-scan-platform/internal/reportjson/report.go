package reportjson

import (
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"
)

type Report struct {
	SchemaVersion string             `json:"schemaVersion"`
	Metadata      Metadata           `json:"metadata"`
	Result        string             `json:"result"`
	Summary       Summary            `json:"summary"`
	Findings      []Finding          `json:"findings"`
	ManualReview  []ManualReviewItem `json:"manualReview"`
	Coverage      Coverage           `json:"coverage"`
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
	DataFlow     *DataFlow  `json:"dataFlow,omitempty"`
}

type Location struct {
	Path string `json:"path"`
	Line int    `json:"line"`
}

type DataFlow struct {
	AnalysisMethod string         `json:"analysisMethod"`
	Nodes          []DataFlowNode `json:"nodes"`
	Limitations    []string       `json:"limitations"`
}

type DataFlowNode struct {
	Kind       string `json:"kind"`
	Label      string `json:"label"`
	Path       string `json:"path"`
	Line       int    `json:"line"`
	Symbol     string `json:"symbol"`
	Expression string `json:"expression"`
}

type ManualReviewItem struct {
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

func Validate(value string) error {
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()
	var report Report
	if err := decoder.Decode(&report); err != nil {
		return fmt.Errorf("decode JSON report: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("report must contain exactly one JSON object")
	}
	if report.SchemaVersion != "2.0" || report.Metadata.Baseline != "sec-baseline.md" {
		return fmt.Errorf("schemaVersion must be 2.0 and baseline must be sec-baseline.md")
	}
	if blank(report.Metadata.Scope, report.Metadata.GeneratedAt) {
		return fmt.Errorf("scope and generatedAt are required")
	}
	if report.Result != "pass" && report.Result != "findings" && report.Result != "incomplete" {
		return fmt.Errorf("result must be pass, findings, or incomplete")
	}
	if report.Summary.Critical < 0 || report.Summary.High < 0 || report.Summary.Medium < 0 || report.Summary.Low < 0 || report.Summary.ManualReview < 0 {
		return fmt.Errorf("summary counts must be non-negative")
	}
	counts := map[string]int{"critical": 0, "high": 0, "medium": 0, "low": 0}
	ids := map[string]bool{}
	for index, finding := range report.Findings {
		if blank(finding.ID, finding.Title, finding.Rule, finding.Evidence, finding.Impact, finding.Remediation, finding.Verification) {
			return fmt.Errorf("findings[%d] has incomplete fields", index)
		}
		if ids[finding.ID] {
			return fmt.Errorf("duplicate report item ID %q", finding.ID)
		}
		ids[finding.ID] = true
		if _, ok := counts[finding.Severity]; !ok {
			return fmt.Errorf("findings[%d] has invalid severity", index)
		}
		counts[finding.Severity]++
		if finding.Confidence != "high" && finding.Confidence != "medium" && finding.Confidence != "low" {
			return fmt.Errorf("findings[%d] has invalid confidence", index)
		}
		if len(finding.Locations) == 0 {
			return fmt.Errorf("findings[%d] requires at least one location", index)
		}
		for locationIndex, location := range finding.Locations {
			if strings.TrimSpace(location.Path) == "" || strings.Contains(location.Path, "\\") || path.IsAbs(location.Path) || strings.HasPrefix(path.Clean(location.Path), "../") || location.Line < 1 {
				return fmt.Errorf("findings[%d].locations[%d] must use a relative POSIX path and positive line", index, locationIndex)
			}
		}
		if finding.DataFlow != nil {
			if finding.DataFlow.AnalysisMethod != "ai-context" && finding.DataFlow.AnalysisMethod != "ast-assisted" {
				return fmt.Errorf("findings[%d].dataFlow has invalid analysisMethod", index)
			}
			if len(finding.DataFlow.Nodes) < 2 || finding.DataFlow.Nodes[0].Kind != "source" || finding.DataFlow.Nodes[len(finding.DataFlow.Nodes)-1].Kind != "sink" {
				return fmt.Errorf("findings[%d].dataFlow must start at a source and end at a sink", index)
			}
			if finding.DataFlow.Limitations == nil {
				return fmt.Errorf("findings[%d].dataFlow limitations array is required", index)
			}
			for nodeIndex, node := range finding.DataFlow.Nodes {
				if node.Kind != "source" && node.Kind != "propagator" && node.Kind != "sink" {
					return fmt.Errorf("findings[%d].dataFlow.nodes[%d] has invalid kind", index, nodeIndex)
				}
				if blank(node.Label, node.Path, node.Symbol, node.Expression) || strings.Contains(node.Path, "\\") || path.IsAbs(node.Path) || strings.HasPrefix(path.Clean(node.Path), "../") || node.Line < 1 {
					return fmt.Errorf("findings[%d].dataFlow.nodes[%d] has invalid evidence", index, nodeIndex)
				}
			}
		}
	}
	for index, item := range report.ManualReview {
		if blank(item.ID, item.Title, item.Rule, item.Reason, item.RequiredEvidence) {
			return fmt.Errorf("manualReview[%d] has incomplete fields", index)
		}
		if ids[item.ID] {
			return fmt.Errorf("duplicate report item ID %q", item.ID)
		}
		ids[item.ID] = true
	}
	if counts["critical"] != report.Summary.Critical || counts["high"] != report.Summary.High || counts["medium"] != report.Summary.Medium || counts["low"] != report.Summary.Low || len(report.ManualReview) != report.Summary.ManualReview {
		return fmt.Errorf("summary counts do not match report items")
	}
	if report.Result == "pass" && (len(report.Findings) > 0 || len(report.ManualReview) > 0) {
		return fmt.Errorf("pass reports cannot contain findings or manual review items")
	}
	if report.Coverage.Checked == nil || report.Coverage.NotChecked == nil || report.Coverage.Tools == nil {
		return fmt.Errorf("coverage arrays are required")
	}
	return nil
}

func blank(values ...string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return true
		}
	}
	return false
}
