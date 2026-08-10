-- Attribute prediction/backtest runs to their effective user without changing
-- existing run or trade records.
ALTER TABLE polycode.runs
    ADD COLUMN IF NOT EXISTS principal_id TEXT;

ALTER TABLE polycode.runs
    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'native';

CREATE INDEX IF NOT EXISTS idx_runs_source_principal_started
    ON polycode.runs(source, principal_id, started_at DESC);
