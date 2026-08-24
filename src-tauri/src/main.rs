use personal_finance_viewer::classes::openai_pdf_extractor::OpenAiPdfExtractor;
use personal_finance_viewer::database::{
    self, AssetsData, DashboardData, InsurancePolicy, SaveStatementResult, StatementToSave,
};
use serde_json::Value;
use std::path::PathBuf;
use tauri::Manager;

const EXTRACTION_PROMPT: &str = include_str!("../prompts/statement_extraction.md");
const EXTRACTION_SCHEMA: &str = include_str!("../prompts/statement_schema.json");

#[tauri::command]
fn is_testing_mode() -> bool {
    cfg!(debug_assertions) && std::env::args().any(|argument| argument == "--testing-json")
}

/// Tauri adapter for the reusable Rust API client.
#[tauri::command]
async fn extract_pdf_with_openai(path: String, api_key: String) -> Result<Value, String> {
    let schema = serde_json::from_str(EXTRACTION_SCHEMA)
        .map_err(|error| format!("The statement JSON Schema is invalid: {error}"))?;
    let extractor = OpenAiPdfExtractor::new(
        api_key,
        "gpt-5.4-nano",
        EXTRACTION_PROMPT,
        "financial_statement",
        schema,
    )?;

    extractor.extract(path).await
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("data")
            .join("personal-finance.sqlite3"));
    }

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the application data directory: {error}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the application data directory: {error}"))?;
    Ok(directory.join("personal-finance.sqlite3"))
}

#[tauri::command]
fn get_dashboard_data(app: tauri::AppHandle) -> Result<DashboardData, String> {
    let path = database_path(&app)?;
    let connection = database::open(path)
        .map_err(|error| format!("Could not open the finance database: {error}"))?;
    database::dashboard_data(&connection)
        .map_err(|error| format!("Could not load dashboard data: {error}"))
}

fn open_app_database(app: &tauri::AppHandle) -> Result<rusqlite::Connection, String> {
    let path = database_path(app)?;
    database::open(path).map_err(|error| format!("Could not open the finance database: {error}"))
}

#[tauri::command]
fn get_assets_data(app: tauri::AppHandle) -> Result<AssetsData, String> {
    let connection = open_app_database(&app)?;
    database::assets_data(&connection).map_err(|error| format!("Could not load assets: {error}"))
}

#[tauri::command]
fn get_insurance_policies(app: tauri::AppHandle) -> Result<Vec<InsurancePolicy>, String> {
    let connection = open_app_database(&app)?;
    database::insurance_policies(&connection)
        .map_err(|error| format!("Could not load insurance policies: {error}"))
}

#[tauri::command]
fn add_insurance_policy(app: tauri::AppHandle, name: String) -> Result<i64, String> {
    let connection = open_app_database(&app)?;
    database::add_insurance_policy(&connection, &name)
}

#[tauri::command]
fn update_insurance_policy(app: tauri::AppHandle, id: i64, name: String) -> Result<(), String> {
    let connection = open_app_database(&app)?;
    database::update_insurance_policy(&connection, id, &name)
}

#[tauri::command]
fn delete_insurance_policy(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let connection = open_app_database(&app)?;
    database::delete_insurance_policy(&connection, id)
}

#[tauri::command]
fn save_asset_summary(
    app: tauri::AppHandle,
    savings_cents: i64,
    cpf_cents: i64,
    investments_cents: i64,
    annual_income_cents: i64,
) -> Result<(), String> {
    let connection = open_app_database(&app)?;
    database::save_asset_summary(
        &connection,
        savings_cents,
        cpf_cents,
        investments_cents,
        annual_income_cents,
    )
}

#[tauri::command]
fn add_financial_item(
    app: tauri::AppHandle,
    kind: String,
    description: String,
    amount_cents: i64,
) -> Result<i64, String> {
    let connection = open_app_database(&app)?;
    database::add_financial_item(&connection, &kind, &description, amount_cents)
}

#[tauri::command]
fn update_financial_item(
    app: tauri::AppHandle,
    id: i64,
    kind: String,
    description: String,
    amount_cents: i64,
) -> Result<(), String> {
    let connection = open_app_database(&app)?;
    database::update_financial_item(&connection, id, &kind, &description, amount_cents)
}

#[tauri::command]
fn delete_financial_item(app: tauri::AppHandle, id: i64, kind: String) -> Result<(), String> {
    let connection = open_app_database(&app)?;
    database::delete_financial_item(&connection, id, &kind)
}

#[tauri::command]
fn save_statement(
    app: tauri::AppHandle,
    filename: String,
    statement: StatementToSave,
) -> Result<SaveStatementResult, String> {
    let filename = std::path::Path::new(&filename)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "The statement filename is missing or invalid".to_string())?;
    let path = database_path(&app)?;
    let mut connection = database::open(path)
        .map_err(|error| format!("Could not open the finance database: {error}"))?;
    database::save_statement(&mut connection, filename, statement)
}

#[tauri::command]
fn save_pdf_report(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if !path.to_ascii_lowercase().ends_with(".pdf") {
        return Err("The report filename must end in .pdf".into());
    }
    if !bytes.starts_with(b"%PDF-") || !bytes.ends_with(b"%%EOF\n") {
        return Err("The generated report is not a valid PDF file".into());
    }
    std::fs::write(&path, bytes).map_err(|error| format!("Could not save the PDF report: {error}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            extract_pdf_with_openai,
            add_financial_item,
            delete_financial_item,
            get_assets_data,
            get_insurance_policies,
            get_dashboard_data,
            is_testing_mode,
            save_asset_summary,
            save_pdf_report,
            save_statement,
            update_financial_item,
            add_insurance_policy,
            update_insurance_policy,
            delete_insurance_policy
        ])
        .run(tauri::generate_context!())
        .expect("error while running Personal Finance Viewer");
}
