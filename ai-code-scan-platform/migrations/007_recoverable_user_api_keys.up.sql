ALTER TABLE user_api_keys
    ADD COLUMN key_encrypted TEXT NULL AFTER key_prefix;