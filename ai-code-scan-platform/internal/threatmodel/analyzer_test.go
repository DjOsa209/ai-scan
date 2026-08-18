package threatmodel

import (
	"strings"
	"testing"
	"time"
)

func TestAnalyzerBuildsSystemModelAndEvidenceBackedSTRIDEThreats(t *testing.T) {
	fixedTime := time.Date(2026, 8, 14, 9, 30, 0, 0, time.UTC)
	analyzer := NewAnalyzer()
	analyzer.now = func() time.Time { return fixedTime }

	result := analyzer.Analyze("支付回调服务", Configuration{
		Environment:  "production",
		Mode:         "baseline",
		ScopeSummary: "重点确认订单资源隔离和支付回调的完整性",
		ScopeDocuments: []Document{{
			Name:    "architecture.md",
			Content: "The API stores orders in MySQL and receives a payment webhook from a partner.",
		}},
	}, []SourceFile{{
		Path: "internal/payment/handler.go",
		Content: strings.Join([]string{
			`router.Get("/orders/{orderId}", authenticate(getOrder))`,
			`func paymentWebhook(signature string, body []byte) {`,
			`  verifySignature(signature, body)`,
			`  logger.Info("payment token", token)`,
			`}`,
		}, "\n"),
	}})

	if len(result.SystemOverview.Components) < 3 {
		t.Fatalf("expected API, identity, data-store and/or external components, got %#v", result.SystemOverview.Components)
	}
	if len(result.SystemOverview.TrustBoundaries) < 2 || len(result.SystemOverview.DataFlows) < 2 {
		t.Fatalf("expected inferred boundaries and data flows, got %#v / %#v", result.SystemOverview.TrustBoundaries, result.SystemOverview.DataFlows)
	}

	resourceThreat := findThreatByTitle(result.Threats, "资源访问缺少可确认的归属授权")
	if resourceThreat == nil || !contains(resourceThreat.STRIDE, "E") || len(resourceThreat.Evidence) == 0 {
		t.Fatalf("expected evidence-backed resource authorization threat, got %#v", resourceThreat)
	}
	callbackThreat := findThreatByTitle(result.Threats, "已签名回调缺少可确认的防重放控制")
	if callbackThreat == nil || callbackThreat.Confidence != "high" {
		t.Fatalf("expected callback replay threat, got %#v", callbackThreat)
	}
	loggingThreat := findThreatByTitle(result.Threats, "日志可能记录安全敏感字段")
	if loggingThreat == nil || loggingThreat.Evidence[0] != "internal/payment/handler.go:4" {
		t.Fatalf("expected exact sensitive logging evidence, got %#v", loggingThreat)
	}
	if result.Summary.High < 2 || result.Summary.Open != len(result.Threats) || len(result.AttackPaths) < 2 {
		t.Fatalf("unexpected result summary or attack paths: %#v / %#v", result.Summary, result.AttackPaths)
	}
	if result.Logs[0].Time != fixedTime {
		t.Fatalf("expected deterministic analysis clock, got %s", result.Logs[0].Time)
	}
}

func TestAnalyzerMarksDocumentOnlyCoverageAndAssumptions(t *testing.T) {
	result := NewAnalyzer().Analyze("设计阶段 API", Configuration{
		Environment:    "staging",
		Mode:           "baseline",
		ScopeDocuments: []Document{{Name: "api.md", Content: "POST /callbacks/payment verifies HMAC signature."}},
	}, nil)

	if result.Coverage.SourceFiles != 0 || len(result.Coverage.Limitations) == 0 {
		t.Fatalf("expected explicit document-only limitation, got %#v", result.Coverage)
	}
	if !strings.Contains(strings.Join(result.Coverage.Limitations, " "), "未提供源码证据") {
		t.Fatalf("expected missing-source limitation, got %#v", result.Coverage.Limitations)
	}
	if len(result.Threats) == 0 {
		t.Fatal("expected a reviewable threat or assumption from the design input")
	}
	for _, threat := range result.Threats {
		if len(threat.Evidence) == 0 || threat.Evidence[0] == "" {
			t.Fatalf("threat must retain input evidence: %#v", threat)
		}
	}
}

func findThreatByTitle(threats []Threat, title string) *Threat {
	for index := range threats {
		if threats[index].Title == title {
			return &threats[index]
		}
	}
	return nil
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
