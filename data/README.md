# Personal finance database

`personal-finance.sqlite3` is the portable SQLite database used for imported
statements. Monetary values in `transactions.amount` are signed integers in the
account currency's smallest unit (for example, `1250` means SGD 12.50).

Dates use these formats:

- `statement_imports.statement_date`: `YYYY-MM`
- `transactions.transaction_date`: `YYYY-MM-DD`

The application schema is versioned by `PRAGMA user_version` and its source is
[`src-tauri/migrations/001_initial.sql`](../src-tauri/migrations/001_initial.sql).
