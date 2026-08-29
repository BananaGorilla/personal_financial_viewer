use std::{
    fs,
    path::{Path, PathBuf},
};

#[cfg(target_os = "macos")]
use std::{
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
use std::os::unix::fs::PermissionsExt;

#[cfg(target_os = "macos")]
const REDACTOR_HELPER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/pdf-redactor-helper"));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperSummary {
    page_count: usize,
    redaction_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactedPdf {
    pub path: PathBuf,
    pub page_count: usize,
    pub redaction_count: usize,
}

/// Creates a flattened, image-only PDF using Apple's on-device Vision OCR.
///
/// The generated PDF is deliberately kept beside the source document for user
/// review. Existing files are never overwritten.
pub fn redact_card_numbers(source: impl AsRef<Path>) -> Result<RedactedPdf, String> {
    redact_card_numbers_impl(source.as_ref())
}

#[cfg(not(target_os = "macos"))]
fn redact_card_numbers_impl(_source: &Path) -> Result<RedactedPdf, String> {
    Err("Local OCR redaction currently requires macOS 13 or newer".into())
}

#[cfg(target_os = "macos")]
fn redact_card_numbers_impl(source: &Path) -> Result<RedactedPdf, String> {
    validate_source(source)?;
    let output_path = available_output_path(source)?;
    let helper_path = extracted_helper_path();
    fs::write(&helper_path, REDACTOR_HELPER)
        .map_err(|error| format!("Could not prepare the local OCR redactor: {error}"))?;
    fs::set_permissions(&helper_path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Could not make the local OCR redactor executable: {error}"))?;

    let result = Command::new(&helper_path)
        .arg(source)
        .arg(&output_path)
        .output()
        .map_err(|error| format!("Could not start the local OCR redactor: {error}"));
    let _ = fs::remove_file(&helper_path);

    let result = result?;
    if !result.status.success() {
        let _ = fs::remove_file(&output_path);
        let detail = String::from_utf8_lossy(&result.stderr).trim().to_owned();
        return Err(if detail.is_empty() {
            "Local OCR redaction failed without an error message".into()
        } else {
            format!("Local OCR redaction failed: {detail}")
        });
    }

    let summary: HelperSummary = serde_json::from_slice(&result.stdout)
        .map_err(|error| format!("The local OCR redactor returned an invalid summary: {error}"))?;
    let metadata = fs::metadata(&output_path)
        .map_err(|error| format!("Could not inspect the redacted PDF: {error}"))?;
    if metadata.len() == 0 {
        return Err("The local OCR redactor created an empty PDF".into());
    }

    Ok(RedactedPdf {
        path: output_path,
        page_count: summary.page_count,
        redaction_count: summary.redaction_count,
    })
}

fn validate_source(source: &Path) -> Result<(), String> {
    if source
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("pdf"))
        .unwrap_or(true)
    {
        return Err("Only PDF files can be redacted".into());
    }
    let metadata = fs::metadata(source)
        .map_err(|error| format!("Unable to inspect PDF '{}': {error}", source.display()))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("The selected PDF is missing or empty".into());
    }
    Ok(())
}

fn available_output_path(source: &Path) -> Result<PathBuf, String> {
    let parent = source
        .parent()
        .ok_or_else(|| "The selected PDF does not have a parent directory".to_string())?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The selected PDF has an invalid filename".to_string())?;

    for suffix in 1..=10_000 {
        let filename = if suffix == 1 {
            format!("{stem}.redacted.pdf")
        } else {
            format!("{stem}.redacted-{suffix}.pdf")
        };
        let candidate = parent.join(filename);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not choose a filename for the redacted PDF".into())
}

#[cfg(target_os = "macos")]
fn extracted_helper_path() -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "personal-finance-pdf-redactor-{}-{timestamp}",
        std::process::id()
    ))
}

#[cfg(test)]
mod tests {
    use super::available_output_path;

    #[test]
    fn chooses_a_redacted_pdf_beside_the_source() {
        let path = available_output_path(std::path::Path::new("/tmp/statement.pdf")).unwrap();
        assert_eq!(path, std::path::Path::new("/tmp/statement.redacted.pdf"));
    }
}
