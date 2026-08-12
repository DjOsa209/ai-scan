package skill

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type HTTPFetcher struct {
	client   *http.Client
	maxBytes int64
}

func NewHTTPFetcher(timeout time.Duration, maxBytes int64) *HTTPFetcher {
	fetcher := &HTTPFetcher{maxBytes: maxBytes}
	transport := &http.Transport{
		DialContext:       fetcher.dialContext,
		ForceAttemptHTTP2: true,
	}
	fetcher.client = &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("remote Skill exceeded the redirect limit")
			}
			return validateRemoteURL(request.URL)
		},
	}
	return fetcher
}

func (fetcher *HTTPFetcher) Fetch(ctx context.Context, rawURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", fmt.Errorf("parse remote Skill URL: %w", err)
	}
	if err := validateRemoteURL(parsed); err != nil {
		return "", err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "text/markdown,text/plain;q=0.9")
	request.Header.Set("User-Agent", "ai-code-scan-platform/1.0")

	response, err := fetcher.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("fetch remote Skill: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fetch remote Skill: HTTP %d", response.StatusCode)
	}

	content, err := io.ReadAll(io.LimitReader(response.Body, fetcher.maxBytes+1))
	if err != nil {
		return "", fmt.Errorf("read remote Skill: %w", err)
	}
	if int64(len(content)) > fetcher.maxBytes {
		return "", fmt.Errorf("remote Skill exceeds %d bytes", fetcher.maxBytes)
	}
	if strings.TrimSpace(string(content)) == "" {
		return "", fmt.Errorf("remote Skill is empty")
	}
	return string(content), nil
}

func validateRemoteURL(remoteURL *url.URL) error {
	if remoteURL.Scheme != "https" {
		return fmt.Errorf("remote Skill URL must use HTTPS")
	}
	if remoteURL.User != nil {
		return fmt.Errorf("remote Skill URL must not contain credentials")
	}
	if remoteURL.Hostname() == "" {
		return fmt.Errorf("remote Skill URL must include a hostname")
	}
	return nil
}

func (fetcher *HTTPFetcher) dialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	for _, address := range addresses {
		if isBlockedIP(address.IP) {
			return nil, fmt.Errorf("remote Skill host resolves to a blocked address")
		}
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("remote Skill hostname did not resolve")
	}
	return (&net.Dialer{}).DialContext(ctx, network, net.JoinHostPort(addresses[0].IP.String(), port))
}

func isBlockedIP(address net.IP) bool {
	return address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() ||
		address.IsLinkLocalMulticast() || address.IsUnspecified() || address.IsMulticast()
}
