package reportjson

import (
	"strings"
	"testing"
)

const reportWithDataFlow = `{
  "schemaVersion":"2.0",
  "metadata":{"baseline":"sec-baseline.md","scope":"changed files","generatedAt":"unavailable"},
  "result":"findings",
  "summary":{"critical":0,"high":1,"medium":0,"low":0,"manualReview":0},
  "findings":[{
    "id":"SEC-001","title":"命令注入","severity":"high","rule":"INJ-01",
    "locations":[{"path":"api/handler.go","line":12}],"confidence":"high",
    "evidence":"请求参数进入命令执行","impact":"可执行任意命令","remediation":"使用参数化 API","verification":"运行安全测试",
    "dataFlow":{"analysisMethod":"ai-context","nodes":[
      {"kind":"source","label":"HTTP 参数","path":"api/handler.go","line":12,"symbol":"Handle","expression":"request.FormValue"},
      {"kind":"sink","label":"命令执行","path":"exec/run.go","line":30,"symbol":"exec.Command","expression":"command"}
    ],"limitations":["未执行运行时验证"]}
  }],
  "manualReview":[],"coverage":{"checked":["注入"],"notChecked":[],"tools":["workspace search"]}
}`

func TestValidateDataFlow(t *testing.T) {
	if err := Validate(reportWithDataFlow); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
}

func TestValidateRejectsIncompleteDataFlow(t *testing.T) {
	invalid := strings.Replace(reportWithDataFlow, `"kind":"source"`, `"kind":"propagator"`, 1)
	if err := Validate(invalid); err == nil || !strings.Contains(err.Error(), "must start at a source") {
		t.Fatalf("Validate() error = %v, want source/sink error", err)
	}
}
