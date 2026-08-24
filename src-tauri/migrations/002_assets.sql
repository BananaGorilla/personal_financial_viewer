CREATE TABLE IF NOT EXISTS asset_summary (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    savings_cents     INTEGER NOT NULL DEFAULT 0 CHECK (savings_cents >= 0),
    cpf_cents         INTEGER NOT NULL DEFAULT 0 CHECK (cpf_cents >= 0),
    investments_cents INTEGER NOT NULL DEFAULT 0 CHECK (investments_cents >= 0)
) STRICT;

INSERT OR IGNORE INTO asset_summary (id) VALUES (1);

CREATE TABLE IF NOT EXISTS financial_items (
    id           INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('loan', 'insurance')),
    description  TEXT NOT NULL CHECK (length(trim(description)) > 0),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_financial_items_kind ON financial_items(kind, id);
