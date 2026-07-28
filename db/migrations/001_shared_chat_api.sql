-- Shared chat API: ownership-safe messages, durable runs, and idempotency.
-- Apply to the same database configured by POLYCODE_DB_URL/DATABASE_URL.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_msg_thread_message
    ON polycode.chat_messages(thread_id, message_id);

CREATE TABLE IF NOT EXISTS polycode.chat_runs (
    run_id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id             UUID          NOT NULL
        REFERENCES polycode.chat_conversations(thread_id) ON DELETE CASCADE,
    user_id               UUID,
    idempotency_key       VARCHAR(200)  NOT NULL,
    request_fingerprint   CHAR(64),
    user_message_id       UUID          NOT NULL,
    assistant_message_id  UUID          NOT NULL,
    status                VARCHAR(20)   NOT NULL DEFAULT 'running',
    error_code            VARCHAR(100),
    error_message         TEXT,
    started_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    finished_at           TIMESTAMPTZ
);

ALTER TABLE polycode.chat_runs
    ADD COLUMN IF NOT EXISTS request_fingerprint CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_run_idempotency
    ON polycode.chat_runs(thread_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_run_active_thread
    ON polycode.chat_runs(thread_id)
    WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_chat_runs_user_started
    ON polycode.chat_runs(user_id, started_at DESC);

COMMIT;
