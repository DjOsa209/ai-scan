package platformstate

import (
	"bytes"
	"context"
	"database/sql/driver"
	"testing"

	"ai-code-scan-platform/internal/secretstore"
	"github.com/DATA-DOG/go-sqlmock"
)

type stateWithoutModel struct {
	modelID string
}

func (matcher stateWithoutModel) Match(value driver.Value) bool {
	payload, ok := value.([]byte)
	return ok && bytes.Contains(payload, []byte(`"aiModels":[]`)) && !bytes.Contains(payload, []byte(matcher.modelID))
}

func TestSaveRemovesDeletedModelFromStoredState(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	cipher, err := secretstore.New(bytes.Repeat([]byte{9}, 32))
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(database, cipher)

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT revision, payload FROM platform_state").
		WithArgs("default").
		WillReturnRows(sqlmock.NewRows([]string{"revision", "payload"}).AddRow(3, `{"aiModels":[{"id":"model-to-delete","apiKeyEncrypted":"ciphertext"}]}`))
	mock.ExpectExec("UPDATE platform_state SET revision = \\?, payload = \\? WHERE workspace_id = \\?").
		WithArgs(uint64(4), stateWithoutModel{modelID: "model-to-delete"}, "default").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	snapshot, err := service.Save(context.Background(), "default", 3, []byte(`{"aiModels":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Revision != 4 || bytes.Contains(snapshot.State, []byte("model-to-delete")) {
		t.Fatalf("deleted model remained in saved state: %#v", snapshot)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}