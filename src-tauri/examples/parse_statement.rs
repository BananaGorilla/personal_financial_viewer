use std::{env, process};

use personal_finance_viewer::{
    classes::pdf_document::PdfDocument, statement_parser::CitiCreditCardParser,
};

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let (raw, path) = match arguments.as_slice() {
        [path] => (false, path),
        [flag, path] if flag == "--raw" => (true, path),
        _ => {
            eprintln!(
                "Usage: cargo run --example parse_statement -- [--raw] /path/to/statement.pdf"
            );
            process::exit(2);
        }
    };

    let extracted = match PdfDocument::new(path).and_then(|document| document.extract_text()) {
        Ok(extracted) => extracted,
        Err(error) => {
            eprintln!("{error}");
            process::exit(1);
        }
    };

    if raw {
        print!("{}", extracted.text);
        return;
    }

    let result = CitiCreditCardParser::parse(&extracted.text);

    match result {
        Ok(statement) => println!(
            "{}",
            serde_json::to_string_pretty(&statement).expect("statement is serializable")
        ),
        Err(error) => {
            eprintln!("{error}");
            process::exit(1);
        }
    }
}
