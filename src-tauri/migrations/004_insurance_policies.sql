CREATE TABLE IF NOT EXISTS insurance_policies (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0)
) STRICT;

-- Preserve policies entered in versions where they lived with asset items.
INSERT OR IGNORE INTO insurance_policies (id, name)
SELECT id, description FROM financial_items WHERE kind = 'insurance';

PRAGMA user_version = 4;
