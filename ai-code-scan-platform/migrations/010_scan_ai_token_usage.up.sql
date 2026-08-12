ALTER TABLE scan_tasks
    ADD COLUMN ai_input_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER charged_credits,
    ADD COLUMN ai_output_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER ai_input_tokens,
    ADD COLUMN ai_total_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER ai_output_tokens,
    ADD COLUMN ai_token_usage_estimated BOOLEAN NOT NULL DEFAULT FALSE AFTER ai_total_tokens;