ALTER TABLE asset_summary ADD COLUMN annual_income_cents INTEGER NOT NULL DEFAULT 0 CHECK (annual_income_cents >= 0);

PRAGMA user_version = 3;
