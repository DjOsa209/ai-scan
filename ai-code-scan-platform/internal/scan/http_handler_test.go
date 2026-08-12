package scan

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ai-code-scan-platform/internal/auth"
)

type memoryRepository struct {
	task                           Task
	deletedTaskID                  string
	listedActorID                  string
	allListed                      bool
	pluginListed                   bool
	reportJSON                     string
	sourceSnapshot                 SourceSnapshot
	completedAt                    []time.Time
	distribution                   RiskDistribution
	tokenUsage                     AITokenTotals
	logs                           []TaskLog
	repositoryCredentialCiphertext string
	sourceArchive                  []byte
	sourceArchiveFilename          string
}

func (repository *memoryRepository) Create(_ context.Context, task Task) (Task, error) {
	repository.task = task
	repository.logs = append(repository.logs, TaskLog{Level: "info", Stage: task.Stage, Progress: task.Progress, Message: task.StatusMessage, CreatedAt: time.Now()})
	return task, nil
}

func (repository *memoryRepository) CreatePlatformAtomic(_ context.Context, task Task) (Task, error) {
	repository.task = task
	repository.repositoryCredentialCiphertext = task.repositoryTokenCiphertext
	repository.sourceArchive = append([]byte(nil), task.sourceArchive...)
	repository.sourceArchiveFilename = strings.TrimPrefix(task.RepositoryURL, "archive://upload/")
	repository.logs = append(repository.logs, TaskLog{Level: "info", Stage: task.Stage, Progress: task.Progress, Message: task.StatusMessage, CreatedAt: time.Now()})
	return task, nil
}

type testSecretCipher struct{}

func (testSecretCipher) Encrypt(value string) (string, error) { return "encrypted:" + value, nil }
func (testSecretCipher) Decrypt(value string) (string, error) {
	return strings.TrimPrefix(value, "encrypted:"), nil
}

func (repository *memoryRepository) Get(_ context.Context, _ string) (Task, error) {
	return repository.task, nil
}

func (repository *memoryRepository) GetPlatform(_ context.Context, _ string) (Task, error) {
	return repository.task, nil
}

func (repository *memoryRepository) List(_ context.Context, _, _ int) ([]Task, error) {
	repository.allListed = true
	return []Task{repository.task}, nil
}

func (repository *memoryRepository) GetByActor(_ context.Context, _ string, actorID string) (Task, error) {
	repository.listedActorID = actorID
	return repository.task, nil
}

func (repository *memoryRepository) DeleteByActor(_ context.Context, id, actorID string) error {
	repository.listedActorID = actorID
	if repository.task.ID != id {
		return errors.New("scan task not found")
	}
	repository.deletedTaskID = id
	repository.task = Task{}
	return nil
}

func (repository *memoryRepository) GetDetail(_ context.Context, _ string) (TaskDetail, error) {
	return TaskDetail{Task: repository.task, ReportJSON: repository.reportJSON, SourceSnapshot: repository.sourceSnapshot, Logs: repository.logs}, nil
}

func (repository *memoryRepository) ListByActor(_ context.Context, actorID string, _, _ int) ([]Task, error) {
	repository.listedActorID = actorID
	return []Task{repository.task}, nil
}

func (repository *memoryRepository) ListPlugin(_ context.Context, _, _ int) ([]Task, error) {
	repository.pluginListed = true
	return []Task{repository.task}, nil
}

func (repository *memoryRepository) ListPlatform(_ context.Context, _, _ int) ([]Task, error) {
	return []Task{repository.task}, nil
}

func (repository *memoryRepository) ListCompletedBetween(_ context.Context, actorID *string, _, _ time.Time) ([]time.Time, error) {
	if actorID != nil {
		repository.listedActorID = *actorID
	}
	return repository.completedAt, nil
}

func (repository *memoryRepository) GetRiskDistribution(_ context.Context, actorID *string) (RiskDistribution, error) {
	if actorID != nil {
		repository.listedActorID = *actorID
	}
	return repository.distribution, nil
}

func (repository *memoryRepository) GetAITokenUsage(_ context.Context, actorID *string) (AITokenTotals, error) {
	if actorID != nil {
		repository.listedActorID = *actorID
	}
	return repository.tokenUsage, nil
}

func (repository *memoryRepository) Update(_ context.Context, _ string, input UpdateTaskInput) (Task, error) {
	repository.task.Status = input.Status
	repository.task.Stage = input.Stage
	repository.task.Progress = input.Progress
	repository.task.StatusMessage = input.StatusMessage
	repository.logs = append(repository.logs, TaskLog{Level: "info", Stage: input.Stage, Progress: input.Progress, Message: input.StatusMessage, CreatedAt: time.Now()})
	return repository.task, nil
}

func (repository *memoryRepository) SaveReport(_ context.Context, _ string, input UploadReportInput) (Task, error) {
	repository.task.HasReport = true
	repository.task.HasSourceCode = true
	repository.task.AIInputTokens = input.AITokenUsage.InputTokens
	repository.task.AIOutputTokens = input.AITokenUsage.OutputTokens
	repository.task.AITotalTokens = input.AITokenUsage.TotalTokens
	repository.task.AITokenEstimated = input.AITokenUsage.Estimated
	repository.reportJSON = input.ReportJSON
	repository.sourceSnapshot = input.SourceSnapshot
	repository.logs = append(repository.logs, TaskLog{Level: "success", Stage: "报告生成", Progress: 100, Message: "扫描报告已保存", CreatedAt: time.Now()})
	return repository.task, nil
}

func (repository *memoryRepository) GetRepositoryCredentialCiphertext(_ context.Context, _ string) (string, error) {
	return repository.repositoryCredentialCiphertext, nil
}

func (repository *memoryRepository) GetSourceArchive(_ context.Context, _ string) ([]byte, string, error) {
	if len(repository.sourceArchive) == 0 {
		return nil, "", errors.New("source archive not found")
	}
	return append([]byte(nil), repository.sourceArchive...), repository.sourceArchiveFilename, nil
}

func TestCreateArchiveScanAndDownloadSource(t *testing.T) {
	var archive bytes.Buffer
	zipWriter := zip.NewWriter(&archive)
	entry, err := zipWriter.Create("src/main.go")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("package main\n")); err != nil {
		t.Fatal(err)
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}

	repository := &memoryRepository{}
	mux := http.NewServeMux()
	requireUser := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			user := auth.User{ID: "user-42", Email: "user@example.com", Name: "张伟", EmployeeNo: "A0042"}
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), user)))
		})
	}
	NewHandler(NewService(repository), "admin-secret", requireUser).RegisterRoutes(mux)

	metadata, err := json.Marshal(CreateTaskInput{ProjectName: "uploaded-project", EstimatedLines: 1000, ScanLevel: ScanLevelLite})
	if err != nil {
		t.Fatal(err)
	}
	var requestBody bytes.Buffer
	multipartWriter := multipart.NewWriter(&requestBody)
	if err := multipartWriter.WriteField("metadata", string(metadata)); err != nil {
		t.Fatal(err)
	}
	archivePart, err := multipartWriter.CreateFormFile("archive", "source.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := archivePart.Write(archive.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := multipartWriter.Close(); err != nil {
		t.Fatal(err)
	}

	createRequest := httptest.NewRequest(http.MethodPost, "/api/v1/scans/archive", &requestBody)
	createRequest.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	createResponse := httptest.NewRecorder()
	mux.ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", createResponse.Code, createResponse.Body.String())
	}
	if repository.task.RepositoryURL != "archive://upload/source.zip" {
		t.Fatalf("unexpected repository URL: %q", repository.task.RepositoryURL)
	}

	downloadRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/scans/"+repository.task.ID+"/source-archive", nil)
	downloadRequest.Header.Set("Authorization", "Bearer admin-secret")
	downloadResponse := httptest.NewRecorder()
	mux.ServeHTTP(downloadResponse, downloadRequest)
	if downloadResponse.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", downloadResponse.Code, downloadResponse.Body.String())
	}
	if !bytes.Equal(downloadResponse.Body.Bytes(), archive.Bytes()) {
		t.Fatal("downloaded archive differs from uploaded archive")
	}
}

func TestCreateAndGetScan(t *testing.T) {
	enabled := true
	mux := http.NewServeMux()
	NewHandler(NewService(&memoryRepository{}).WithRepositoryAccessVerifier(&recordingRepositoryAccessVerifier{}), "admin-secret", func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-42", Email: "user@example.com", Name: "张伟", EmployeeNo: "A0042"})))
		})
	}).RegisterRoutes(mux)

	body, _ := json.Marshal(CreateTaskInput{
		ProjectName: "payments", RepositoryURL: "https://git.example.com/team/payments.git", GitRef: "main",
		EstimatedLines: 20000, Mode: ScanModeDeep, Priority: PriorityUrgent, AIEnabled: &enabled, PremiumModel: &enabled,
		ExcludeDirectories: []string{"vendor"}, ExcludePatterns: []string{"*.min.js"}, ScanDirectories: []string{"src"}, VulnerabilityTypes: []string{"SQL注入"},
	})
	createRequest := httptest.NewRequest(http.MethodPost, "/api/v1/scans", bytes.NewReader(body))
	createResponse := httptest.NewRecorder()
	mux.ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", createResponse.Code, createResponse.Body.String())
	}

	var created struct {
		Task
		CreatorName       string `json:"creatorName"`
		CreatorEmployeeNo string `json:"creatorEmployeeNo"`
	}
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Status != StatusQueued || created.ActorID == nil || *created.ActorID != "user-42" || created.EstimatedCredits != 248 || len(created.ScanConfiguration.ExcludeDirectories) != 1 || created.ScanConfiguration.ScanDirectories[0] != "src" {
		t.Fatalf("unexpected task: %#v", created)
	}
	if created.CreatorName != "张伟" || created.CreatorEmployeeNo != "A0042" {
		t.Fatalf("expected creator snapshot metadata, got name=%q employeeNo=%q", created.CreatorName, created.CreatorEmployeeNo)
	}

	getRequest := httptest.NewRequest(http.MethodGet, "/api/v1/scans/"+created.ID, nil)
	getResponse := httptest.NewRecorder()
	mux.ServeHTTP(getResponse, getRequest)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", getResponse.Code)
	}
}

func TestDeleteScanForAuthenticatedUser(t *testing.T) {
	repository := &memoryRepository{task: Task{ID: "scan-1", Status: StatusCompleted}}
	mux := http.NewServeMux()
	NewHandler(NewService(repository), "admin-secret", func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-42", Email: "user@example.com"})))
		})
	}).RegisterRoutes(mux)

	request := httptest.NewRequest(http.MethodDelete, "/api/v1/scans/scan-1", nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", response.Code, response.Body.String())
	}
	if repository.deletedTaskID != "scan-1" {
		t.Fatalf("expected scan-1 to be deleted, got %q", repository.deletedTaskID)
	}
	if repository.listedActorID != "user-42" {
		t.Fatalf("expected deletion to be scoped to user-42, got %q", repository.listedActorID)
	}
}

func TestRescanCreatesQueuedTaskWithOriginalConfigurationAndCredential(t *testing.T) {
	actorID := "user-42"
	repository := &memoryRepository{
		task: Task{
			ID: "scan-old", ProjectName: "private", RepositoryURL: "https://git.example.com/private.git", GitRef: "release",
			Source: SourcePlatform, ActorType: ActorUser, ActorID: &actorID, BillingMode: BillingCredit, EstimatedCredits: 88,
			ScanConfiguration: ScanConfiguration{
				Mode: ScanModeDeep, ScanLevel: ScanLevelRelease, Priority: PriorityUrgent, AIEnabled: true, AIModelID: "model-1",
				ExcludeDirectories: []string{"vendor"}, ExcludePatterns: []string{"*.min.js"}, ScanDirectories: []string{"src"}, VulnerabilityTypes: []string{"SQL注入"},
			},
			Status: StatusFailed,
		},
		repositoryCredentialCiphertext: "encrypted:repo-secret",
	}
	mux := http.NewServeMux()
	NewHandler(NewService(repository).WithSecretCipher(testSecretCipher{}), "admin-secret", func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), auth.User{ID: actorID, Email: "user@example.com", Name: "李敏", EmployeeNo: "A0148"})))
		})
	}).RegisterRoutes(mux)

	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/scans/scan-old/rescan", nil))

	if response.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", response.Code, response.Body.String())
	}
	if repository.task.ID == "scan-old" || repository.task.Status != StatusQueued || repository.task.ActorID == nil || *repository.task.ActorID != actorID {
		t.Fatalf("unexpected rescanned task: %#v", repository.task)
	}
	if repository.task.CreatorName != "李敏" || repository.task.CreatorEmployeeNo != "A0148" {
		t.Fatalf("rescan did not snapshot current creator metadata: %#v", repository.task)
	}
	if repository.task.EstimatedCredits != 88 || repository.task.ScanConfiguration.ScanLevel != ScanLevelRelease || repository.task.ScanConfiguration.ScanDirectories[0] != "src" {
		t.Fatalf("rescan did not preserve scan configuration: %#v", repository.task)
	}
	if repository.repositoryCredentialCiphertext != "encrypted:repo-secret" {
		t.Fatalf("rescan did not preserve encrypted repository credential: %q", repository.repositoryCredentialCiphertext)
	}
}

func TestPlatformRepositoryTokenIsEncryptedAndOnlyAvailableToEngine(t *testing.T) {
	repository := &memoryRepository{}
	mux := http.NewServeMux()
	service := NewService(repository).WithSecretCipher(testSecretCipher{}).WithRepositoryAccessVerifier(&recordingRepositoryAccessVerifier{})
	NewHandler(service, "admin-secret", func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-42"})))
		})
	}).RegisterRoutes(mux)

	body := []byte(`{"projectName":"private","repositoryUrl":"https://git.example.com/private.git","repositoryToken":"repo-secret","gitRef":"main","estimatedLines":1000,"scanLevel":"lite"}`)
	created := httptest.NewRecorder()
	mux.ServeHTTP(created, httptest.NewRequest(http.MethodPost, "/api/v1/scans", bytes.NewReader(body)))
	if created.Code != http.StatusAccepted || strings.Contains(created.Body.String(), "repo-secret") || repository.repositoryCredentialCiphertext != "encrypted:repo-secret" {
		t.Fatalf("repository token was not safely stored: %d %s", created.Code, created.Body.String())
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/scans/"+repository.task.ID+"/repository-credential", nil)
	request.Header.Set("Authorization", "Bearer admin-secret")
	credential := httptest.NewRecorder()
	mux.ServeHTTP(credential, request)
	if credential.Code != http.StatusOK || credential.Header().Get("Cache-Control") != "no-store" || !strings.Contains(credential.Body.String(), `"authorizationHeader":"Basic b2F1dGgyOnJlcG8tc2VjcmV0"`) {
		t.Fatalf("unexpected credential response: %d %s", credential.Code, credential.Body.String())
	}
}

func TestListAndGetPlatformScansUseAuthenticatedActor(t *testing.T) {
	repository := &memoryRepository{task: Task{ID: "scan-1", Source: SourcePlatform}}
	mux := http.NewServeMux()
	NewHandler(NewService(repository), "admin-secret", func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-42", Role: "user"})))
		})
	}).RegisterRoutes(mux)

	for _, target := range []string{"/api/v1/scans", "/api/v1/scans/scan-1"} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("expected GET %s to return 200, got %d: %s", target, response.Code, response.Body.String())
		}
		if repository.listedActorID != "user-42" {
			t.Fatalf("expected actor-scoped repository query, got %q", repository.listedActorID)
		}
	}
}

func TestAdminScanListIncludesPluginTasks(t *testing.T) {
	repository := &memoryRepository{task: Task{ID: "plugin-1", Source: SourcePlugin}}
	mux := http.NewServeMux()
	NewHandler(NewService(repository), "admin-secret", func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "admin-1", Role: "admin"})))
		})
	}).RegisterRoutes(mux)

	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/scans", nil))
	if response.Code != http.StatusOK || !repository.allListed {
		t.Fatalf("expected admin list to include all scan sources, got %d: %s", response.Code, response.Body.String())
	}
}

func TestEngineCanUpdatePlatformScanWithAdminToken(t *testing.T) {
	repository := &memoryRepository{task: Task{ID: "scan-1", Source: SourcePlatform, Status: StatusQueued, Stage: "等待扫描"}}
	mux := http.NewServeMux()
	NewHandler(NewService(repository), "admin-secret").RegisterRoutes(mux)
	body := []byte(`{"status":"cloning","stage":"获取代码","progress":5,"statusMessage":"正在获取指定版本"}`)

	unauthorized := httptest.NewRecorder()
	mux.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodPatch, "/api/v1/admin/scans/scan-1", bytes.NewReader(body)))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without engine token, got %d", unauthorized.Code)
	}

	request := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/scans/scan-1", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer admin-secret")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK || repository.task.Status != StatusCloning || repository.task.Progress != 5 {
		t.Fatalf("unexpected engine update response %d: %s", response.Code, response.Body.String())
	}
}

func TestPluginListUsesAnonymousPluginQuery(t *testing.T) {
	repository := &memoryRepository{task: Task{ID: "plugin-1", Source: SourcePlugin, ActorType: ActorAnonymous}}
	mux := http.NewServeMux()
	NewHandler(NewService(repository), "admin-secret").WithPluginAuthentication(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-42"})))
		})
	}).RegisterRoutes(mux)

	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/plugin/scans", nil))
	if response.Code != http.StatusOK || repository.listedActorID != "user-42" {
		t.Fatalf("expected user-scoped list query, got %d: %s", response.Code, response.Body.String())
	}
}

func TestPlatformScanRejectsClientOwnershipAndPrice(t *testing.T) {
	mux := http.NewServeMux()
	NewHandler(NewService(&memoryRepository{}), "admin-secret", func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-42"})))
		})
	}).RegisterRoutes(mux)

	request := httptest.NewRequest(http.MethodPost, "/api/v1/scans", bytes.NewReader([]byte(`{
		"projectName":"payments",
		"repositoryUrl":"https://git.example.com/team/payments.git",
		"gitRef":"main",
		"ownerId":"forged-user",
		"estimatedCredits":1
	}`)))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
}

func TestPlatformReportUploadAppliesPersistedScopeRules(t *testing.T) {
	repository := &memoryRepository{task: Task{
		ID: "scan-1", Source: SourcePlatform,
		ScanConfiguration: ScanConfiguration{
			ScanDirectories: []string{"src"}, ExcludeDirectories: []string{"vendor"}, ExcludePatterns: []string{"*.min.js"},
		},
	}}
	mux := http.NewServeMux()
	NewHandler(NewService(repository), "admin-secret").RegisterRoutes(mux)
	reportBody, _ := json.Marshal(UploadReportInput{
		SchemaVersion: "2.0", ReportID: "report-1", GeneratedAt: "2026-08-09T00:00:00Z", WorkspaceLabel: "payments",
		ReportJSON:   `{"schemaVersion":"2.0","metadata":{"baseline":"sec-baseline.md","scope":"configured files","generatedAt":"2026-08-09T00:00:00Z"},"result":"pass","summary":{"critical":0,"high":0,"medium":0,"low":0,"manualReview":0},"findings":[],"manualReview":[],"coverage":{"checked":["configured source"],"notChecked":[],"tools":["internal"]}}`,
		AITokenUsage: AITokenUsage{InputTokens: 10, OutputTokens: 5, TotalTokens: 15, Estimated: true},
		SourceSnapshot: SourceSnapshot{
			GitStatus: "M src/main.go\nM src/README.md\nM src/app.min.js\nM vendor/lib.go",
			Files: []SourceSnapshotFile{
				{Path: "src/main.go", Kind: "changed", Content: "package main"},
				{Path: "src/README.md", Kind: "changed", Content: "documentation"},
				{Path: "src/app.min.js", Kind: "changed", Content: "minified"},
				{Path: "vendor/lib.go", Kind: "changed", Content: "package vendor"},
			},
		},
	})
	request := httptest.NewRequest(http.MethodPut, "/api/v1/admin/scans/scan-1/report", bytes.NewReader(reportBody))
	request.Header.Set("Authorization", "Bearer admin-secret")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if len(repository.sourceSnapshot.Files) != 1 || repository.sourceSnapshot.Files[0].Path != "src/main.go" {
		t.Fatalf("scope rules were not applied: %#v", repository.sourceSnapshot.Files)
	}
}

func TestPluginScanLifecycle(t *testing.T) {
	repository := &memoryRepository{}
	mux := http.NewServeMux()
	requireUser := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-42"})))
		})
	}
	NewHandler(NewService(repository), "admin-secret", requireUser).WithPluginAuthentication(requireUser).RegisterRoutes(mux)

	body, _ := json.Marshal(CreateTaskInput{
		ProjectName: "local-workspace", RepositoryURL: "workspace://local/local-workspace", GitRef: "working-tree",
	})
	createRequest := httptest.NewRequest(http.MethodPost, "/api/v1/plugin/scans", bytes.NewReader(body))
	createRequest.RemoteAddr = "127.0.0.1:32100"
	createResponse := httptest.NewRecorder()
	mux.ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", createResponse.Code, createResponse.Body.String())
	}
	if repository.task.Source != SourcePlugin || repository.task.ActorType != ActorUser || repository.task.ActorID == nil || *repository.task.ActorID != "user-42" || repository.task.BillingMode != BillingCredit || repository.task.EstimatedCredits != 133 {
		t.Fatalf("plugin scan must be billed to the API key owner: %#v", repository.task)
	}

	updateBody, _ := json.Marshal(UpdateTaskInput{
		Status: StatusAnalyzing, Stage: "AI 深度审计", Progress: 55, StatusMessage: "正在验证跨文件数据流",
	})
	updateRequest := httptest.NewRequest(http.MethodPatch, "/api/v1/plugin/scans/"+repository.task.ID, bytes.NewReader(updateBody))
	updateRequest.RemoteAddr = "127.0.0.1:32100"
	updateResponse := httptest.NewRecorder()
	mux.ServeHTTP(updateResponse, updateRequest)
	if updateResponse.Code != http.StatusOK || repository.task.Progress != 55 {
		t.Fatalf("unexpected update response %d: %s", updateResponse.Code, updateResponse.Body.String())
	}

	reportBody, _ := json.Marshal(UploadReportInput{
		SchemaVersion: "2.0", ReportID: "report-1", GeneratedAt: "2025-01-01T00:00:00Z",
		WorkspaceLabel: "local-workspace", ReportJSON: `{"schemaVersion":"2.0","metadata":{"baseline":"sec-baseline.md","scope":"changed files","generatedAt":"unavailable"},"result":"pass","summary":{"critical":0,"high":0,"medium":0,"low":0,"manualReview":0},"findings":[],"manualReview":[],"coverage":{"checked":["authentication"],"notChecked":[],"tools":["workspace search"]}}`,
		AITokenUsage: AITokenUsage{InputTokens: 1200, OutputTokens: 300, TotalTokens: 1500, Estimated: true},
		SourceSnapshot: SourceSnapshot{
			GitStatus: "M internal/payment.go\nM README.md",
			Diff:      "diff --git a/internal/payment.go b/internal/payment.go\n--- a/internal/payment.go\n+++ b/internal/payment.go\ndiff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md",
			Files: []SourceSnapshotFile{
				{Path: "internal/payment.go", Kind: "changed", Content: "package payment"},
				{Path: "README.md", Kind: "changed", Content: "documentation"},
			},
		},
	})
	reportRequest := httptest.NewRequest(http.MethodPut, "/api/v1/plugin/scans/"+repository.task.ID+"/report", bytes.NewReader(reportBody))
	reportRequest.RemoteAddr = "127.0.0.1:32100"
	reportResponse := httptest.NewRecorder()
	mux.ServeHTTP(reportResponse, reportRequest)
	if reportResponse.Code != http.StatusOK || !repository.task.HasReport || !repository.task.HasSourceCode || repository.task.AITotalTokens != 1500 || !repository.task.AITokenEstimated || len(repository.sourceSnapshot.Files) != 1 {
		t.Fatalf("unexpected report response %d: %s", reportResponse.Code, reportResponse.Body.String())
	}

	detailRequest := httptest.NewRequest(http.MethodGet, "/api/v1/scans/"+repository.task.ID, nil)
	detailResponse := httptest.NewRecorder()
	mux.ServeHTTP(detailResponse, detailRequest)
	var detail TaskDetail
	if detailResponse.Code != http.StatusOK {
		t.Fatalf("expected report detail, got %d: %s", detailResponse.Code, detailResponse.Body.String())
	}
	if err := json.NewDecoder(detailResponse.Body).Decode(&detail); err != nil {
		t.Fatal(err)
	}
	if detail.ReportJSON == "" || detail.ReportMarkdown != "" || detail.AIInputTokens != 1200 || detail.AIOutputTokens != 300 || detail.AITotalTokens != 1500 || len(detail.SourceSnapshot.Files) != 1 || detail.SourceSnapshot.Files[0].Content != "package payment" || len(detail.Logs) < 3 {
		t.Fatalf("unexpected report detail: %#v", detail)
	}
}

func TestListRepositoryBranchesVerifiesCredentials(t *testing.T) {
	verifier := &recordingRepositoryAccessVerifier{branches: []string{"main", "release/1.0"}}
	mux := http.NewServeMux()
	NewHandler(NewService(&memoryRepository{}).WithRepositoryAccessVerifier(verifier), "admin-secret", func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			next.ServeHTTP(response, request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-42"})))
		})
	}).RegisterRoutes(mux)

	request := httptest.NewRequest(http.MethodPost, "/api/v1/repositories/branches", bytes.NewReader([]byte(`{"repositoryUrl":"https://git.example.com/team/repo.git","repositoryToken":"repo-secret"}`)))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK || verifier.repositoryURL != "https://git.example.com/team/repo.git" || verifier.token != "repo-secret" || response.Body.String() != "{\"branches\":[\"main\",\"release/1.0\"]}\n" {
		t.Fatalf("unexpected branch response: status=%d verifier=%#v body=%s", response.Code, verifier, response.Body.String())
	}
}

func TestPluginWriteRequiresUserAPIKey(t *testing.T) {
	mux := http.NewServeMux()
	NewHandler(NewService(&memoryRepository{}), "admin-secret").RegisterRoutes(mux)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/plugin/scans", bytes.NewReader([]byte(`{}`)))
	request.RemoteAddr = "192.0.2.1:32100"
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
}

func TestCreateRejectsEmbeddedCredentials(t *testing.T) {
	service := NewService(&memoryRepository{})
	_, err := service.CreatePlugin(context.Background(), CreateTaskInput{
		ProjectName: "payments", RepositoryURL: "https://user:secret@git.example.com/repo.git", GitRef: "main",
	})
	if err == nil {
		t.Fatal("expected repository credentials to be rejected")
	}
}
