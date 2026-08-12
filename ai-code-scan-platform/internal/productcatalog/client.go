package productcatalog

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const pageSize = 500

type Tokens struct {
	RequestToken string
	RefreshToken string
}

type Product struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	GroupName string `json:"groupName"`
	RepoName  string `json:"repoName"`
	Code      string `json:"code"`
	State     int8   `json:"state"`
}

type remoteProduct struct {
	ID               string `json:"id"`
	ProductName      string `json:"productName"`
	ProductShortName string `json:"productShortName"`
	ProductCode      string `json:"productCode"`
	Status           int8   `json:"status"`
	FieldName        string `json:"fieldName"`
	ITProjectName    string `json:"itProjectName"`
}

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func NewClient(baseURL string, httpClient *http.Client) *Client {
	return &Client{baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"), httpClient: httpClient}
}

func (client *Client) List(ctx context.Context, tokens Tokens) ([]Product, error) {
	if client.baseURL == "" {
		return nil, fmt.Errorf("product catalog is not configured")
	}
	if strings.TrimSpace(tokens.RequestToken) == "" || strings.TrimSpace(tokens.RefreshToken) == "" {
		return nil, fmt.Errorf("UAC login tokens are unavailable; sign out and sign in again")
	}
	products := make([]Product, 0)
	for page := 1; ; page++ {
		batch, total, pages, err := client.listPage(ctx, tokens, page)
		if err != nil {
			return nil, err
		}
		products = append(products, batch...)
		if len(batch) == 0 || len(products) >= total || (pages > 0 && page >= pages) {
			return products, nil
		}
		if page >= 100 {
			return nil, fmt.Errorf("product catalog exceeded 100 pages")
		}
	}
}

func (client *Client) listPage(ctx context.Context, tokens Tokens, page int) ([]Product, int, int, error) {
	body, err := json.Marshal(map[string]any{
		"current": page,
		"size":    pageSize,
		"param":   map[string]string{"fieldId": ""},
	})
	if err != nil {
		return nil, 0, 0, fmt.Errorf("encode product catalog request: %w", err)
	}
	endpoint := client.baseURL + "/product-catalog-service/api/product/getProductsApi"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, 0, fmt.Errorf("create product catalog request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("P-Auth", tokens.RequestToken)
	request.Header.Set("P-Rtoken", tokens.RefreshToken)
	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("request product catalog: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil, 0, 0, fmt.Errorf("product catalog returned HTTP %d", response.StatusCode)
	}
	var payload struct {
		Code    any    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Total   int             `json:"total"`
			Pages   int             `json:"pages"`
			Records []remoteProduct `json:"records"`
		} `json:"data"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 20<<20))
	if err := decoder.Decode(&payload); err != nil {
		return nil, 0, 0, fmt.Errorf("decode product catalog response: %w", err)
	}
	if !successfulCode(payload.Code) {
		return nil, 0, 0, fmt.Errorf("product catalog rejected request: %s", payload.Message)
	}
	products := make([]Product, 0, len(payload.Data.Records))
	for _, record := range payload.Data.Records {
		code := strings.TrimSpace(record.ProductShortName)
		if code == "" {
			code = strings.TrimSpace(record.ProductCode)
		}
		state := record.Status
		if state == 0 {
			state = 1
		}
		products = append(products, Product{
			ID: record.ID, Name: record.ProductName, GroupName: record.FieldName,
			RepoName: record.ITProjectName, Code: code, State: state,
		})
	}
	return products, payload.Data.Total, payload.Data.Pages, nil
}

func successfulCode(code any) bool {
	value := strings.TrimSpace(fmt.Sprint(code))
	return value == "0" || value == "200"
}
