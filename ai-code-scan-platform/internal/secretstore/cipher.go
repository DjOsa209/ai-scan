package secretstore

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const ciphertextPrefix = "v1:"

type Cipher struct {
	aead cipher.AEAD
}

func New(key []byte) (*Cipher, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("model key encryption key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{aead: aead}, nil
}

func LoadOrCreate(keyPath string) (*Cipher, error) {
	key, err := os.ReadFile(keyPath)
	if err == nil {
		return New(key)
	}
	if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read model key encryption key: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(keyPath), 0o700); err != nil {
		return nil, fmt.Errorf("create model key directory: %w", err)
	}
	key = make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate model key encryption key: %w", err)
	}
	file, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create model key encryption key: %w", err)
	}
	if _, err := file.Write(key); err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("write model key encryption key: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("close model key encryption key: %w", err)
	}
	return New(key)
}

func (cipher *Cipher) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, cipher.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate model key nonce: %w", err)
	}
	sealed := cipher.aead.Seal(nonce, nonce, []byte(plaintext), nil)
	return ciphertextPrefix + base64.RawStdEncoding.EncodeToString(sealed), nil
}

func (cipher *Cipher) Decrypt(ciphertext string) (string, error) {
	encoded, ok := strings.CutPrefix(ciphertext, ciphertextPrefix)
	if !ok {
		return "", fmt.Errorf("unsupported model key ciphertext version")
	}
	sealed, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("decode model key ciphertext: %w", err)
	}
	if len(sealed) < cipher.aead.NonceSize() {
		return "", fmt.Errorf("model key ciphertext is too short")
	}
	nonce, payload := sealed[:cipher.aead.NonceSize()], sealed[cipher.aead.NonceSize():]
	plaintext, err := cipher.aead.Open(nil, nonce, payload, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt model key: %w", err)
	}
	return string(plaintext), nil
}
