# Personal Finance Viewer v0.0.1

A local-first desktop app for understanding your personal finances. Import a PDF financial statement, review its AI-extracted transactions, track assets and insurance policies, and explore your spending over time.

Built with Tauri, TypeScript, Rust, and SQLite.

> DISCLAIMER: This project is not fully done yet and it will upalod your bank statement to AI to extract out the data. Please ensure you mask out the sensitive information in the statement before you upload it

## Features

- Import financial-statement PDFs by selecting or dragging in a file.
- Use the OpenAI Responses API to extract statement data into validated JSON.
- Review and edit transaction categories before saving a statement.
- Exclude transactions from spending totals when needed.
- Store imported statements and finance data in a local SQLite database.
- Track savings, CPF, investments, annual income, and loans in SGD.
- Keep a simple list of insurance policies.
- Explore monthly income, spending, and category trends in the dashboard.
- Export a PDF snapshot of the financial overview.

## Privacy and data

Your finance database is stored locally on your device. In development, it is saved at `data/personal-finance.sqlite3`; packaged builds save it in the app's data directory.

When you import a statement, the selected PDF is sent to OpenAI for extraction. The app stores your API key in local webview storage and passes it to the native app only when an extraction is requested. Uploaded files are deleted from OpenAI on a best-effort basis after processing.

Do not commit personal statements, API keys, or a database containing real financial data to source control.

## Requirements

- Node.js and npm
- Rust toolchain
- Platform prerequisites for [Tauri v2](https://v2.tauri.app/start/prerequisites/)
- An OpenAI API key with available API billing/credits

> An OpenAI API account is separate from a ChatGPT subscription.

## Getting started

1. Install the project dependencies:

   ```sh
   npm install
   ```

2. Start the desktop app in development mode:

   ```sh
   npm run tauri dev
   ```

3. Open **Settings**, enter your OpenAI API key, and select **Save key**.

4. Open **Statements**, then choose or drag in a PDF statement.

5. Review transaction categories, mark any transactions that should not count toward spending, then save the statement to the database.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite frontend only. |
| `npm run build` | Type-check the frontend and create a production frontend build. |
| `npm run tauri dev` | Run the full desktop app in development mode. |
| `npm run tauri build` | Build a distributable desktop application. |

### Development test data

To open the app with its development testing mode enabled:

```sh
npm run tauri -- dev -- -- --testing-json
```

This flag is ignored in release builds. Example extracted-statement JSON files are available in [`test_data/`](test_data/).

## How statement extraction works

1. The app uploads the selected PDF to OpenAI with the `user_data` purpose.
2. It asks the Responses API to extract the statement according to a strict JSON Schema.
3. The app displays the extracted transactions for review.
4. After you save, the statement and transactions are written to the local SQLite database.

Amounts are stored as integer cents to avoid floating-point rounding errors. For card statements, positive amounts increase the balance; payments and other credits use negative amounts.

### Customizing extraction

The prompt and schema are deliberately separate from the API client:

- [`src-tauri/prompts/statement_extraction.md`](src-tauri/prompts/statement_extraction.md) defines the extraction instructions.
- [`src-tauri/prompts/statement_schema.json`](src-tauri/prompts/statement_schema.json) defines the expected response fields.
- [`src-tauri/src/classes/openai_pdf_extractor.rs`](src-tauri/src/classes/openai_pdf_extractor.rs) contains the reusable upload and response client.

The schema uses Structured Outputs: every object needs `additionalProperties: false`, and all properties must be required. Represent optional values with a union that includes `null`. Rebuild the app after changing the prompt or schema.

## Project structure

```text
src/                         TypeScript user interface
src/tabs/                    Statements, assets, insurance, dashboard, and settings screens
src-tauri/src/               Rust application and database code
src-tauri/migrations/        Versioned SQLite schema migrations
src-tauri/prompts/           AI extraction prompt and JSON Schema
data/                        Development SQLite database and its documentation
test_data/                   Example extracted statement data
```

For database format details, see [`data/README.md`](data/README.md).

## TODO

Add items here as you continue improving the app.

- [ ] Adding the layer to filter out sensitive information like credit card info before uploading to AI side
- [ ] Create a local model that can conduct the data extraction locally
- [ ] Support othe AI like Claude, Gemini etc
