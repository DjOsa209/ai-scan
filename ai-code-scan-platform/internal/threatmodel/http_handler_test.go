package threatmodel

import "testing"

func TestPublicModelDoesNotReturnUploadedDocumentContents(t *testing.T) {
	model := Model{
		Configuration: Configuration{ScopeDocuments: []Document{{Name: "architecture.md", Content: "internal design secret"}}},
		LatestRun:     &Run{Configuration: Configuration{ScopeDocuments: []Document{{Name: "architecture.md", Content: "fixed run secret"}}}},
	}

	public := publicModel(model)
	if public.Configuration.ScopeDocuments[0].Content != "" || public.LatestRun.Configuration.ScopeDocuments[0].Content != "" {
		t.Fatalf("public API model leaked document contents: %#v", public)
	}
	if public.Configuration.ScopeDocuments[0].Name != "architecture.md" {
		t.Fatalf("public API must retain document identity: %#v", public.Configuration.ScopeDocuments)
	}
	if model.Configuration.ScopeDocuments[0].Content == "" || model.LatestRun.Configuration.ScopeDocuments[0].Content == "" {
		t.Fatal("public response sanitization must not mutate the service model")
	}
}
