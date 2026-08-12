package scan

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"
)

type GitRepositoryAccessVerifier struct {
	timeout time.Duration
}

func NewGitRepositoryAccessVerifier(timeout time.Duration) *GitRepositoryAccessVerifier {
	return &GitRepositoryAccessVerifier{timeout: timeout}
}

func (verifier *GitRepositoryAccessVerifier) Verify(ctx context.Context, repositoryURL, gitRef, token string) error {
	ctx, cancel := verifier.withTimeout(ctx)
	defer cancel()

	command, err := repositoryGitCommand(ctx, repositoryURL, token, "ls-remote", "--exit-code", repositoryURL, gitRef, "refs/heads/"+gitRef, "refs/tags/"+gitRef)
	if err != nil {
		return err
	}
	if err := command.Run(); err != nil {
		return fmt.Errorf("repository or git ref is not accessible with the provided credentials")
	}
	return nil
}

func (verifier *GitRepositoryAccessVerifier) ListBranches(ctx context.Context, repositoryURL, token string) ([]string, error) {
	ctx, cancel := verifier.withTimeout(ctx)
	defer cancel()

	command, err := repositoryGitCommand(ctx, repositoryURL, token, "ls-remote", "--heads", repositoryURL)
	if err != nil {
		return nil, err
	}
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("repository is not accessible with the provided credentials")
	}
	branches := make([]string, 0)
	for line := range strings.Lines(string(output)) {
		_, reference, found := strings.Cut(strings.TrimSpace(line), "\t")
		if found && strings.HasPrefix(reference, "refs/heads/") {
			branches = append(branches, strings.TrimPrefix(reference, "refs/heads/"))
		}
	}
	sort.Strings(branches)
	return branches, nil
}

func (verifier *GitRepositoryAccessVerifier) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if verifier.timeout > 0 {
		return context.WithTimeout(ctx, verifier.timeout)
	}
	return ctx, func() {}
}

func repositoryGitCommand(ctx context.Context, repositoryURL, token string, arguments ...string) (*exec.Cmd, error) {
	parsed, err := url.Parse(repositoryURL)
	if err != nil {
		return nil, fmt.Errorf("invalid repository URL")
	}
	command := exec.CommandContext(ctx, "git", arguments...)
	command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if token != "" {
		configKey := "http." + parsed.Scheme + "://" + parsed.Host + "/.extraHeader"
		command.Env = append(command.Env,
			"GIT_CONFIG_COUNT=1",
			"GIT_CONFIG_KEY_0="+configKey,
			"GIT_CONFIG_VALUE_0=Authorization: Basic "+basicRepositoryToken(token),
		)
	}
	return command, nil
}
