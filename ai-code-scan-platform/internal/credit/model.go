package credit

import "time"

type Account struct {
	UserID       string    `json:"userId"`
	Available    uint64    `json:"available"`
	Frozen       uint64    `json:"frozen"`
	LifetimeUsed uint64    `json:"lifetimeUsed"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type AdminAccount struct {
	Account
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
}

type Transaction struct {
	ID           string    `json:"id"`
	UserID       string    `json:"userId"`
	ScanTaskID   *string   `json:"scanTaskId,omitempty"`
	Type         string    `json:"type"`
	Amount       int64     `json:"amount"`
	BalanceAfter uint64    `json:"balanceAfter"`
	Description  string    `json:"description"`
	CreatedAt    time.Time `json:"createdAt"`
}
