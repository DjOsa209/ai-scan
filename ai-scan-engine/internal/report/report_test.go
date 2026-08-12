package report

import (
	"encoding/json"
	"testing"
)

func TestNewProducesPlatformSchema(t *testing.T) {
	value := New("repo@main", []Finding{{Severity: "high"}}, []string{}, []string{})
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	metadata := decoded["metadata"].(map[string]any)
	if decoded["schemaVersion"] != "2.0" || metadata["baseline"] != "sec-baseline.md" {
		t.Fatalf("unexpected report: %s", payload)
	}
	summary := decoded["summary"].(map[string]any)
	if summary["high"] != float64(1) {
		t.Fatalf("unexpected summary: %#v", summary)
	}
}
