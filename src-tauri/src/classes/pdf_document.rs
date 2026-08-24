use std::path::{Path, PathBuf};

use pdf_extract::Document;
use serde::Serialize;

#[derive(Serialize)]
pub struct ExtractionResult {
    pub pages: usize,
    pub text: String,
    pub method: &'static str,
}

/// Represents one bank-statement PDF and the operations we can perform on it.
///
/// Keeping the path and PDF-specific behavior together gives later stages (such as
/// transaction parsing and validation) a single, debuggable place to grow from.
#[derive(Debug, Clone)]
pub struct PdfDocument {
    path: PathBuf,
}

impl PdfDocument {
    /// Creates a PDF document reference. The PDF is opened only when an operation
    /// needs it, which keeps construction lightweight and errors close to the action.
    pub fn new(path: impl Into<PathBuf>) -> Result<Self, String> {
        let path = path.into();
        if path.as_os_str().is_empty() {
            return Err("A PDF file path is required".to_string());
        }

        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn load(&self) -> Result<Document, String> {
        Document::load(self.path())
            .map_err(|error| format!("Unable to open PDF '{}': {error}", self.path().display()))
    }

    /// Extracts the PDF's existing text layer. Scanned PDFs require OCR.
    pub fn extract_text(&self) -> Result<ExtractionResult, String> {
        let document = self.load()?;
        let pages = document.get_pages().len();
        let text = pdf_extract::extract_text(self.path())
            .map_err(|error| format!("Unable to read embedded text: {error}"))?;

        Ok(ExtractionResult {
            pages,
            text,
            method: "embedded PDF text",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::PdfDocument;

    #[test]
    fn document_keeps_its_path() {
        let document = PdfDocument::new("statement.pdf").expect("path should be valid");
        assert_eq!(document.path().to_string_lossy(), "statement.pdf");
    }

    #[test]
    fn document_requires_a_path() {
        assert!(PdfDocument::new("").is_err());
    }
}
