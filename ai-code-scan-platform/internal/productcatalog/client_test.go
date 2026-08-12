package productcatalog

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestClientListsAllNativeProductCatalogPagesWithUACTokens(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		if request.Method != http.MethodPost || request.URL.Path != "/product-catalog-service/api/product/getProductsApi" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.String())
		}
		if request.Header.Get("P-Auth") != "request-token" || request.Header.Get("P-Rtoken") != "refresh-token" {
			t.Fatalf("unexpected UAC headers: P-Auth=%q P-Rtoken=%q", request.Header.Get("P-Auth"), request.Header.Get("P-Rtoken"))
		}
		var input struct {
			Current int `json:"current"`
			Size    int `json:"size"`
			Param   struct {
				FieldID string `json:"fieldId"`
			} `json:"param"`
		}
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if input.Size != 500 || input.Param.FieldID != "" {
			t.Fatalf("unexpected request body: %#v", input)
		}
		records := []map[string]any{{"id": "remote-1", "productName": "Product A", "productShortName": "A", "status": 1, "fieldName": "Group A", "itProjectName": "repo-a"}}
		if input.Current == 2 {
			records = []map[string]any{{"id": "remote-2", "productName": "Product B", "productCode": "B", "status": 1}}
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"code": 0, "data": map[string]any{"current": input.Current, "size": 500, "total": 2, "pages": 2, "records": records}})
	}))
	defer server.Close()

	client := NewClient(server.URL, &http.Client{Timeout: time.Second})
	products, err := client.List(context.Background(), Tokens{RequestToken: "request-token", RefreshToken: "refresh-token"})
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 || len(products) != 2 || products[0].ID != "remote-1" || products[0].Name != "Product A" || products[1].Code != "B" {
		t.Fatalf("unexpected products: requests=%d products=%#v", requests, products)
	}
}

func TestClientRejectsMissingUACTokens(t *testing.T) {
	client := NewClient("https://catalog.example", &http.Client{Timeout: time.Second})
	_, err := client.List(context.Background(), Tokens{})
	if err == nil || !bytes.Contains([]byte(err.Error()), []byte("UAC login")) {
		t.Fatalf("expected missing UAC token error, got %v", err)
	}
}
