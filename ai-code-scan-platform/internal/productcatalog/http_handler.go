package productcatalog

import (
	"context"
	"encoding/json"
	"net/http"
)

type Handler struct {
	client      *Client
	requireUser func(http.Handler) http.Handler
	tokens      func(context.Context) (Tokens, bool)
}

func NewHandler(client *Client, requireUser func(http.Handler) http.Handler, tokens func(context.Context) (Tokens, bool)) *Handler {
	return &Handler{client: client, requireUser: requireUser, tokens: tokens}
}

func (handler *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/products", handler.requireUser(http.HandlerFunc(handler.list)))
}

func (handler *Handler) list(response http.ResponseWriter, request *http.Request) {
	tokens, ok := handler.tokens(request.Context())
	if !ok {
		writeJSON(response, http.StatusConflict, map[string]string{"code": "product_catalog_login_required", "message": "sign out and sign in with UAC again before loading the product catalog"})
		return
	}
	products, err := handler.client.List(request.Context(), tokens)
	if err != nil {
		writeJSON(response, http.StatusBadGateway, map[string]string{"code": "product_catalog_unavailable", "message": "failed to load product catalog"})
		return
	}
	writeJSON(response, http.StatusOK, products)
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
