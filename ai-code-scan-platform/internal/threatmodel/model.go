package threatmodel

import "time"

type ModelStatus string
type RunStatus string
type ThreatStatus string
type Severity string

const (
	ModelDraft     ModelStatus = "draft"
	ModelRunning   ModelStatus = "running"
	ModelCompleted ModelStatus = "completed"
	ModelFailed    ModelStatus = "failed"
	ModelStopped   ModelStatus = "stopped"

	RunRunning   RunStatus = "running"
	RunCompleted RunStatus = "completed"
	RunFailed    RunStatus = "failed"
	RunStopped   RunStatus = "stopped"

	ThreatOpen      ThreatStatus = "open"
	ThreatResolved  ThreatStatus = "resolved"
	ThreatDismissed ThreatStatus = "dismissed"

	SeverityCritical Severity = "critical"
	SeverityHigh     Severity = "high"
	SeverityMedium   Severity = "medium"
	SeverityLow      Severity = "low"
)

type Document struct {
	Name    string `json:"name"`
	Content string `json:"content,omitempty"`
}

type Configuration struct {
	SourceScanTaskID string     `json:"sourceScanTaskId,omitempty"`
	ScopeDocuments   []Document `json:"scopeDocuments"`
	ScopeSummary     string     `json:"scopeSummary,omitempty"`
	Environment      string     `json:"environment"`
	Mode             string     `json:"mode"`
}

type Model struct {
	ID            string        `json:"id"`
	ActorID       string        `json:"-"`
	Title         string        `json:"title"`
	Status        ModelStatus   `json:"status"`
	Configuration Configuration `json:"configuration"`
	LatestRun     *Run          `json:"latestRun,omitempty"`
	Runs          []RunSummary  `json:"runs"`
	CreatedAt     time.Time     `json:"createdAt"`
	UpdatedAt     time.Time     `json:"updatedAt"`
}

type RunSummary struct {
	ID            string     `json:"id"`
	Status        RunStatus  `json:"status"`
	Stage         string     `json:"stage"`
	Progress      int        `json:"progress"`
	StatusMessage string     `json:"statusMessage"`
	ThreatCount   int        `json:"threatCount"`
	StartedAt     time.Time  `json:"startedAt"`
	CompletedAt   *time.Time `json:"completedAt,omitempty"`
}

type Run struct {
	ID            string        `json:"id"`
	ModelID       string        `json:"threatModelId"`
	Status        RunStatus     `json:"status"`
	Stage         string        `json:"stage"`
	Progress      int           `json:"progress"`
	StatusMessage string        `json:"statusMessage"`
	Configuration Configuration `json:"configuration"`
	Result        *Result       `json:"result,omitempty"`
	ErrorMessage  string        `json:"errorMessage,omitempty"`
	StartedAt     time.Time     `json:"startedAt"`
	CompletedAt   *time.Time    `json:"completedAt,omitempty"`
}

type Result struct {
	Summary        Summary        `json:"summary"`
	SystemOverview SystemOverview `json:"systemOverview"`
	Threats        []Threat       `json:"threats"`
	AttackPaths    []AttackPath   `json:"attackPaths"`
	Preflight      []Preflight    `json:"preflight"`
	Logs           []RunLog       `json:"logs"`
	Coverage       Coverage       `json:"coverage"`
}

type Summary struct {
	Critical           int            `json:"critical"`
	High               int            `json:"high"`
	Medium             int            `json:"medium"`
	Low                int            `json:"low"`
	Open               int            `json:"open"`
	SystemObjects      int            `json:"systemObjects"`
	Assumptions        int            `json:"assumptions"`
	STRIDEDistribution map[string]int `json:"strideDistribution"`
}

type SystemOverview struct {
	Purpose         string          `json:"purpose"`
	Capabilities    []string        `json:"capabilities"`
	DesignIntent    string          `json:"designIntent"`
	Architecture    string          `json:"architecture"`
	Components      []Component     `json:"components"`
	TrustBoundaries []TrustBoundary `json:"trustBoundaries"`
	DataFlows       []DataFlow      `json:"dataFlows"`
	SecurityPosture []string        `json:"securityPosture"`
	SensitiveAssets []string        `json:"sensitiveAssets"`
	Assumptions     []string        `json:"assumptions"`
}

type Component struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	Purpose  string   `json:"purpose"`
	Evidence []string `json:"evidence"`
}

type TrustBoundary struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type DataFlow struct {
	Source     string   `json:"source"`
	Target     string   `json:"target"`
	Data       string   `json:"data"`
	Protection string   `json:"protection"`
	Evidence   []string `json:"evidence"`
}

type Threat struct {
	ID             string       `json:"id"`
	Title          string       `json:"title"`
	Severity       Severity     `json:"severity"`
	Status         ThreatStatus `json:"status"`
	STRIDE         []string     `json:"stride"`
	Statement      string       `json:"statement"`
	Source         string       `json:"source"`
	Action         string       `json:"action"`
	Impact         string       `json:"impact"`
	Prerequisites  []string     `json:"prerequisites"`
	Assets         []string     `json:"assets"`
	Goals          []string     `json:"goals"`
	Evidence       []string     `json:"evidence"`
	Recommendation string       `json:"recommendation"`
	Owner          string       `json:"owner"`
	Confidence     string       `json:"confidence"`
	Assumption     bool         `json:"assumption"`
	UpdatedAt      time.Time    `json:"updatedAt"`
}

type AttackPath struct {
	ID             string       `json:"id"`
	Title          string       `json:"title"`
	Severity       Severity     `json:"severity"`
	ThreatID       string       `json:"threatId"`
	Steps          []AttackStep `json:"steps"`
	ControlPoint   string       `json:"controlPoint"`
	Recommendation string       `json:"recommendation"`
}

type AttackStep struct {
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

type Preflight struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type RunLog struct {
	Time    time.Time `json:"time"`
	Stage   string    `json:"stage"`
	Message string    `json:"message"`
}

type Coverage struct {
	SourceFiles    int      `json:"sourceFiles"`
	ScopeDocuments int      `json:"scopeDocuments"`
	Evidence       []string `json:"evidence"`
	Limitations    []string `json:"limitations"`
}

type CreateModelInput struct {
	Title         string        `json:"title"`
	Configuration Configuration `json:"configuration"`
}

type UpdateThreatInput struct {
	Status ThreatStatus `json:"status"`
	Owner  *string      `json:"owner,omitempty"`
}

type CreateThreatInput struct {
	Title          string   `json:"title"`
	Severity       Severity `json:"severity"`
	STRIDE         []string `json:"stride"`
	Statement      string   `json:"statement"`
	Source         string   `json:"source"`
	Action         string   `json:"action"`
	Impact         string   `json:"impact"`
	Prerequisites  []string `json:"prerequisites"`
	Assets         []string `json:"assets"`
	Goals          []string `json:"goals"`
	Recommendation string   `json:"recommendation"`
}

type SourceFile struct {
	Path    string
	Content string
}
