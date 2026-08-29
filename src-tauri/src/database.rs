use std::path::Path;

use std::collections::BTreeMap;

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const INITIAL_SCHEMA: &str = include_str!("../migrations/001_initial.sql");
const ASSETS_SCHEMA: &str = include_str!("../migrations/002_assets.sql");
const ANNUAL_INCOME_SCHEMA: &str = include_str!("../migrations/003_annual_income.sql");
const INSURANCE_POLICIES_SCHEMA: &str = include_str!("../migrations/004_insurance_policies.sql");

/// Opens (or creates) a portable SQLite database and applies its schema.
///
/// Foreign-key enforcement is connection-specific in SQLite, so it is enabled
/// every time the application opens the database.
pub fn open(path: impl AsRef<Path>) -> Result<Connection> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.execute_batch(INITIAL_SCHEMA)?;
    connection.execute_batch(ASSETS_SCHEMA)?;
    let schema_version: i32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if schema_version < 3 {
        connection.execute_batch(ANNUAL_INCOME_SCHEMA)?;
    }
    let schema_version: i32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if schema_version < 4 {
        connection.execute_batch(INSURANCE_POLICIES_SCHEMA)?;
    }
    Ok(connection)
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialItem {
    pub id: i64,
    pub description: String,
    pub amount_cents: i64,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetsData {
    pub savings_cents: i64,
    pub cpf_cents: i64,
    pub investments_cents: i64,
    pub annual_income_cents: i64,
    pub loans: Vec<FinancialItem>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsurancePolicy {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyAmount {
    pub month: String,
    pub spending_cents: i64,
    pub income_cents: i64,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryMonthAmount {
    pub month: String,
    pub amount_cents: i64,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySeries {
    pub category: String,
    pub values: Vec<CategoryMonthAmount>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardData {
    pub current_assets_cents: i64,
    pub total_spending_cents: i64,
    pub total_income_cents: i64,
    pub monthly: Vec<MonthlyAmount>,
    pub categories: Vec<CategorySeries>,
}

#[derive(Debug, Deserialize)]
pub struct StatementToSave {
    pub institution: Option<String>,
    #[serde(alias = "statement_date")]
    pub statement_month: Option<String>,
    pub transactions: Vec<TransactionToSave>,
}

#[derive(Debug, Deserialize)]
pub struct TransactionToSave {
    pub date: Option<String>,
    pub description: String,
    pub amount_cents: i64,
    pub category: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStatementResult {
    pub statement_import_id: i64,
    pub transaction_count: usize,
}

pub fn assets_data(connection: &Connection) -> Result<AssetsData> {
    let (savings_cents, cpf_cents, investments_cents, annual_income_cents) = connection.query_row(
        "SELECT savings_cents, cpf_cents, investments_cents, annual_income_cents FROM asset_summary WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;

    let items = |kind: &str| -> Result<Vec<FinancialItem>> {
        let mut statement = connection.prepare(
            "SELECT id, description, amount_cents FROM financial_items WHERE kind = ?1 ORDER BY id",
        )?;
        let rows = statement
            .query_map([kind], |row| {
                Ok(FinancialItem {
                    id: row.get(0)?,
                    description: row.get(1)?,
                    amount_cents: row.get(2)?,
                })
            })?
            .collect();
        rows
    };

    Ok(AssetsData {
        savings_cents,
        cpf_cents,
        investments_cents,
        annual_income_cents,
        loans: items("loan")?,
    })
}

pub fn insurance_policies(connection: &Connection) -> Result<Vec<InsurancePolicy>> {
    let mut statement =
        connection.prepare("SELECT id, name FROM insurance_policies ORDER BY id")?;
    let policies = statement
        .query_map([], |row| {
            Ok(InsurancePolicy {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .collect();
    policies
}

pub fn add_insurance_policy(
    connection: &Connection,
    name: &str,
) -> std::result::Result<i64, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Policy name is required".into());
    }
    connection
        .execute("INSERT INTO insurance_policies (name) VALUES (?1)", [name])
        .map_err(|error| format!("Could not add insurance policy: {error}"))?;
    Ok(connection.last_insert_rowid())
}

pub fn update_insurance_policy(
    connection: &Connection,
    id: i64,
    name: &str,
) -> std::result::Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Policy name is required".into());
    }
    let changed = connection
        .execute(
            "UPDATE insurance_policies SET name = ?1 WHERE id = ?2",
            params![name, id],
        )
        .map_err(|error| format!("Could not update insurance policy: {error}"))?;
    if changed == 0 {
        return Err("Insurance policy was not found".into());
    }
    Ok(())
}

pub fn delete_insurance_policy(
    connection: &Connection,
    id: i64,
) -> std::result::Result<(), String> {
    connection
        .execute("DELETE FROM insurance_policies WHERE id = ?1", [id])
        .map(|_| ())
        .map_err(|error| format!("Could not delete insurance policy: {error}"))
}

pub fn save_asset_summary(
    connection: &Connection,
    savings_cents: i64,
    cpf_cents: i64,
    investments_cents: i64,
    annual_income_cents: i64,
) -> std::result::Result<(), String> {
    if [
        savings_cents,
        cpf_cents,
        investments_cents,
        annual_income_cents,
    ]
    .iter()
    .any(|amount| *amount < 0)
    {
        return Err("Asset amounts cannot be negative".into());
    }
    connection
        .execute(
            "UPDATE asset_summary SET savings_cents = ?1, cpf_cents = ?2, investments_cents = ?3, annual_income_cents = ?4 WHERE id = 1",
            params![savings_cents, cpf_cents, investments_cents, annual_income_cents],
        )
        .map(|_| ())
        .map_err(|error| format!("Could not save asset amounts: {error}"))
}

fn validate_item(
    kind: &str,
    description: &str,
    amount_cents: i64,
) -> std::result::Result<(), String> {
    if kind != "loan" && kind != "insurance" {
        return Err("Financial item type must be loan or insurance".into());
    }
    if description.trim().is_empty() {
        return Err("Description is required".into());
    }
    if amount_cents < 0 {
        return Err("Amount cannot be negative".into());
    }
    Ok(())
}

pub fn add_financial_item(
    connection: &Connection,
    kind: &str,
    description: &str,
    amount_cents: i64,
) -> std::result::Result<i64, String> {
    validate_item(kind, description, amount_cents)?;
    connection
        .execute(
            "INSERT INTO financial_items (kind, description, amount_cents) VALUES (?1, ?2, ?3)",
            params![kind, description.trim(), amount_cents],
        )
        .map_err(|error| format!("Could not add financial item: {error}"))?;
    Ok(connection.last_insert_rowid())
}

pub fn update_financial_item(
    connection: &Connection,
    id: i64,
    kind: &str,
    description: &str,
    amount_cents: i64,
) -> std::result::Result<(), String> {
    validate_item(kind, description, amount_cents)?;
    let changed = connection
        .execute(
            "UPDATE financial_items SET description = ?1, amount_cents = ?2 WHERE id = ?3 AND kind = ?4",
            params![description.trim(), amount_cents, id, kind],
        )
        .map_err(|error| format!("Could not update financial item: {error}"))?;
    if changed == 0 {
        return Err("Financial item was not found".into());
    }
    Ok(())
}

pub fn delete_financial_item(
    connection: &Connection,
    id: i64,
    kind: &str,
) -> std::result::Result<(), String> {
    if kind != "loan" && kind != "insurance" {
        return Err("Financial item type must be loan or insurance".into());
    }
    connection
        .execute(
            "DELETE FROM financial_items WHERE id = ?1 AND kind = ?2",
            params![id, kind],
        )
        .map(|_| ())
        .map_err(|error| format!("Could not delete financial item: {error}"))
}

/// Removes every piece of user-entered finance data while retaining the
/// initialized schema and default asset-summary row required by the UI.
pub fn clear_all_data(connection: &mut Connection) -> std::result::Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not start database reset: {error}"))?;

    // Deleting accounts cascades to statement imports and their transactions.
    transaction
        .execute_batch(
            "DELETE FROM accounts;
             DELETE FROM financial_items;
             DELETE FROM insurance_policies;
             UPDATE asset_summary
             SET savings_cents = 0,
                 cpf_cents = 0,
                 investments_cents = 0,
                 annual_income_cents = 0
             WHERE id = 1;",
        )
        .map_err(|error| format!("Could not clear finance data: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("Could not finish database reset: {error}"))
}

pub fn save_statement(
    connection: &mut Connection,
    filename: &str,
    statement: StatementToSave,
) -> std::result::Result<SaveStatementResult, String> {
    let institution = required_text(statement.institution.as_deref(), "institution")?;
    let filename = required_text(Some(filename), "filename")?;
    let raw_statement_month =
        required_text(statement.statement_month.as_deref(), "statement month")?;
    let statement_month = raw_statement_month
        .get(..7)
        .filter(|value| is_valid_month(value))
        .ok_or_else(|| "Statement month must use YYYY-MM format".to_string())?;

    let mut occurrence_by_signature = BTreeMap::<String, usize>::new();
    let mut transactions = Vec::with_capacity(statement.transactions.len());
    for transaction in statement.transactions {
        let date = required_text(transaction.date.as_deref(), "transaction date")?;
        if !is_valid_date(date) {
            return Err(format!(
                "Transaction date must use YYYY-MM-DD format: {date}"
            ));
        }
        let description = required_text(Some(&transaction.description), "transaction description")?;
        let category = transaction
            .category
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("uncategorized");
        let signature = format!(
            "{}|{}|{}",
            date,
            description
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase(),
            transaction.amount_cents
        );
        let occurrence = occurrence_by_signature
            .entry(signature.clone())
            .or_default();
        let hash = format!(
            "{:x}",
            Sha256::digest(format!("{signature}|{occurrence}").as_bytes())
        );
        *occurrence += 1;
        transactions.push((
            date.to_owned(),
            description.to_owned(),
            transaction.amount_cents,
            category.to_owned(),
            hash,
        ));
    }

    let database_transaction = connection
        .transaction()
        .map_err(|error| format!("Could not start database transaction: {error}"))?;
    let account_id = database_transaction
        .query_row(
            "SELECT id FROM accounts WHERE institution = ?1 ORDER BY id LIMIT 1",
            [&institution],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not find the account: {error}"))?
        .map(Ok)
        .unwrap_or_else(|| {
            database_transaction
                .execute(
                    "INSERT INTO accounts (institution) VALUES (?1)",
                    [&institution],
                )
                .map(|_| database_transaction.last_insert_rowid())
        })
        .map_err(|error| format!("Could not save the account: {error}"))?;

    let statement_import_id: i64 = database_transaction
        .query_row(
            "INSERT INTO statement_imports (account_id, filename, statement_date)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(account_id, statement_date, filename)
             DO UPDATE SET filename = excluded.filename
             RETURNING id",
            params![account_id, filename, statement_month],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not save the statement import: {error}"))?;

    database_transaction
        .execute(
            "DELETE FROM transactions WHERE statement_import_id = ?1",
            [statement_import_id],
        )
        .map_err(|error| format!("Could not replace the statement transactions: {error}"))?;

    {
        let mut insert = database_transaction
            .prepare(
                "INSERT INTO transactions
                    (account_id, statement_import_id, transaction_date, description, amount, category, transaction_hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(account_id, transaction_hash) DO UPDATE SET
                    statement_import_id = excluded.statement_import_id,
                    transaction_date = excluded.transaction_date,
                    description = excluded.description,
                    amount = excluded.amount,
                    category = excluded.category",
            )
            .map_err(|error| format!("Could not prepare transaction storage: {error}"))?;
        for (date, description, amount, category, hash) in &transactions {
            insert
                .execute(params![
                    account_id,
                    statement_import_id,
                    date,
                    description,
                    amount,
                    category,
                    hash
                ])
                .map_err(|error| format!("Could not save a transaction: {error}"))?;
        }
    }

    database_transaction
        .commit()
        .map_err(|error| format!("Could not finish saving the statement: {error}"))?;
    Ok(SaveStatementResult {
        statement_import_id,
        transaction_count: transactions.len(),
    })
}

fn required_text<'a>(value: Option<&'a str>, field: &str) -> std::result::Result<&'a str, String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("The extracted statement has no {field}"))
}

fn is_valid_month(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 7
        && bytes[4] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..].iter().all(u8::is_ascii_digit)
        && value[5..]
            .parse::<u8>()
            .is_ok_and(|month| (1..=12).contains(&month))
}

fn is_valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(index, character)| index == 4 || index == 7 || character.is_ascii_digit())
    {
        return false;
    }

    let year = value[..4].parse::<u16>().unwrap_or_default();
    let month = value[5..7].parse::<u8>().unwrap_or_default();
    let day = value[8..].parse::<u8>().unwrap_or_default();
    let leap_year = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap_year => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days_in_month).contains(&day)
}

/// Returns dashboard-ready aggregates directly from SQLite.
///
/// Positive amounts are spending. Negative amounts are treated as income and
/// returned as a positive magnitude for display.
pub fn dashboard_data(connection: &Connection) -> Result<DashboardData> {
    let current_assets_cents = connection.query_row(
        "SELECT savings_cents + cpf_cents + investments_cents FROM asset_summary WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    let (total_spending_cents, total_income_cents) = connection.query_row(
        "SELECT
             COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0)
         FROM transactions",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let mut monthly_statement = connection.prepare(
        "SELECT
             substr(transaction_date, 1, 7) AS month,
             SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS spending,
             SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS income
         FROM transactions
         GROUP BY month
         ORDER BY month",
    )?;
    let monthly = monthly_statement
        .query_map([], |row| {
            Ok(MonthlyAmount {
                month: row.get(0)?,
                spending_cents: row.get(1)?,
                income_cents: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    let mut category_statement = connection.prepare(
        "SELECT
             category,
             substr(transaction_date, 1, 7) AS month,
             SUM(amount) AS amount
         FROM transactions
         WHERE amount > 0
         GROUP BY category, month
         ORDER BY category, month",
    )?;
    let rows = category_statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            CategoryMonthAmount {
                month: row.get(1)?,
                amount_cents: row.get(2)?,
            },
        ))
    })?;
    let mut categories_by_name: BTreeMap<String, Vec<CategoryMonthAmount>> = BTreeMap::new();
    for row in rows {
        let (category, value) = row?;
        categories_by_name.entry(category).or_default().push(value);
    }
    let categories = categories_by_name
        .into_iter()
        .map(|(category, values)| CategorySeries { category, values })
        .collect();

    Ok(DashboardData {
        current_assets_cents,
        total_spending_cents,
        total_income_cents,
        monthly,
        categories,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn memory_database() -> Connection {
        open(":memory:").expect("database should initialize")
    }

    #[test]
    fn stores_multiple_statements_for_one_account() {
        let connection = memory_database();
        connection
            .execute(
                "INSERT INTO accounts (institution) VALUES (?1)",
                ["Citibank"],
            )
            .unwrap();

        for (filename, month) in [
            ("statement-2026-06.pdf", "2026-06"),
            ("statement-2026-07.pdf", "2026-07"),
        ] {
            connection
                .execute(
                    "INSERT INTO statement_imports (account_id, filename, statement_date)
                     VALUES (1, ?1, ?2)",
                    params![filename, month],
                )
                .unwrap();
        }

        let count: i64 = connection
            .query_row("SELECT count(*) FROM statement_imports", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn rejects_duplicate_transactions_for_an_account() {
        let connection = memory_database();
        connection
            .execute(
                "INSERT INTO accounts (institution) VALUES (?1)",
                ["Citibank"],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO statement_imports (account_id, filename, statement_date)
                 VALUES (1, 'june.pdf', '2026-06')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO transactions
                 (account_id, statement_import_id, transaction_date, description, amount, category, transaction_hash)
                 VALUES (1, 1, '2026-06-02', 'Coffee', 550, 'food', 'same-hash')",
                [],
            )
            .unwrap();

        let duplicate = connection.execute(
            "INSERT INTO transactions
             (account_id, statement_import_id, transaction_date, description, amount, category, transaction_hash)
             VALUES (1, 1, '2026-06-02', 'Coffee', 550, 'food', 'same-hash')",
            [],
        );
        assert!(duplicate.is_err());
    }

    #[test]
    fn rejects_a_transaction_linking_different_accounts() {
        let connection = memory_database();
        connection
            .execute_batch(
                "INSERT INTO accounts (institution) VALUES ('Citibank'), ('DBS');
                 INSERT INTO statement_imports (account_id, filename, statement_date)
                 VALUES (1, 'june.pdf', '2026-06');",
            )
            .unwrap();

        let mismatched = connection.execute(
            "INSERT INTO transactions
             (account_id, statement_import_id, transaction_date, description, amount, transaction_hash)
             VALUES (2, 1, '2026-06-02', 'Coffee', 550, 'hash')",
            [],
        );
        assert!(mismatched.is_err());
    }

    #[test]
    fn aggregates_dashboard_data_by_month_and_category() {
        let connection = memory_database();
        connection
            .execute_batch(
                "INSERT INTO accounts (institution) VALUES ('Citibank');
                 INSERT INTO statement_imports (account_id, filename, statement_date)
                 VALUES (1, 'june.pdf', '2026-06'), (1, 'july.pdf', '2026-07');
                 INSERT INTO transactions
                    (account_id, statement_import_id, transaction_date, description, amount, category, transaction_hash)
                 VALUES
                    (1, 1, '2026-06-02', 'Coffee', 550, 'food', 'june-coffee'),
                    (1, 1, '2026-06-15', 'Salary', -50000, 'income', 'june-income'),
                    (1, 2, '2026-07-02', 'Coffee', 650, 'food', 'july-coffee'),
                    (1, 2, '2026-07-04', 'Bus', 200, 'transportation', 'july-bus');",
            )
            .unwrap();

        let data = dashboard_data(&connection).unwrap();
        assert_eq!(data.current_assets_cents, 0);
        assert_eq!(data.total_spending_cents, 1_400);
        assert_eq!(data.total_income_cents, 50_000);
        assert_eq!(
            data.monthly,
            vec![
                MonthlyAmount {
                    month: "2026-06".into(),
                    spending_cents: 550,
                    income_cents: 50_000,
                },
                MonthlyAmount {
                    month: "2026-07".into(),
                    spending_cents: 850,
                    income_cents: 0,
                },
            ]
        );
        assert_eq!(data.categories[0].category, "food");
        assert_eq!(data.categories[0].values.len(), 2);
        assert_eq!(data.categories[1].category, "transportation");
    }

    #[test]
    fn saves_and_replaces_an_imported_statement_atomically() {
        let mut connection = memory_database();
        let first = save_statement(
            &mut connection,
            "august.pdf",
            StatementToSave {
                institution: Some("Development Test Bank".into()),
                statement_month: Some("2026-08".into()),
                transactions: vec![TransactionToSave {
                    date: Some("2026-08-03".into()),
                    description: "Groceries".into(),
                    amount_cents: 3_290,
                    category: Some("grocery".into()),
                }],
            },
        )
        .unwrap();
        let second = save_statement(
            &mut connection,
            "august.pdf",
            StatementToSave {
                institution: Some("Development Test Bank".into()),
                statement_month: Some("2026-08".into()),
                transactions: vec![TransactionToSave {
                    date: Some("2026-08-03".into()),
                    description: "Groceries".into(),
                    amount_cents: 3_290,
                    category: Some("food".into()),
                }],
            },
        )
        .unwrap();

        assert_eq!(first.statement_import_id, second.statement_import_id);
        assert_eq!(second.transaction_count, 1);
        let category: String = connection
            .query_row("SELECT category FROM transactions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(category, "food");
        let account_count: i64 = connection
            .query_row("SELECT count(*) FROM accounts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(account_count, 1);
    }

    #[test]
    fn saves_asset_balances_and_manages_financial_items() {
        let connection = memory_database();
        let initial = assets_data(&connection).unwrap();
        assert_eq!(initial.savings_cents, 0);
        assert_eq!(initial.annual_income_cents, 0);
        assert!(initial.loans.is_empty());

        save_asset_summary(&connection, 125_000, 350_000, 80_000, 850_000).unwrap();
        let loan_id = add_financial_item(&connection, "loan", "Home mortgage", 9_500_000).unwrap();
        let policy_id = add_insurance_policy(&connection, "Term life").unwrap();
        update_financial_item(&connection, loan_id, "loan", "HDB mortgage", 9_000_000).unwrap();

        let saved = assets_data(&connection).unwrap();
        assert_eq!(saved.savings_cents, 125_000);
        assert_eq!(saved.cpf_cents, 350_000);
        assert_eq!(saved.investments_cents, 80_000);
        assert_eq!(saved.annual_income_cents, 850_000);
        assert_eq!(saved.loans[0].description, "HDB mortgage");
        assert_eq!(saved.loans[0].amount_cents, 9_000_000);
        assert_eq!(insurance_policies(&connection).unwrap()[0].id, policy_id);

        update_insurance_policy(&connection, policy_id, "Updated term life").unwrap();
        assert_eq!(
            insurance_policies(&connection).unwrap()[0].name,
            "Updated term life"
        );
        delete_insurance_policy(&connection, policy_id).unwrap();
        assert!(insurance_policies(&connection).unwrap().is_empty());
    }

    #[test]
    fn clears_all_user_finance_data() {
        let mut connection = memory_database();
        save_asset_summary(&connection, 125_000, 350_000, 80_000, 850_000).unwrap();
        add_financial_item(&connection, "loan", "Home mortgage", 9_500_000).unwrap();
        add_insurance_policy(&connection, "Term life").unwrap();
        save_statement(
            &mut connection,
            "august.pdf",
            StatementToSave {
                institution: Some("Development Test Bank".into()),
                statement_month: Some("2026-08".into()),
                transactions: vec![TransactionToSave {
                    date: Some("2026-08-03".into()),
                    description: "Groceries".into(),
                    amount_cents: 3_290,
                    category: Some("grocery".into()),
                }],
            },
        )
        .unwrap();

        clear_all_data(&mut connection).unwrap();

        assert_eq!(
            assets_data(&connection).unwrap(),
            AssetsData {
                savings_cents: 0,
                cpf_cents: 0,
                investments_cents: 0,
                annual_income_cents: 0,
                loans: vec![],
            }
        );
        assert!(insurance_policies(&connection).unwrap().is_empty());
        for table in ["accounts", "statement_imports", "transactions"] {
            let count: i64 = connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} should be empty");
        }
    }

    #[test]
    fn rejects_invalid_asset_entries() {
        let connection = memory_database();
        assert!(save_asset_summary(&connection, -1, 0, 0, 0).is_err());
        assert!(add_financial_item(&connection, "loan", "", 100).is_err());
        assert!(add_financial_item(&connection, "other", "Something", 100).is_err());
        assert!(add_financial_item(&connection, "loan", "Mortgage", -100).is_err());
    }
}
