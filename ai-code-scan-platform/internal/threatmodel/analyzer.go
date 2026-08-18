package threatmodel

import (
	"crypto/sha256"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Analyzer struct {
	now func() time.Time
}

func NewAnalyzer() *Analyzer { return &Analyzer{now: time.Now} }

type indexedSource struct {
	path    string
	content string
	lower   string
	lines   []string
}

var (
	routePattern      = regexp.MustCompile(`(?i)(handlefunc|\.(get|post|put|patch|delete)\s*\(|@(app|router)\.(get|post|put|patch|delete)|path\s*\()`)
	resourceIDPattern = regexp.MustCompile(`(?i)(\{[a-z_]*(id|key)[a-z_]*\}|/:[a-z_]*(id|key)[a-z_]*|queryrow|findbyid|getbyid)`)
	authPattern       = regexp.MustCompile(`(?i)(auth|jwt|oauth|oidc|session|principal|identity|bearer)`)
	ownershipPattern  = regexp.MustCompile(`(?i)(tenant[_-]?id|owner[_-]?id|authorize\s*\(|resource[_-]?owner|haspermission|checkaccess|check[_-]?permission)`)
	callbackPattern   = regexp.MustCompile(`(?i)(callback|webhook|notify[_-]?url|payment[_-]?notify)`)
	signaturePattern  = regexp.MustCompile(`(?i)(signature|hmac|verify[_-]?sign|check[_-]?sign)`)
	replayPattern     = regexp.MustCompile(`(?i)(nonce|timestamp|time[_-]?window|expires[_-]?at|idempotency|event[_-]?id)`)
	logPattern        = regexp.MustCompile(`(?i)(log\.|logger\.|printf\(|println\()`)
	sensitivePattern  = regexp.MustCompile(`(?i)(password|secret|token|credential|payment|card|order[_-]?id|authorization)`)
	sqlConcatPattern  = regexp.MustCompile(`(?i)(select|insert|update|delete)[^\n]*(\+|sprintf|format\s*\()`)
	corsWildcard      = regexp.MustCompile(`(?i)(allow[_-]?origin[^\n]*\*|allowedOrigins\s*[:=(]\s*["']\*["'])`)
	rateLimitPattern  = regexp.MustCompile(`(?i)(rate[_-]?limit|ratelimit|throttl|token[_-]?bucket)`)
	databasePattern   = regexp.MustCompile(`(?i)(mysql|postgres|dynamodb|mongodb|database/sql|gorm|sequelize|jdbc|redis)`)
	queuePattern      = regexp.MustCompile(`(?i)(rabbitmq|kafka|rocketmq|sqs|pubsub|message[_-]?queue)`)
	externalPattern   = regexp.MustCompile(`(?i)(https?://|http\.client|fetch\(|axios\.|requests\.|resttemplate)`)
	cryptoPattern     = regexp.MustCompile(`(?i)(tls|https|encrypt|aes|kms|signature|hmac)`)
)

func (analyzer *Analyzer) Analyze(title string, configuration Configuration, files []SourceFile) Result {
	sources := indexSources(configuration, files)
	overview := buildSystemOverview(title, configuration, sources)
	threats := analyzer.identifyThreats(sources, overview)
	paths := buildAttackPaths(threats)
	now := analyzer.now().UTC()
	preflight := []Preflight{
		{Name: "固定分析输入", Status: "complete", Detail: fmt.Sprintf("%d 个源码证据文件，%d 份范围文档", len(files), len(configuration.ScopeDocuments))},
		{Name: "校验输入大小与文本格式", Status: "complete", Detail: "仅分析受控文本内容，不执行被测代码"},
		{Name: "建立系统对象索引", Status: "complete", Detail: fmt.Sprintf("识别 %d 个组件和 %d 条数据流", len(overview.Components), len(overview.DataFlows))},
		{Name: "执行 STRIDE 规则", Status: "complete", Detail: fmt.Sprintf("生成 %d 项有证据或明确假设的威胁", len(threats))},
	}
	logs := []RunLog{
		{Time: now, Stage: "preflight", Message: "输入校验完成"},
		{Time: now, Stage: "modeling", Message: "已提取组件、资产、信任边界与数据流"},
		{Time: now, Stage: "threat-analysis", Message: "已对跨边界数据流执行 STRIDE 检查"},
		{Time: now, Stage: "evidence", Message: "威胁已关联到源码或范围文档证据"},
	}
	result := Result{
		SystemOverview: overview,
		Threats:        threats,
		AttackPaths:    paths,
		Preflight:      preflight,
		Logs:           logs,
		Coverage: Coverage{
			SourceFiles: len(files), ScopeDocuments: len(configuration.ScopeDocuments),
			Evidence: evidencePaths(sources), Limitations: coverageLimitations(configuration, files),
		},
	}
	result.Summary = summarize(result)
	return result
}

func indexSources(configuration Configuration, files []SourceFile) []indexedSource {
	result := make([]indexedSource, 0, len(files)+len(configuration.ScopeDocuments)+1)
	for _, file := range files {
		if content := strings.TrimSpace(file.Content); content != "" {
			result = append(result, newIndexedSource(file.Path, content))
		}
	}
	for _, document := range configuration.ScopeDocuments {
		if content := strings.TrimSpace(document.Content); content != "" {
			result = append(result, newIndexedSource("scope/"+filepath.Base(document.Name), content))
		}
	}
	if summary := strings.TrimSpace(configuration.ScopeSummary); summary != "" {
		result = append(result, newIndexedSource("scope/design-focus.txt", summary))
	}
	return result
}

func newIndexedSource(path, content string) indexedSource {
	return indexedSource{path: filepath.ToSlash(path), content: content, lower: strings.ToLower(content), lines: strings.Split(content, "\n")}
}

func buildSystemOverview(title string, configuration Configuration, sources []indexedSource) SystemOverview {
	joined := joinSources(sources)
	components := []Component{}
	if routePattern.MatchString(joined) {
		components = append(components, component("api", "API / Web 服务", "process", "接收并处理外部请求", firstEvidence(sources, routePattern)))
	}
	if authPattern.MatchString(joined) {
		components = append(components, component("identity", "身份与鉴权组件", "process", "验证用户或服务身份并建立安全上下文", firstEvidence(sources, authPattern)))
	}
	if databasePattern.MatchString(joined) {
		components = append(components, component("data-store", "数据存储", "data-store", "持久化业务数据、状态或缓存", firstEvidence(sources, databasePattern)))
	}
	if queuePattern.MatchString(joined) {
		components = append(components, component("message-bus", "消息系统", "process", "异步传递业务事件", firstEvidence(sources, queuePattern)))
	}
	if externalPattern.MatchString(joined) || callbackPattern.MatchString(joined) {
		components = append(components, component("external", "外部服务", "external-entity", "通过网络调用或回调与系统交互", firstEvidence(sources, externalPattern)))
	}
	if len(components) == 0 {
		components = append(components, component("application", "目标应用", "process", "实现范围文档中描述的业务能力", []string{firstPath(sources)}))
	}
	boundaries := []TrustBoundary{{Name: "用户 / 应用边界", Description: "不可信或低信任输入进入应用处理逻辑的位置"}}
	if databasePattern.MatchString(joined) {
		boundaries = append(boundaries, TrustBoundary{Name: "应用 / 数据边界", Description: "业务进程访问持久化数据和敏感资产的位置"})
	}
	if externalPattern.MatchString(joined) || callbackPattern.MatchString(joined) {
		boundaries = append(boundaries, TrustBoundary{Name: "应用 / 外部依赖边界", Description: "系统与第三方服务或公共网络交互的位置"})
	}
	flows := []DataFlow{}
	if hasComponent(components, "api") {
		flows = append(flows, DataFlow{Source: "外部主体", Target: "API / Web 服务", Data: "请求参数与身份凭据", Protection: protection(joined), Evidence: firstEvidence(sources, routePattern)})
	}
	if hasComponent(components, "data-store") {
		flows = append(flows, DataFlow{Source: primaryProcess(components), Target: "数据存储", Data: "业务数据与状态", Protection: databaseProtection(joined), Evidence: firstEvidence(sources, databasePattern)})
	}
	if hasComponent(components, "external") {
		flows = append(flows, DataFlow{Source: primaryProcess(components), Target: "外部服务", Data: "接口请求、响应或回调事件", Protection: externalProtection(joined), Evidence: mergeEvidence(firstEvidence(sources, externalPattern), firstEvidence(sources, callbackPattern))})
	}
	posture := []string{}
	if authPattern.MatchString(joined) {
		posture = append(posture, "检测到身份验证或会话控制")
	}
	if cryptoPattern.MatchString(joined) {
		posture = append(posture, "检测到传输加密、签名或密码控制")
	}
	if rateLimitPattern.MatchString(joined) {
		posture = append(posture, "检测到请求限流或节流控制")
	}
	if len(posture) == 0 {
		posture = append(posture, "输入证据未明确描述现有安全控制")
	}
	assets := detectAssets(joined)
	intent := strings.TrimSpace(configuration.ScopeSummary)
	if intent == "" {
		intent = "基于已有代码证据建立当前系统安全基线"
	}
	return SystemOverview{
		Purpose:      fmt.Sprintf("分析“%s”的架构和安全边界", strings.TrimSpace(title)),
		Capabilities: componentCapabilities(components), DesignIntent: intent,
		Architecture: fmt.Sprintf("从 %d 项输入证据中识别出 %d 个组件、%d 个信任边界和 %d 条关键数据流。", len(sources), len(components), len(boundaries), len(flows)),
		Components:   components, TrustBoundaries: boundaries, DataFlows: flows,
		SecurityPosture: posture, SensitiveAssets: assets,
		Assumptions: []string{"未出现在输入证据中的基础设施和补偿控制需要由架构负责人确认", "规则命中表示需要评审，不自动等同于可利用漏洞"},
	}
}

func (analyzer *Analyzer) identifyThreats(sources []indexedSource, overview SystemOverview) []Threat {
	joined := joinSources(sources)
	var threats []Threat
	add := func(rule string, severity Severity, stride []string, title, statement, source, action, impact string, prerequisites, assets, goals []string, evidence []string, recommendation, confidence string, assumption bool) {
		threats = append(threats, Threat{ID: threatID(rule, evidence), Title: title, Severity: severity, Status: ThreatOpen, STRIDE: stride, Statement: statement, Source: source, Action: action, Impact: impact, Prerequisites: prerequisites, Assets: assets, Goals: goals, Evidence: evidence, Recommendation: recommendation, Owner: "未分派", Confidence: confidence, Assumption: assumption, UpdatedAt: analyzer.now().UTC()})
	}
	if routePattern.MatchString(joined) && resourceIDPattern.MatchString(joined) && authPattern.MatchString(joined) && !ownershipPattern.MatchString(joined) {
		evidence := mergeEvidence(firstEvidence(sources, resourceIDPattern), firstEvidence(sources, authPattern))
		add("resource-authorization", SeverityHigh, []string{"E", "I"}, "资源访问缺少可确认的归属授权", "已认证主体可能通过替换资源标识访问不属于自己的对象。", "已认证的低权限用户", "修改路径或查询参数中的资源标识", "跨租户或跨用户数据泄露", []string{"接口按资源标识查询对象", "输入证据中未发现资源归属或租户约束"}, []string{"业务数据", "租户隔离"}, []string{"Confidentiality", "Authorization"}, evidence, "在业务服务层执行资源级授权，将查询条件绑定当前主体或 tenant_id，并增加越权负向测试。", "medium", false)
	}
	if callbackPattern.MatchString(joined) && signaturePattern.MatchString(joined) && !replayPattern.MatchString(joined) {
		evidence := mergeEvidence(firstEvidence(sources, callbackPattern), firstEvidence(sources, signaturePattern))
		add("callback-replay", SeverityHigh, []string{"S", "T"}, "已签名回调缺少可确认的防重放控制", "攻击者可能重复提交历史合法回调，触发重复状态变更。", "能够获得历史回调的外部攻击者", "重放仍可通过签名校验的回调报文", "重复记账、状态篡改或错误履约", []string{"存在外部回调入口", "仅验证签名但未发现时间窗、nonce 或幂等键"}, []string{"业务状态", "账务一致性"}, []string{"Integrity", "Authentication"}, evidence, "同时校验时间戳与一次性 nonce，并使用不可重复的事件 ID 保证业务幂等。", "high", false)
	}
	if evidence := sensitiveLogEvidence(sources); len(evidence) > 0 {
		add("sensitive-logging", SeverityMedium, []string{"I"}, "日志可能记录安全敏感字段", "日志语句附近出现凭据、支付或资源标识，可能扩大日志泄露影响。", "拥有日志读取权限的内部主体", "查询或导出包含敏感字段的日志", "凭据或业务数据泄露", []string{"敏感字段未经脱敏进入日志"}, []string{"凭据", "业务数据", "审计数据"}, []string{"Confidentiality"}, evidence, "建立日志字段 allowlist，对令牌、凭据和支付标识执行不可逆脱敏，并限制批量导出。", "medium", false)
	}
	if sqlConcatPattern.MatchString(joined) {
		evidence := firstEvidence(sources, sqlConcatPattern)
		add("sql-construction", SeverityCritical, []string{"T", "I", "E"}, "查询语句可能通过字符串拼接构造", "不可信输入进入拼接 SQL 时可能改变查询语义。", "能够控制查询参数的外部主体", "注入额外 SQL 片段", "数据读取、篡改或权限绕过", []string{"外部输入到达拼接查询"}, []string{"数据库", "业务数据"}, []string{"Integrity", "Confidentiality", "Authorization"}, evidence, "使用参数化查询或类型安全查询构造器，并对现有入口增加注入测试。", "high", false)
	}
	if corsWildcard.MatchString(joined) {
		evidence := firstEvidence(sources, corsWildcard)
		add("cors-wildcard", SeverityMedium, []string{"S", "I"}, "跨域策略允许任意来源", "浏览器客户端可能向不受信来源开放受保护响应。", "恶意网站", "诱导已登录用户发起跨域请求", "会话上下文中的数据泄露", []string{"浏览器携带身份上下文", "服务允许任意 Origin"}, []string{"用户会话", "API 数据"}, []string{"Confidentiality", "Authentication"}, evidence, "使用明确的可信 Origin allowlist，带凭据请求禁止通配符，并验证预检请求。", "high", false)
	}
	if routePattern.MatchString(joined) && !rateLimitPattern.MatchString(joined) {
		evidence := firstEvidence(sources, routePattern)
		add("rate-limit", SeverityLow, []string{"D"}, "公开请求入口缺少可确认的细粒度限流", "攻击者可能通过高频请求消耗应用或下游资源。", "外部或已认证主体", "持续调用高成本接口", "延迟上升或服务不可用", []string{"入口可被重复调用", "输入证据中未发现限流控制"}, []string{"服务可用性"}, []string{"Availability"}, evidence, "按主体、租户和接口成本配置限流与并发上限，并对下游连接池设置隔离。", "low", true)
	}
	if len(threats) == 0 {
		evidence := []string{firstPath(sources)}
		add("boundary-validation", SeverityMedium, []string{"T"}, "信任边界输入验证需要人工确认", "当前输入不足以确认所有跨边界数据均执行了结构、长度和语义校验。", "跨越信任边界的调用方", "提交异常或恶意构造的数据", "业务状态异常或下游组件受到影响", []string{"输入证据未覆盖完整验证链路"}, overview.SensitiveAssets, []string{"Integrity"}, evidence, "补充 API 规范、入口校验代码和负向测试证据后重新运行威胁模型。", "low", true)
	}
	sort.SliceStable(threats, func(left, right int) bool {
		return severityRank(threats[left].Severity) > severityRank(threats[right].Severity)
	})
	return threats
}

func buildAttackPaths(threats []Threat) []AttackPath {
	paths := make([]AttackPath, 0, len(threats))
	for _, threat := range threats {
		if threat.Severity != SeverityCritical && threat.Severity != SeverityHigh {
			continue
		}
		steps := []AttackStep{{Title: "满足前置条件", Detail: strings.Join(threat.Prerequisites, "；")}, {Title: "实施威胁动作", Detail: threat.Action}, {Title: "到达受影响资产", Detail: strings.Join(threat.Assets, "、")}, {Title: "产生安全影响", Detail: threat.Impact}}
		paths = append(paths, AttackPath{ID: "AP-" + strings.TrimPrefix(threat.ID, "TM-T-"), Title: threat.Title, Severity: threat.Severity, ThreatID: threat.ID, Steps: steps, ControlPoint: "威胁动作进入业务处理前", Recommendation: threat.Recommendation})
	}
	return paths
}

func summarize(result Result) Summary {
	summary := Summary{SystemObjects: len(result.SystemOverview.Components) + len(result.SystemOverview.TrustBoundaries) + len(result.SystemOverview.DataFlows), Assumptions: len(result.SystemOverview.Assumptions), STRIDEDistribution: map[string]int{"S": 0, "T": 0, "R": 0, "I": 0, "D": 0, "E": 0}}
	for _, threat := range result.Threats {
		switch threat.Severity {
		case SeverityCritical:
			summary.Critical++
		case SeverityHigh:
			summary.High++
		case SeverityMedium:
			summary.Medium++
		case SeverityLow:
			summary.Low++
		}
		if threat.Status == ThreatOpen {
			summary.Open++
		}
		for _, category := range threat.STRIDE {
			summary.STRIDEDistribution[category]++
		}
	}
	return summary
}

func component(id, name, kind, purpose string, evidence []string) Component {
	return Component{ID: id, Name: name, Kind: kind, Purpose: purpose, Evidence: evidence}
}

func firstEvidence(sources []indexedSource, pattern *regexp.Regexp) []string {
	for _, source := range sources {
		for index, line := range source.lines {
			if pattern.MatchString(line) {
				return []string{fmt.Sprintf("%s:%d", source.path, index+1)}
			}
		}
	}
	return nil
}

func sensitiveLogEvidence(sources []indexedSource) []string {
	for _, source := range sources {
		for index, line := range source.lines {
			if logPattern.MatchString(line) && sensitivePattern.MatchString(line) {
				return []string{fmt.Sprintf("%s:%d", source.path, index+1)}
			}
		}
	}
	return nil
}

func mergeEvidence(groups ...[]string) []string {
	seen := map[string]bool{}
	var result []string
	for _, group := range groups {
		for _, item := range group {
			if item != "" && !seen[item] {
				seen[item] = true
				result = append(result, item)
			}
		}
	}
	return result
}

func threatID(rule string, evidence []string) string {
	digest := sha256.Sum256([]byte(rule + "|" + strings.Join(evidence, "|")))
	return fmt.Sprintf("TM-T-%03d", int(digest[0])%900+100)
}

func joinSources(sources []indexedSource) string {
	var builder strings.Builder
	for _, source := range sources {
		builder.WriteString(source.lower)
		builder.WriteByte('\n')
	}
	return builder.String()
}

func firstPath(sources []indexedSource) string {
	if len(sources) == 0 {
		return "input unavailable"
	}
	return sources[0].path
}

func evidencePaths(sources []indexedSource) []string {
	result := make([]string, 0, len(sources))
	for _, source := range sources {
		result = append(result, source.path)
	}
	return result
}

func coverageLimitations(configuration Configuration, files []SourceFile) []string {
	var result []string
	if len(files) == 0 {
		result = append(result, "未提供源码证据，结果仅反映范围文档中的设计")
	}
	if len(configuration.ScopeDocuments) == 0 && strings.TrimSpace(configuration.ScopeSummary) == "" {
		result = append(result, "未提供范围文档，无法确认设计意图和尚未实现的变化")
	}
	result = append(result, "当前版本使用可解释的静态规则，不执行被测代码或主动攻击")
	return result
}

func hasComponent(components []Component, id string) bool {
	for _, candidate := range components {
		if candidate.ID == id {
			return true
		}
	}
	return false
}

func primaryProcess(components []Component) string {
	if hasComponent(components, "api") {
		return "API / Web 服务"
	}
	return components[0].Name
}

func componentCapabilities(components []Component) []string {
	result := make([]string, 0, len(components))
	for _, item := range components {
		result = append(result, item.Purpose)
	}
	return result
}

func detectAssets(joined string) []string {
	assets := []string{"业务数据", "服务可用性"}
	for _, candidate := range []struct{ pattern, name string }{{"token", "身份令牌与凭据"}, {"password", "用户凭据"}, {"payment", "支付与交易状态"}, {"order", "订单数据"}, {"tenant", "租户隔离边界"}, {"secret", "应用秘密"}} {
		if strings.Contains(joined, candidate.pattern) {
			assets = append(assets, candidate.name)
		}
	}
	return assets
}

func protection(joined string) string {
	if authPattern.MatchString(joined) {
		return "检测到身份验证；授权范围需要结合威胁逐项确认"
	}
	return "未检测到明确身份控制"
}

func databaseProtection(joined string) string {
	if ownershipPattern.MatchString(joined) {
		return "检测到租户、所有者或授权约束"
	}
	return "未检测到明确资源归属约束"
}

func externalProtection(joined string) string {
	if signaturePattern.MatchString(joined) && replayPattern.MatchString(joined) {
		return "检测到签名与防重放控制"
	}
	if signaturePattern.MatchString(joined) {
		return "检测到签名校验；防重放需要确认"
	}
	return "外部交互保护需要确认"
}

func severityRank(severity Severity) int {
	switch severity {
	case SeverityCritical:
		return 4
	case SeverityHigh:
		return 3
	case SeverityMedium:
		return 2
	default:
		return 1
	}
}
