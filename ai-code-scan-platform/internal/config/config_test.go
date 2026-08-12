package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadReadsEnvFile(t *testing.T) {
	t.Setenv("MYSQL_DSN", "")
	t.Setenv("ADMIN_TOKEN", "")
	configFile := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(configFile, []byte("MYSQL_DSN=file-dsn\nADMIN_TOKEN=file-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	configuration, err := load(configFile)
	if err != nil {
		t.Fatal(err)
	}
	if configuration.MySQLDSN != "file-dsn" || configuration.AdminToken != "file-token" {
		t.Fatalf("configuration was not loaded from file: %#v", configuration)
	}
}

func TestLoadReviewDefaults(t *testing.T) {
	t.Setenv("MYSQL_DSN", "test")
	t.Setenv("ADMIN_TOKEN", "test")
	configuration, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if configuration.ReviewMaxBytes != 2*1024*1024 || configuration.ReviewTimeout != 3*time.Minute || configuration.ReviewConcurrency != 4 {
		t.Fatalf("unexpected review defaults: %#v", configuration)
	}
}

func TestLoadRejectsInvalidReviewConcurrency(t *testing.T) {
	t.Setenv("MYSQL_DSN", "test")
	t.Setenv("ADMIN_TOKEN", "test")
	t.Setenv("REVIEW_MAX_CONCURRENT", "0")
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid concurrency to be rejected")
	}
}

func TestLoadBootstrapAdmin(t *testing.T) {
	t.Setenv("MYSQL_DSN", "test")
	t.Setenv("ADMIN_TOKEN", "test")
	t.Setenv("BOOTSTRAP_ADMIN_EMAIL", "admin@example.com")
	t.Setenv("BOOTSTRAP_ADMIN_PASSWORD", "a-long-test-password")
	t.Setenv("BOOTSTRAP_ADMIN_CREDITS", "5000")
	configuration, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if configuration.BootstrapAdminEmail != "admin@example.com" || configuration.BootstrapAdminCredits != 5000 {
		t.Fatalf("unexpected bootstrap configuration: %#v", configuration)
	}
}

func TestLoadRejectsPartialBootstrapAdmin(t *testing.T) {
	t.Setenv("MYSQL_DSN", "test")
	t.Setenv("ADMIN_TOKEN", "test")
	t.Setenv("BOOTSTRAP_ADMIN_EMAIL", "admin@example.com")
	if _, err := Load(); err == nil {
		t.Fatal("expected partial bootstrap configuration to be rejected")
	}
}

func TestLoadAcceptsThreeLevelScanQueues(t *testing.T) {
	t.Setenv("MYSQL_DSN", "test")
	t.Setenv("ADMIN_TOKEN", "test")
	t.Setenv("SCAN_QUEUE_BROKER_URL", "amqp://localhost")
	t.Setenv("SCAN_QUEUE_NAME", "")
	t.Setenv("SCAN_QUEUE_LITE_NAME", "scan.lite")
	t.Setenv("SCAN_QUEUE_STANDARD_NAME", "scan.standard")
	t.Setenv("SCAN_QUEUE_RELEASE_NAME", "scan.release")
	configuration, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if configuration.ScanQueueLiteName != "scan.lite" || configuration.ScanQueueReleaseName != "scan.release" {
		t.Fatalf("unexpected scan queue configuration: %#v", configuration)
	}
}

func TestLoadRejectsPartialLevelScanQueues(t *testing.T) {
	t.Setenv("MYSQL_DSN", "test")
	t.Setenv("ADMIN_TOKEN", "test")
	t.Setenv("SCAN_QUEUE_BROKER_URL", "amqp://localhost")
	t.Setenv("SCAN_QUEUE_NAME", "")
	t.Setenv("SCAN_QUEUE_LITE_NAME", "scan.lite")
	t.Setenv("SCAN_QUEUE_STANDARD_NAME", "")
	t.Setenv("SCAN_QUEUE_RELEASE_NAME", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected partial level queue configuration to be rejected")
	}
}
