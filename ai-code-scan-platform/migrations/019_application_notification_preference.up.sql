ALTER TABLE user_notification_preferences
    ADD COLUMN application_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER user_id;