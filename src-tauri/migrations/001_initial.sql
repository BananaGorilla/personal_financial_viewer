PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER PRIMARY KEY,
    institution TEXT NOT NULL CHECK (length(trim(institution)) > 0)
) STRICT;

CREATE TABLE IF NOT EXISTS statement_imports (
    id             INTEGER PRIMARY KEY,
    account_id     INTEGER NOT NULL,
    filename       TEXT NOT NULL CHECK (length(trim(filename)) > 0),
    statement_date TEXT NOT NULL
        CHECK (
            length(statement_date) = 7
            AND statement_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
            AND substr(statement_date, 6, 2) BETWEEN '01' AND '12'
        ),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE (account_id, statement_date, filename),
    UNIQUE (id, account_id)
) STRICT;

CREATE TABLE IF NOT EXISTS transactions (
    id                  INTEGER PRIMARY KEY,
    account_id          INTEGER NOT NULL,
    statement_import_id INTEGER NOT NULL,
    transaction_date    TEXT NOT NULL
        CHECK (
            length(transaction_date) = 10
            AND transaction_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND date(transaction_date) = transaction_date
        ),
    description         TEXT NOT NULL CHECK (length(trim(description)) > 0),
    -- Signed integer in the currency's smallest unit (for example, SGD cents).
    amount              INTEGER NOT NULL,
    category            TEXT NOT NULL DEFAULT 'uncategorized'
        CHECK (length(trim(category)) > 0),
    transaction_hash    TEXT NOT NULL CHECK (length(trim(transaction_hash)) > 0),
    FOREIGN KEY (statement_import_id, account_id)
        REFERENCES statement_imports(id, account_id) ON DELETE CASCADE,
    UNIQUE (account_id, transaction_hash)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_statement_imports_account_date
    ON statement_imports(account_id, statement_date);

CREATE INDEX IF NOT EXISTS idx_transactions_account_date
    ON transactions(account_id, transaction_date);

CREATE INDEX IF NOT EXISTS idx_transactions_category_date
    ON transactions(category, transaction_date);
