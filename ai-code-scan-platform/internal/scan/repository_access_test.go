package scan

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestGitRepositoryAccessVerifierChecksGitRef(t *testing.T) {
	workingRepository := filepath.Join(t.TempDir(), "working")
	bareRepository := filepath.Join(t.TempDir(), "remote.git")
	runGit(t, "init", "-b", "main", workingRepository)
	runGit(t, "-C", workingRepository, "config", "user.name", "Test User")
	runGit(t, "-C", workingRepository, "config", "user.email", "test@example.com")
	runGit(t, "-C", workingRepository, "commit", "--allow-empty", "-m", "initial")
	runGit(t, "clone", "--bare", workingRepository, bareRepository)

	verifier := NewGitRepositoryAccessVerifier(5 * time.Second)
	if err := verifier.Verify(context.Background(), "file://"+bareRepository, "main", ""); err != nil {
		t.Fatalf("expected main to be accessible: %v", err)
	}
	if err := verifier.Verify(context.Background(), "file://"+bareRepository, "missing", ""); err == nil {
		t.Fatal("expected missing git ref to be rejected")
	}
}

func TestGitRepositoryAccessVerifierListsBranches(t *testing.T) {
	workingRepository := filepath.Join(t.TempDir(), "working")
	bareRepository := filepath.Join(t.TempDir(), "remote.git")
	runGit(t, "init", "-b", "main", workingRepository)
	runGit(t, "-C", workingRepository, "config", "user.name", "Test User")
	runGit(t, "-C", workingRepository, "config", "user.email", "test@example.com")
	runGit(t, "-C", workingRepository, "commit", "--allow-empty", "-m", "initial")
	runGit(t, "-C", workingRepository, "branch", "release/1.0")
	runGit(t, "clone", "--bare", workingRepository, bareRepository)

	verifier := NewGitRepositoryAccessVerifier(5 * time.Second)
	branches, err := verifier.ListBranches(context.Background(), "file://"+bareRepository, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(branches) != 2 || branches[0] != "main" || branches[1] != "release/1.0" {
		t.Fatalf("unexpected branches: %#v", branches)
	}
}

func runGit(t *testing.T, arguments ...string) {
	t.Helper()
	if output, err := exec.Command("git", arguments...).CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", arguments, err, output)
	}
}
