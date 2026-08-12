ALTER TABLE scan_tasks
    DROP COLUMN ai_token_usage_estimated,
    DROP COLUMN ai_total_tokens,
    DROP COLUMN ai_output_tokens,
    DROP COLUMN ai_input_tokens;