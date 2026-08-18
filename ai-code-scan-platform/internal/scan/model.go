package scan

import "time"

type Source string
type ActorType string
type BillingMode string
type ScanMode string
type ScanLevel string
type SecurityCapability string
type Priority string

const (
	SourcePlugin   Source = "plugin"
	SourcePlatform Source = "platform"

	ActorAnonymous ActorType = "anonymous"
	ActorUser      ActorType = "user"

	BillingFree   BillingMode = "free"
	BillingCredit BillingMode = "credit"

	ScanModeStandard             ScanMode           = "standard"
	ScanModeDeep                 ScanMode           = "deep"
	ScanLevelLite                ScanLevel          = "lite"
	ScanLevelStandard            ScanLevel          = "standard"
	ScanLevelRelease             ScanLevel          = "release"
	CapabilityCodeSecurity       SecurityCapability = "code-security"
	CapabilityThreatModeling     SecurityCapability = "threat-modeling"
	CapabilityAgentSkillSecurity SecurityCapability = "agent-skill-security"
	CapabilityRedTeam            SecurityCapability = "red-team"
	PriorityNormal               Priority           = "normal"
	PriorityUrgent               Priority           = "urgent"
)

type Status string

const (
	StatusQueued      Status = "queued"
	StatusCloning     Status = "cloning"
	StatusIndexing    Status = "indexing"
	StatusAnalyzing   Status = "analyzing"
	StatusNormalizing Status = "normalizing"
	StatusCompleted   Status = "completed"
	StatusPartial     Status = "partial"
	StatusFailed      Status = "failed"
	StatusCancelled   Status = "cancelled"
)

type Task struct {
	ID                        string            `json:"id"`
	ProjectName               string            `json:"projectName"`
	RepositoryURL             string            `json:"repositoryUrl"`
	GitRef                    string            `json:"gitRef"`
	SkillSourceID             *int64            `json:"skillSourceId,omitempty"`
	Source                    Source            `json:"source"`
	ActorType                 ActorType         `json:"actorType"`
	ActorID                   *string           `json:"actorId,omitempty"`
	CreatorName               string            `json:"creatorName"`
	CreatorEmployeeNo         string            `json:"creatorEmployeeNo"`
	BillingMode               BillingMode       `json:"billingMode"`
	EstimatedCredits          int               `json:"estimatedCredits"`
	ChargedCredits            int               `json:"chargedCredits"`
	AIInputTokens             uint64            `json:"aiInputTokens"`
	AIOutputTokens            uint64            `json:"aiOutputTokens"`
	AITotalTokens             uint64            `json:"aiTotalTokens"`
	AITokenEstimated          bool              `json:"aiTokenUsageEstimated"`
	HasReport                 bool              `json:"hasReport"`
	HasSourceCode             bool              `json:"hasSourceCode"`
	ScannedFiles              int               `json:"scannedFiles"`
	CodeLines                 int               `json:"codeLines"`
	FindingCount              int               `json:"findingCount"`
	ScanConfiguration         ScanConfiguration `json:"scanConfiguration"`
	Status                    Status            `json:"status"`
	Stage                     string            `json:"stage"`
	Progress                  int               `json:"progress"`
	StatusMessage             string            `json:"statusMessage"`
	QueuePosition             int               `json:"queuePosition"`
	CreatedAt                 time.Time         `json:"createdAt"`
	UpdatedAt                 time.Time         `json:"updatedAt"`
	repositoryTokenCiphertext string
	sourceArchive             []byte
}

type ScanRequestEnvelope struct {
	SchemaVersion string             `json:"schemaVersion"`
	EventID       string             `json:"eventId"`
	EventType     string             `json:"eventType"`
	OccurredAt    time.Time          `json:"occurredAt"`
	Task          ScanRequestMessage `json:"task"`
}

type ScanRequestMessage struct {
	ID                string            `json:"id"`
	ProjectName       string            `json:"projectName"`
	RepositoryURL     string            `json:"repositoryUrl"`
	GitRef            string            `json:"gitRef"`
	Mode              ScanMode          `json:"mode"`
	ScanLevel         ScanLevel         `json:"scanLevel"`
	Priority          Priority          `json:"priority"`
	QueuePosition     int               `json:"queuePosition"`
	ScanConfiguration ScanConfiguration `json:"scanConfiguration"`
	Callbacks         ScanCallbacks     `json:"callbacks"`
}

type ScanCallbacks struct {
	StatusURL               string `json:"statusUrl"`
	ReportURL               string `json:"reportUrl"`
	RepositoryCredentialURL string `json:"repositoryCredentialUrl,omitempty"`
	ArchiveURL              string `json:"archiveUrl,omitempty"`
	AuthType                string `json:"authType"`
	Header                  string `json:"header"`
}

type RepositoryCredential struct {
	AuthorizationHeader string `json:"authorizationHeader"`
}

type TaskDetail struct {
	Task
	ReportJSON     string         `json:"reportJson,omitempty"`
	ReportMarkdown string         `json:"reportMarkdown,omitempty"`
	SourceSnapshot SourceSnapshot `json:"sourceSnapshot"`
	Logs           []TaskLog      `json:"logs"`
}

type TaskLog struct {
	Level     string    `json:"level"`
	Stage     string    `json:"stage"`
	Progress  int       `json:"progress"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"createdAt"`
}

type ScanConfiguration struct {
	ProductID          string               `json:"productId,omitempty"`
	ProductName        string               `json:"productName,omitempty"`
	Mode               ScanMode             `json:"mode"`
	ScanLevel          ScanLevel            `json:"scanLevel"`
	Priority           Priority             `json:"priority"`
	AIEnabled          bool                 `json:"aiEnabled"`
	AIModelID          string               `json:"aiModelId,omitempty"`
	ExcludeDirectories []string             `json:"excludeDirectories"`
	ExcludePatterns    []string             `json:"excludePatterns"`
	ScanDirectories    []string             `json:"scanDirectories"`
	VulnerabilityTypes []string             `json:"vulnerabilityTypes"`
	Capabilities       []SecurityCapability `json:"capabilities"`
}

type DailyScanCount struct {
	Date      string `json:"date"`
	Completed int    `json:"completed"`
}

type RiskDistribution struct {
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
}

type AITokenTotals struct {
	TaskCount    uint64 `json:"taskCount"`
	InputTokens  uint64 `json:"inputTokens"`
	OutputTokens uint64 `json:"outputTokens"`
	TotalTokens  uint64 `json:"totalTokens"`
}

type Statistics struct {
	Trend                   []DailyScanCount `json:"trend"`
	CurrentPeriodCompleted  int              `json:"currentPeriodCompleted"`
	PreviousPeriodCompleted int              `json:"previousPeriodCompleted"`
	ChangePercent           *float64         `json:"changePercent"`
	RiskDistribution        RiskDistribution `json:"riskDistribution"`
	AITokenUsage            AITokenTotals    `json:"aiTokenUsage"`
}

type CreateTaskInput struct {
	ProjectName        string               `json:"projectName"`
	ProductID          string               `json:"productId,omitempty"`
	ProductName        string               `json:"productName,omitempty"`
	RepositoryURL      string               `json:"repositoryUrl"`
	RepositoryToken    string               `json:"repositoryToken,omitempty"`
	GitRef             string               `json:"gitRef"`
	SkillSourceID      *int64               `json:"skillSourceId,omitempty"`
	AIModelID          string               `json:"aiModelId,omitempty"`
	EstimatedLines     int                  `json:"estimatedLines,omitempty"`
	Mode               ScanMode             `json:"mode,omitempty"`
	ScanLevel          ScanLevel            `json:"scanLevel,omitempty"`
	Priority           Priority             `json:"priority,omitempty"`
	AIEnabled          *bool                `json:"aiEnabled,omitempty"`
	PremiumModel       *bool                `json:"premiumModel,omitempty"`
	ExcludeDirectories []string             `json:"excludeDirectories,omitempty"`
	ExcludePatterns    []string             `json:"excludePatterns,omitempty"`
	ScanDirectories    []string             `json:"scanDirectories,omitempty"`
	VulnerabilityTypes []string             `json:"vulnerabilityTypes,omitempty"`
	Capabilities       []SecurityCapability `json:"capabilities,omitempty"`
}

type UpdateTaskInput struct {
	Status        Status `json:"status"`
	Stage         string `json:"stage"`
	Progress      int    `json:"progress"`
	StatusMessage string `json:"statusMessage"`
}

type UploadReportInput struct {
	SchemaVersion  string           `json:"schemaVersion"`
	ReportID       string           `json:"reportId"`
	GeneratedAt    string           `json:"generatedAt"`
	WorkspaceLabel string           `json:"workspaceLabel"`
	ReportJSON     string           `json:"reportJson"`
	SourceSnapshot SourceSnapshot   `json:"sourceSnapshot"`
	AITokenUsage   AITokenUsage     `json:"aiTokenUsage"`
	Statistics     ReportStatistics `json:"-"`
}

type ReportStatistics struct {
	ScannedFiles int
	CodeLines    int
	FindingCount int
}

type AITokenUsage struct {
	InputTokens  uint64 `json:"inputTokens"`
	OutputTokens uint64 `json:"outputTokens"`
	TotalTokens  uint64 `json:"totalTokens"`
	Estimated    bool   `json:"estimated"`
}

type SourceSnapshot struct {
	GitStatus string               `json:"gitStatus"`
	Diff      string               `json:"diff"`
	Files     []SourceSnapshotFile `json:"files"`
}

type SourceSnapshotFile struct {
	Path    string `json:"path"`
	Kind    string `json:"kind"`
	Content string `json:"content"`
}
