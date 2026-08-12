package codeindex

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRelatedResolvesGoCallAcrossFiles(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "handler.go", "package sample\nfunc Handle(value string) { SaveUser(value) }\n")
	writeFile(t, root, "store.go", "package sample\nfunc SaveUser(value string) { database.Exec(value) }\n")

	index, err := Build(root, []string{"handler.go", "store.go"})
	if err != nil {
		t.Fatal(err)
	}
	related := index.Related("2|func Handle(value string) { SaveUser(value) }", map[string]struct{}{"handler.go": {}}, Options{MaxDepth: 3, MaxFunctions: 5, MaxBytes: 4096})
	if len(related) != 1 || related[0].Path != "store.go" || related[0].Name != "SaveUser" {
		t.Fatalf("unexpected related Go functions: %#v", related)
	}
}

func TestRelatedResolvesPythonCallAcrossFiles(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "handler.py", "def handle(value):\n    return save_user(value)\n")
	writeFile(t, root, "store.py", "def save_user(value):\n    return database.execute(value)\n")

	index, err := Build(root, []string{"handler.py", "store.py"})
	if err != nil {
		t.Fatal(err)
	}
	related := index.Related("1|def handle(value):\n2|    return save_user(value)\n", map[string]struct{}{"handler.py": {}}, Options{MaxDepth: 3, MaxFunctions: 5, MaxBytes: 4096})
	if len(related) != 1 || related[0].Path != "store.py" || related[0].StartLine != 1 || related[0].EndLine != 2 {
		t.Fatalf("unexpected related Python functions: %#v", related)
	}
}

func TestRelatedResolvesJavaScriptArrowAcrossFiles(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "handler.js", "export function handle(value) {\n  return saveUser(value);\n}\n")
	writeFile(t, root, "store.js", "export const saveUser = async (value) => {\n  return database.execute(value);\n};\n")

	index, err := Build(root, []string{"handler.js", "store.js"})
	if err != nil {
		t.Fatal(err)
	}
	related := index.Related("1|export function handle(value) {\n2|  return saveUser(value);\n3|}\n", map[string]struct{}{"handler.js": {}}, Options{MaxDepth: 3, MaxFunctions: 5, MaxBytes: 4096})
	if len(related) != 1 || related[0].Path != "store.js" || related[0].Name != "saveUser" || related[0].EndLine != 3 {
		t.Fatalf("unexpected related JavaScript functions: %#v", related)
	}
}

func TestRelatedResolvesTypeScriptMethodAcrossFiles(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "controller.ts", "export const run = (service: UserService) => service.loadUser();\n")
	writeFile(t, root, "service.ts", "export class UserService {\n  async loadUser(): Promise<User> {\n    return repository.findUser();\n  }\n}\n")

	index, err := Build(root, []string{"controller.ts", "service.ts"})
	if err != nil {
		t.Fatal(err)
	}
	related := index.Related("1|export const run = (service: UserService) => service.loadUser();\n", map[string]struct{}{"controller.ts": {}}, Options{MaxDepth: 3, MaxFunctions: 5, MaxBytes: 4096})
	if len(related) != 1 || related[0].Path != "service.ts" || related[0].Name != "loadUser" || related[0].StartLine != 2 || related[0].EndLine != 4 {
		t.Fatalf("unexpected related TypeScript functions: %#v", related)
	}
}

func writeFile(t *testing.T, root, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
