package secretstore

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestCipherRoundTrip(t *testing.T) {
	cipher, err := New(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := cipher.Encrypt("provider-secret")
	if err != nil {
		t.Fatal(err)
	}
	if ciphertext == "provider-secret" {
		t.Fatal("ciphertext contains plaintext")
	}
	plaintext, err := cipher.Decrypt(ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != "provider-secret" {
		t.Fatalf("unexpected plaintext %q", plaintext)
	}
}

func TestLoadOrCreatePersistsKey(t *testing.T) {
	keyPath := filepath.Join(t.TempDir(), "nested", "model-key")
	first, err := LoadOrCreate(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := first.Encrypt("persistent-secret")
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadOrCreate(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := second.Decrypt(ciphertext)
	if err != nil || plaintext != "persistent-secret" {
		t.Fatalf("persisted key did not decrypt ciphertext: plaintext=%q err=%v", plaintext, err)
	}
	info, err := os.Stat(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("unexpected key permissions %o", info.Mode().Perm())
	}
}
