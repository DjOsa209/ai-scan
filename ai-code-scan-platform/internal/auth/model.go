package auth

import "time"

const SessionCookieName = "platform_session"

type User struct {
	ID           string     `json:"id"`
	Email        string     `json:"email"`
	Role         string     `json:"role"`
	Name         string     `json:"name,omitempty"`
	EmployeeNo   string     `json:"employeeNo,omitempty"`
	Department   string     `json:"department,omitempty"`
	AuthProvider string     `json:"authProvider"`
	CreatedAt    time.Time  `json:"createdAt"`
	LastLoginAt  *time.Time `json:"lastLoginAt,omitempty"`
}

type UserAPIKeyStatus struct {
	UserID       string     `json:"userId"`
	Email        string     `json:"email"`
	Role         string     `json:"role"`
	Active       bool       `json:"active"`
	CreatedAt    time.Time  `json:"createdAt"`
	Configured   bool       `json:"configured"`
	KeyPrefix    string     `json:"keyPrefix,omitempty"`
	APIKey       string     `json:"apiKey,omitempty"`
	UpdatedAt    *time.Time `json:"updatedAt,omitempty"`
	Name         string     `json:"name,omitempty"`
	EmployeeNo   string     `json:"employeeNo,omitempty"`
	Department   string     `json:"department,omitempty"`
	AuthProvider string     `json:"authProvider"`
	LastLoginAt  *time.Time `json:"lastLoginAt,omitempty"`
	keyEncrypted string
}

type SSOIdentity struct {
	Provider     string
	Subject      string
	Email        string
	Name         string
	EmployeeNo   string
	Department   string
	RequestToken string
	RefreshToken string
}

type UACTokens struct {
	RequestToken string
	RefreshToken string
}

type APIKeyIdentity struct {
	ID    string `json:"-"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

type storedUser struct {
	User
	PasswordHash string
}
