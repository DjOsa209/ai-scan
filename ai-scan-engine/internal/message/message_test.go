package message

import "testing"

func TestDecodeValidatesEnvelope(t *testing.T) {
	payload := []byte(`{"schemaVersion":"1.0","eventId":"event-1","eventType":"scan.requested","task":{"id":"task-1","repositoryUrl":"https://example.com/repo.git","gitRef":"main","callbacks":{"statusUrl":"/status","reportUrl":"/report"}}}`)
	envelope, err := Decode(payload)
	if err != nil {
		t.Fatal(err)
	}
	if envelope.Task.ID != "task-1" {
		t.Fatalf("unexpected task: %#v", envelope.Task)
	}
}

func TestDecodeAcceptsArchiveTaskWithoutRepositoryURL(t *testing.T) {
	payload := []byte(`{"schemaVersion":"1.0","eventId":"event-2","eventType":"scan.requested","task":{"id":"task-2","gitRef":"uploaded","callbacks":{"statusUrl":"/status","reportUrl":"/report","archiveUrl":"/archive"}}}`)
	envelope, err := Decode(payload)
	if err != nil {
		t.Fatal(err)
	}
	if envelope.Task.Callbacks.ArchiveURL != "/archive" {
		t.Fatalf("unexpected archive URL: %q", envelope.Task.Callbacks.ArchiveURL)
	}
}

func TestDecodeRejectsUnsupportedEvent(t *testing.T) {
	if _, err := Decode([]byte(`{"schemaVersion":"1.0","eventId":"event-1","eventType":"other","task":{}}`)); err == nil {
		t.Fatal("expected validation error")
	}
}
