package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var ErrInvalidCredentials = errors.New("invalid email or password")
var ErrUserNotFound = errors.New("user not found")
var ErrInvalidIdentity = errors.New("invalid API key identity")
var ErrPasswordPolicy = errors.New("password does not meet policy")

type Service struct {
	repository *Repository
	secrets    interface {
		Encrypt(string) (string, error)
		Decrypt(string) (string, error)
	}
	now func() time.Time
}

func NewService(repository *Repository) *Service {
	return &Service{repository: repository, now: time.Now}
}

func NewServiceWithSecrets(repository *Repository, secrets interface {
	Encrypt(string) (string, error)
	Decrypt(string) (string, error)
}) *Service {
	return &Service{repository: repository, secrets: secrets, now: time.Now}
}

func (service *Service) BootstrapAdmin(ctx context.Context, email, password string, credits uint64) error {
	email = normalizeEmail(email)
	if email == "" {
		return nil
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return fmt.Errorf("hash bootstrap administrator password: %w", err)
	}
	userID, err := randomID()
	if err != nil {
		return err
	}
	transactionID, err := randomID()
	if err != nil {
		return err
	}
	return service.repository.BootstrapAdmin(ctx, storedUser{User: User{ID: userID, Email: email, Role: "admin"}, PasswordHash: string(passwordHash)}, credits, transactionID)
}

func (service *Service) Login(ctx context.Context, email, password string) (User, string, time.Time, error) {
	user, err := service.repository.UserByEmail(ctx, normalizeEmail(email))
	if err != nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return User{}, "", time.Time{}, ErrInvalidCredentials
	}
	token, tokenHash, err := newSessionToken()
	if err != nil {
		return User{}, "", time.Time{}, err
	}
	expiresAt := service.now().Add(7 * 24 * time.Hour)
	if err := service.repository.CreateSession(ctx, tokenHash, user.ID, expiresAt); err != nil {
		return User{}, "", time.Time{}, err
	}
	return user.User, token, expiresAt, nil
}

func (service *Service) ChangeAdminPassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	if len(newPassword) < 12 || len(newPassword) > 128 {
		return ErrPasswordPolicy
	}
	user, err := service.repository.UserCredentialsByID(ctx, userID)
	if err != nil || user.Role != "admin" || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(currentPassword)) != nil {
		return ErrInvalidCredentials
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return fmt.Errorf("hash administrator password: %w", err)
	}
	return service.repository.UpdateAdminPasswordHash(ctx, userID, string(passwordHash))
}

func (service *Service) LoginSSO(ctx context.Context, identity SSOIdentity) (User, string, time.Time, error) {
	identity.Provider = strings.ToLower(strings.TrimSpace(identity.Provider))
	identity.Subject = strings.TrimSpace(identity.Subject)
	identity.Email = normalizeEmail(identity.Email)
	if identity.Provider == "" || identity.Subject == "" || identity.Email == "" || !strings.Contains(identity.Email, "@") {
		return User{}, "", time.Time{}, ErrInvalidIdentity
	}
	disabledPassword, _, err := newSessionToken()
	if err != nil {
		return User{}, "", time.Time{}, err
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(disabledPassword), 12)
	if err != nil {
		return User{}, "", time.Time{}, fmt.Errorf("disable SSO password login: %w", err)
	}
	userID, err := randomID()
	if err != nil {
		return User{}, "", time.Time{}, err
	}
	user, err := service.repository.EnsureSSOUser(ctx, userID, string(passwordHash), identity, service.now())
	if err != nil {
		return User{}, "", time.Time{}, err
	}
	token, tokenHash, err := newSessionToken()
	if err != nil {
		return User{}, "", time.Time{}, err
	}
	expiresAt := service.now().Add(7 * 24 * time.Hour)
	if err := service.repository.CreateSession(ctx, tokenHash, user.ID, expiresAt); err != nil {
		return User{}, "", time.Time{}, err
	}
	return user, token, expiresAt, nil
}

func (service *Service) UserForToken(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, sqlUnauthorized()
	}
	hash := sha256.Sum256([]byte(token))
	user, err := service.repository.UserBySession(ctx, hash[:], service.now())
	if err != nil {
		return User{}, sqlUnauthorized()
	}
	return user, nil
}

func (service *Service) UserForAPIKey(ctx context.Context, key string) (User, error) {
	if !strings.HasPrefix(key, "sk_user_") {
		return User{}, sqlUnauthorized()
	}
	hash := sha256.Sum256([]byte(key))
	user, err := service.repository.UserByAPIKey(ctx, hash[:])
	if err != nil {
		return User{}, sqlUnauthorized()
	}
	return user, nil
}

func (service *Service) RotateAPIKey(ctx context.Context, userID string) (string, error) {
	token, _, err := newSessionToken()
	if err != nil {
		return "", err
	}
	key := "sk_user_" + token
	hash := sha256.Sum256([]byte(key))
	encrypted := ""
	if service.secrets != nil {
		encrypted, err = service.secrets.Encrypt(key)
		if err != nil {
			return "", fmt.Errorf("encrypt API key: %w", err)
		}
	}
	if err := service.repository.ReplaceAPIKey(ctx, userID, hash[:], key[:16], encrypted); err != nil {
		return "", err
	}
	return key, nil
}

func (service *Service) ListUserAPIKeyStatuses(ctx context.Context) ([]UserAPIKeyStatus, error) {
	statuses, err := service.repository.ListUserAPIKeyStatuses(ctx)
	if err != nil {
		return nil, err
	}
	if service.secrets == nil {
		return statuses, nil
	}
	for index := range statuses {
		if statuses[index].keyEncrypted == "" {
			continue
		}
		statuses[index].APIKey, err = service.secrets.Decrypt(statuses[index].keyEncrypted)
		if err != nil {
			return nil, fmt.Errorf("decrypt API key for %s: %w", statuses[index].UserID, err)
		}
	}
	return statuses, nil
}

func (service *Service) UserAPIKeyStatus(ctx context.Context, userID string) (UserAPIKeyStatus, error) {
	statuses, err := service.ListUserAPIKeyStatuses(ctx)
	if err != nil {
		return UserAPIKeyStatus{}, err
	}
	for _, status := range statuses {
		if status.UserID == userID {
			return status, nil
		}
	}
	return UserAPIKeyStatus{}, ErrUserNotFound
}

func (service *Service) RotateManagedAPIKey(ctx context.Context, identity APIKeyIdentity) (string, string, error) {
	identity.Email = normalizeEmail(identity.Email)
	if identity.Email == "" || len(identity.ID) > 36 || (identity.Role != "user" && identity.Role != "admin") {
		return "", "", ErrInvalidIdentity
	}
	password, _, err := newSessionToken()
	if err != nil {
		return "", "", err
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", "", fmt.Errorf("disable password login: %w", err)
	}
	userID, err := service.repository.EnsureAPIKeyUser(ctx, storedUser{User: User{ID: identity.ID, Email: identity.Email, Role: identity.Role}, PasswordHash: string(passwordHash)})
	if err != nil {
		return "", "", err
	}
	key, err := service.RotateAPIKey(ctx, userID)
	return userID, key, err
}

func (service *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	hash := sha256.Sum256([]byte(token))
	return service.repository.DeleteSession(ctx, hash[:])
}

func newSessionToken() (string, []byte, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", nil, fmt.Errorf("generate session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(bytes)
	hash := sha256.Sum256([]byte(token))
	return token, hash[:], nil
}

func randomID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate id: %w", err)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func sqlUnauthorized() error {
	return ErrInvalidCredentials
}
