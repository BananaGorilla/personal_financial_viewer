use std::{path::Path, time::Duration};

use reqwest::{multipart, Client, Response, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};

const OPENAI_API_BASE: &str = "https://api.openai.com/v1";
const MAX_PDF_BYTES: u64 = 50 * 1024 * 1024;

/// Uploads a PDF to OpenAI and converts the model's schema-constrained output
/// into `serde_json::Value`.
///
/// The prompt and JSON Schema are constructor arguments on purpose. Callers can
/// keep them in standalone files and change extraction behavior without changing
/// this API client.
pub struct OpenAiPdfExtractor {
    client: Client,
    api_key: String,
    model: String,
    prompt: String,
    schema_name: String,
    schema: Value,
}

impl OpenAiPdfExtractor {
    pub fn new(
        api_key: impl Into<String>,
        model: impl Into<String>,
        prompt: impl Into<String>,
        schema_name: impl Into<String>,
        schema: Value,
    ) -> Result<Self, String> {
        let api_key = api_key.into().trim().to_owned();
        let model = model.into().trim().to_owned();
        let prompt = prompt.into().trim().to_owned();
        let schema_name = schema_name.into().trim().to_owned();

        if api_key.is_empty() {
            return Err("An OpenAI API key is required".into());
        }
        if model.is_empty() {
            return Err("An OpenAI model is required".into());
        }
        if prompt.is_empty() {
            return Err("The PDF extraction prompt is empty".into());
        }
        if schema_name.is_empty() {
            return Err("A JSON Schema name is required".into());
        }
        if schema.get("type").and_then(Value::as_str) != Some("object") {
            return Err("The extraction schema root must have type 'object'".into());
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|error| format!("Unable to create the OpenAI HTTP client: {error}"))?;

        Ok(Self {
            client,
            api_key,
            model,
            prompt,
            schema_name,
            schema,
        })
    }

    /// Uploads `pdf_path`, asks OpenAI for JSON matching the configured schema,
    /// parses that JSON, and then makes a best-effort deletion of the upload.
    pub async fn extract(&self, pdf_path: impl AsRef<Path>) -> Result<Value, String> {
        let pdf_path = pdf_path.as_ref();
        validate_pdf(pdf_path)?;

        let file_id = self.upload_pdf(pdf_path).await?;
        let extraction = self.create_response(&file_id).await;

        // `user_data` uploads otherwise persist until deleted. Cleanup should not
        // hide an extraction result that was already returned successfully.
        let _ = self.delete_file(&file_id).await;

        extraction
    }

    async fn upload_pdf(&self, pdf_path: &Path) -> Result<String, String> {
        let filename = pdf_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "The PDF filename is not valid UTF-8".to_string())?
            .to_owned();
        let bytes = std::fs::read(pdf_path)
            .map_err(|error| format!("Unable to read PDF '{}': {error}", pdf_path.display()))?;
        let file_part = multipart::Part::bytes(bytes)
            .file_name(filename)
            .mime_str("application/pdf")
            .map_err(|error| format!("Unable to prepare the PDF upload: {error}"))?;
        let form = multipart::Form::new()
            .text("purpose", "user_data")
            .part("file", file_part);

        let response = self
            .client
            .post(format!("{OPENAI_API_BASE}/files"))
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|error| format!("OpenAI file upload failed: {error}"))?;
        let body = response_json(response, "OpenAI file upload").await?;

        body.get("id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| "OpenAI uploaded the PDF but did not return a file ID".into())
    }

    async fn create_response(&self, file_id: &str) -> Result<Value, String> {
        let request = json!({
            "model": self.model,
            "store": false,
            "input": [{
                "role": "user",
                "content": [
                    {
                        "type": "input_file",
                        "file_id": file_id,
                        "detail": "high"
                    },
                    {
                        "type": "input_text",
                        "text": self.prompt
                    }
                ]
            }],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": self.schema_name,
                    "schema": self.schema,
                    "strict": true
                }
            }
        });

        let response = self
            .client
            .post(format!("{OPENAI_API_BASE}/responses"))
            .bearer_auth(&self.api_key)
            .json(&request)
            .send()
            .await
            .map_err(|error| format!("OpenAI PDF extraction failed: {error}"))?;
        let body = response_json(response, "OpenAI PDF extraction").await?;

        parse_output_json(&body)
    }

    async fn delete_file(&self, file_id: &str) -> Result<(), String> {
        let response = self
            .client
            .delete(format!("{OPENAI_API_BASE}/files/{file_id}"))
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|error| format!("Unable to delete the temporary OpenAI file: {error}"))?;

        if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
            Ok(())
        } else {
            Err(format!(
                "OpenAI could not delete the temporary file (HTTP {})",
                response.status()
            ))
        }
    }
}

fn validate_pdf(path: &Path) -> Result<(), String> {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("pdf"))
        .unwrap_or(true)
    {
        return Err("Only PDF files can be uploaded".into());
    }

    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("Unable to inspect PDF '{}': {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("'{}' is not a file", path.display()));
    }
    if metadata.len() == 0 {
        return Err("The selected PDF is empty".into());
    }
    if metadata.len() >= MAX_PDF_BYTES {
        return Err("The selected PDF must be smaller than OpenAI's 50 MB file-input limit".into());
    }

    Ok(())
}

async fn response_json(response: Response, action: &str) -> Result<Value, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("{action} returned an unreadable response: {error}"))?;

    if !status.is_success() {
        let message = serde_json::from_str::<ApiErrorEnvelope>(&body)
            .ok()
            .and_then(|envelope| envelope.error.map(|error| error.message))
            .unwrap_or_else(|| "The API did not provide an error message".into());
        return Err(format!("{action} failed (HTTP {status}): {message}"));
    }

    serde_json::from_str(&body).map_err(|error| format!("{action} returned invalid JSON: {error}"))
}

fn parse_output_json(response: &Value) -> Result<Value, String> {
    if response.get("status").and_then(Value::as_str) != Some("completed") {
        let reason = response
            .pointer("/incomplete_details/reason")
            .and_then(Value::as_str)
            .or_else(|| response.pointer("/error/message").and_then(Value::as_str))
            .unwrap_or("unknown reason");
        return Err(format!("OpenAI did not complete the extraction: {reason}"));
    }

    let output = response
        .get("output")
        .and_then(Value::as_array)
        .ok_or_else(|| "OpenAI returned no output items".to_string())?;

    for item in output {
        let Some(content) = item.get("content").and_then(Value::as_array) else {
            continue;
        };
        for part in content {
            match part.get("type").and_then(Value::as_str) {
                Some("output_text") => {
                    let text = part
                        .get("text")
                        .and_then(Value::as_str)
                        .ok_or_else(|| "OpenAI returned an empty output_text item".to_string())?;
                    return serde_json::from_str(text).map_err(|error| {
                        format!("OpenAI's structured output was not valid JSON: {error}")
                    });
                }
                Some("refusal") => {
                    let refusal = part
                        .get("refusal")
                        .and_then(Value::as_str)
                        .unwrap_or("The request was refused");
                    return Err(format!("OpenAI refused the PDF extraction: {refusal}"));
                }
                _ => {}
            }
        }
    }

    Err("OpenAI completed the request without returning structured JSON".into())
}

#[derive(Deserialize)]
struct ApiErrorEnvelope {
    error: Option<ApiError>,
}

#[derive(Deserialize)]
struct ApiError {
    message: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{parse_output_json, OpenAiPdfExtractor};

    fn schema() -> serde_json::Value {
        json!({
            "type": "object",
            "properties": { "answer": { "type": "string" } },
            "required": ["answer"],
            "additionalProperties": false
        })
    }

    #[test]
    fn requires_an_api_key() {
        let result = OpenAiPdfExtractor::new("", "gpt-5.4-nano", "Extract", "result", schema());
        assert!(result.is_err());
    }

    #[test]
    fn parses_structured_output_text() {
        let response = json!({
            "status": "completed",
            "output": [{
                "type": "message",
                "content": [{ "type": "output_text", "text": "{\"answer\":\"ok\"}" }]
            }]
        });

        assert_eq!(
            parse_output_json(&response).unwrap(),
            json!({ "answer": "ok" })
        );
    }

    #[test]
    fn surfaces_refusals() {
        let response = json!({
            "status": "completed",
            "output": [{
                "type": "message",
                "content": [{ "type": "refusal", "refusal": "cannot process" }]
            }]
        });

        assert!(parse_output_json(&response)
            .unwrap_err()
            .contains("cannot process"));
    }
}
