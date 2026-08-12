package credit

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
)

type Repository struct {
	database *sql.DB
}

func NewRepository(database *sql.DB) *Repository {
	return &Repository{database: database}
}

func (repository *Repository) Account(ctx context.Context, userID string) (Account, error) {
	var account Account
	err := repository.database.QueryRowContext(ctx, `
		SELECT user_id, available, frozen, lifetime_used, updated_at FROM credit_accounts WHERE user_id = ?`, userID).
		Scan(&account.UserID, &account.Available, &account.Frozen, &account.LifetimeUsed, &account.UpdatedAt)
	return account, err
}

func (repository *Repository) AdminAccounts(ctx context.Context) ([]AdminAccount, error) {
	rows, err := repository.database.QueryContext(ctx, `
		SELECT credit_accounts.user_id, users.email, users.role, users.active, users.created_at,
			credit_accounts.available, credit_accounts.frozen, credit_accounts.lifetime_used, credit_accounts.updated_at
		FROM credit_accounts
		JOIN users ON users.id = credit_accounts.user_id
		ORDER BY users.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := make([]AdminAccount, 0)
	for rows.Next() {
		var account AdminAccount
		if err := rows.Scan(&account.UserID, &account.Email, &account.Role, &account.Active, &account.CreatedAt,
			&account.Available, &account.Frozen, &account.LifetimeUsed, &account.UpdatedAt); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func (repository *Repository) Transactions(ctx context.Context, userID string, limit int) ([]Transaction, error) {
	rows, err := repository.database.QueryContext(ctx, `
		SELECT id, user_id, scan_task_id, type, amount, balance_after, description, created_at
		FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	transactions := make([]Transaction, 0)
	for rows.Next() {
		var transaction Transaction
		if err := rows.Scan(&transaction.ID, &transaction.UserID, &transaction.ScanTaskID, &transaction.Type, &transaction.Amount, &transaction.BalanceAfter, &transaction.Description, &transaction.CreatedAt); err != nil {
			return nil, err
		}
		transactions = append(transactions, transaction)
	}
	return transactions, rows.Err()
}

func (repository *Repository) Grant(ctx context.Context, userID string, amount uint64, description string) (uint64, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer transaction.Rollback()

	var available uint64
	if err := transaction.QueryRowContext(ctx, `
		SELECT available FROM credit_accounts WHERE user_id = ? FOR UPDATE`, userID).Scan(&available); err != nil {
		return 0, err
	}
	newBalance := available + amount
	if newBalance < available {
		return 0, fmt.Errorf("credit balance overflow")
	}
	if _, err := transaction.ExecContext(ctx, `
		UPDATE credit_accounts SET available = ? WHERE user_id = ?`, newBalance, userID); err != nil {
		return 0, err
	}
	transactionID, err := creditTransactionID()
	if err != nil {
		return 0, err
	}
	if _, err := transaction.ExecContext(ctx, `
		INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, description)
		VALUES (?, ?, 'grant', ?, ?, ?)`, transactionID, userID, int64(amount), newBalance, description); err != nil {
		return 0, err
	}
	if err := transaction.Commit(); err != nil {
		return 0, err
	}
	return newBalance, nil
}

func creditTransactionID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}
