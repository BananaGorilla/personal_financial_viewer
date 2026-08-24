import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import type { TabDefinition } from "../app-types";
import { formatAmount, isRecord, queryRequired, titleCase } from "../ui-utils";
import { getStoredApiKey } from "./settings";

type CategoryTotal = {
  category: string;
  amountCents: number;
  transactionCount: number;
};

type SaveStatementResult = {
  statementImportId: number;
  transactionCount: number;
};

const CATEGORY_OPTIONS = [
  "grocery", "utility bill", "housing", "transportation", "food", "recreation",
  "subscription", "misc", "loan", "allowance", "paynow", "health", "nothing",
];

export const statementsTab: TabDefinition = {
  id: "statements",
  label: "Statements",
  icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h9l3 3v14H6z" /><path d="M15 3.5v3h3M9 11h6m-6 4h6" /></svg>`,
  render: () => `
    <header class="page-header">
      <p class="eyebrow">STRUCTURED PDF EXTRACTION</p>
      <h1>Personal Finance Viewer</h1>
      <p>Import a financial statement and receive schema-validated JSON.</p>
    </header>

    <section class="upload-card">
      <div class="upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" /></svg></div>
      <h2>Import a statement</h2>
      <p>Choose a PDF or drag and drop one below. The file will be analyzed by OpenAI.</p>
      <button id="choose" class="primary-button">Choose PDF</button>
      <div id="drop-zone" class="drop-zone" role="button" tabindex="0">Drag and drop a PDF here</div>
      <p id="selected-path" class="selected-path" hidden></p>
    </section>

    <section id="result" class="result" hidden>
      <div class="result-toolbar">
        <div class="statement-metadata"><div class="metadata"></div><strong id="statement-period" hidden></strong></div>
        <div class="statement-save-actions">
          <span id="statement-save-status" role="status" aria-live="polite"></span>
          <button id="save-statement" class="primary-button" type="button" disabled>Save to database</button>
        </div>
      </div>
      <section id="category-summary" class="category-summary" aria-labelledby="category-summary-title" hidden>
        <div class="category-summary-heading">
          <div><p class="eyebrow">SPENDING BREAKDOWN</p><h2 id="category-summary-title">Total spent by category</h2></div>
          <strong id="spending-total" class="spending-total"></strong>
        </div>
        <div class="table-wrap">
          <table class="summary-table">
            <thead><tr><th scope="col">Category</th><th scope="col">Transactions</th><th scope="col">Amount</th></tr></thead>
            <tbody id="category-totals-body"></tbody>
            <tfoot><tr><th scope="row">Total spent</th><td id="transaction-total"></td><td id="category-grand-total"></td></tr></tfoot>
          </table>
        </div>

        <section id="category-editor" class="category-editor" aria-labelledby="category-editor-title" hidden>
          <div class="category-editor-heading">
            <div><h3 id="category-editor-title">Review transaction categories</h3><p>Change a category or mark a transaction “Not count”, then update the dashboard.</p></div>
            <button id="toggle-category-editor" class="collapse-button" type="button" aria-expanded="true" aria-controls="category-editor-content" aria-label="Collapse transaction category review">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>
          <div id="category-editor-content">
            <div class="transaction-table-wrap">
              <table class="transaction-table">
                <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Amount</th><th scope="col">Category</th><th scope="col">Not count</th></tr></thead>
                <tbody id="category-editor-body"></tbody>
              </table>
            </div>
            <div class="category-editor-actions">
              <span id="category-update-status" role="status" aria-live="polite"></span>
              <button id="update-categories" class="primary-button" type="button" disabled>Update</button>
            </div>
          </div>
        </section>
      </section>
      <details class="json-details"><summary>View extracted JSON</summary><pre></pre></details>
    </section>
  `,
  mount(panel, context) {
    const chooseButton = queryRequired<HTMLButtonElement>(panel, "#choose");
    const dropZone = queryRequired<HTMLDivElement>(panel, "#drop-zone");
    const selectedPath = queryRequired<HTMLParagraphElement>(panel, "#selected-path");
    const result = queryRequired<HTMLElement>(panel, "#result");
    const metadata = queryRequired<HTMLElement>(panel, ".metadata");
    const statementPeriod = queryRequired<HTMLElement>(panel, "#statement-period");
    const saveButton = queryRequired<HTMLButtonElement>(panel, "#save-statement");
    const saveStatus = queryRequired<HTMLElement>(panel, "#statement-save-status");
    const preview = queryRequired<HTMLPreElement>(panel, "pre");
    const categorySummary = queryRequired<HTMLElement>(panel, "#category-summary");
    const totalsBody = queryRequired<HTMLTableSectionElement>(panel, "#category-totals-body");
    const spendingTotal = queryRequired<HTMLElement>(panel, "#spending-total");
    const transactionTotal = queryRequired<HTMLTableCellElement>(panel, "#transaction-total");
    const grandTotal = queryRequired<HTMLTableCellElement>(panel, "#category-grand-total");
    const categoryEditor = queryRequired<HTMLElement>(panel, "#category-editor");
    const editorContent = queryRequired<HTMLElement>(panel, "#category-editor-content");
    const toggleEditorButton = queryRequired<HTMLButtonElement>(panel, "#toggle-category-editor");
    const editorBody = queryRequired<HTMLTableSectionElement>(panel, "#category-editor-body");
    const updateStatus = queryRequired<HTMLElement>(panel, "#category-update-status");
    const updateButton = queryRequired<HTMLButtonElement>(panel, "#update-categories");
    const jsonDetails = queryRequired<HTMLDetailsElement>(panel, ".json-details");
    const jsonSummary = queryRequired<HTMLElement>(jsonDetails, "summary");

    let currentExtraction: unknown = null;
    let currentFilename: string | null = null;
    const excludedTransactionIndexes = new Set<number>();

    function isSpendingTransaction(transaction: unknown): transaction is Record<string, unknown> {
      if (!isRecord(transaction)) return false;
      const amountCents = transaction.amount_cents;
      const kind = typeof transaction.kind === "string" ? transaction.kind.toLowerCase() : "";
      return Number.isInteger(amountCents) && (amountCents as number) > 0 && kind !== "payment" && kind !== "credit";
    }

    function getStatementPeriod(extracted: unknown) {
      if (!isRecord(extracted)) return null;
      const rawPeriod = typeof extracted.statement_month === "string"
        ? extracted.statement_month
        : typeof extracted.statement_date === "string" ? extracted.statement_date : "";
      const month = rawPeriod.trim().slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
      return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
        .format(new Date(`${month}-01T00:00:00Z`));
    }

    function getCategoryTotals(extracted: unknown): { totals: CategoryTotal[]; currency: string | null } {
      if (!isRecord(extracted)) return { totals: [], currency: null };
      const currency = typeof extracted.currency === "string" && extracted.currency.trim() ? extracted.currency.trim().toUpperCase() : null;
      const transactions = Array.isArray(extracted.transactions) ? extracted.transactions : [];
      const totalsByCategory = new Map<string, CategoryTotal>();
      transactions.forEach((transaction, transactionIndex) => {
        if (!isSpendingTransaction(transaction) || excludedTransactionIndexes.has(transactionIndex)) return;
        const rawCategory = typeof transaction.category === "string" ? transaction.category.trim() : "";
        const category = rawCategory || "uncategorized";
        const existing = totalsByCategory.get(category) ?? { category, amountCents: 0, transactionCount: 0 };
        existing.amountCents += transaction.amount_cents as number;
        existing.transactionCount += 1;
        totalsByCategory.set(category, existing);
      });
      return { currency, totals: [...totalsByCategory.values()].sort((left, right) => right.amountCents - left.amountCents) };
    }

    function renderCategoryTotals(extracted: unknown) {
      const { totals, currency } = getCategoryTotals(extracted);
      const totalCents = totals.reduce((sum, item) => sum + item.amountCents, 0);
      const totalTransactions = totals.reduce((sum, item) => sum + item.transactionCount, 0);
      totalsBody.replaceChildren();
      if (totals.length === 0) {
        const cell = totalsBody.insertRow().insertCell();
        cell.colSpan = 3;
        cell.className = "empty-table-cell";
        cell.textContent = "No categorized spending transactions were found.";
      } else {
        totals.forEach((item) => {
          const row = totalsBody.insertRow();
          row.insertCell().textContent = titleCase(item.category);
          row.insertCell().textContent = String(item.transactionCount);
          row.insertCell().textContent = formatAmount(item.amountCents, currency);
        });
      }
      spendingTotal.textContent = formatAmount(totalCents, currency);
      transactionTotal.textContent = String(totalTransactions);
      grandTotal.textContent = formatAmount(totalCents, currency);
      categorySummary.hidden = false;
    }

    function renderCategoryEditor(extracted: unknown) {
      editorBody.replaceChildren();
      updateStatus.textContent = "";
      updateButton.disabled = true;
      if (!isRecord(extracted) || !Array.isArray(extracted.transactions)) {
        categoryEditor.hidden = true;
        return;
      }
      const currency = typeof extracted.currency === "string" && extracted.currency.trim() ? extracted.currency.trim().toUpperCase() : null;
      extracted.transactions.forEach((transaction, transactionIndex) => {
        if (!isSpendingTransaction(transaction)) return;
        const date = typeof transaction.date === "string" && transaction.date ? transaction.date : "—";
        const description = typeof transaction.description === "string" && transaction.description ? transaction.description : "Transaction";
        const currentCategory = typeof transaction.category === "string" && transaction.category.trim() ? transaction.category.trim() : "misc";
        const categories = CATEGORY_OPTIONS.includes(currentCategory) ? CATEGORY_OPTIONS : [currentCategory, ...CATEGORY_OPTIONS];
        const row = editorBody.insertRow();
        row.insertCell().textContent = date;
        row.insertCell().textContent = description;
        row.insertCell().textContent = formatAmount(transaction.amount_cents as number, currency);
        const categoryCell = row.insertCell();
        const notCountCell = row.insertCell();
        const select = document.createElement("select");
        select.dataset.transactionIndex = String(transactionIndex);
        select.setAttribute("aria-label", `Category for ${description}`);
        categories.forEach((category) => {
          const option = document.createElement("option");
          option.value = category;
          option.textContent = titleCase(category);
          select.append(option);
        });
        select.value = currentCategory;
        categoryCell.append(select);
        const notCount = document.createElement("input");
        notCount.type = "checkbox";
        notCount.className = "not-count-checkbox";
        notCount.dataset.transactionIndex = String(transactionIndex);
        notCount.checked = excludedTransactionIndexes.has(transactionIndex);
        notCount.setAttribute("aria-label", `Do not count ${description}`);
        notCountCell.append(notCount);
      });
      categoryEditor.hidden = editorBody.rows.length === 0;
      editorContent.hidden = false;
      toggleEditorButton.setAttribute("aria-expanded", "true");
      toggleEditorButton.setAttribute("aria-label", "Collapse transaction category review");
    }

    function hideCategoryTotals() {
      currentExtraction = null;
      currentFilename = null;
      excludedTransactionIndexes.clear();
      categorySummary.hidden = true;
      totalsBody.replaceChildren();
      editorBody.replaceChildren();
      categoryEditor.hidden = true;
      updateStatus.textContent = "";
      updateButton.disabled = true;
      saveButton.disabled = true;
      saveStatus.textContent = "";
      statementPeriod.textContent = "";
      statementPeriod.hidden = true;
    }

    function showErrorDetails() {
      jsonSummary.textContent = "Details";
      jsonDetails.open = true;
    }

    function showExtractedStatement(extracted: unknown, sourceLabel: string, filename: string) {
      excludedTransactionIndexes.clear();
      currentExtraction = extracted;
      currentFilename = filename;
      metadata.textContent = sourceLabel;
      const period = getStatementPeriod(extracted);
      statementPeriod.textContent = period ?? "";
      statementPeriod.hidden = period === null;
      renderCategoryTotals(extracted);
      renderCategoryEditor(extracted);
      jsonSummary.textContent = "View extracted JSON";
      jsonDetails.open = false;
      preview.textContent = JSON.stringify(extracted, null, 2);
      saveStatus.textContent = "Not saved yet";
      saveButton.disabled = false;
      result.hidden = false;
    }

    function applyCategoryEdits() {
      if (!isRecord(currentExtraction) || !Array.isArray(currentExtraction.transactions)) return false;
      const transactions = currentExtraction.transactions;
      editorBody.querySelectorAll<HTMLSelectElement>("select[data-transaction-index]").forEach((select) => {
        const transactionIndex = Number(select.dataset.transactionIndex);
        const transaction = transactions[transactionIndex];
        if (Number.isInteger(transactionIndex) && isRecord(transaction)) transaction.category = select.value;
      });
      excludedTransactionIndexes.clear();
      editorBody.querySelectorAll<HTMLInputElement>("input.not-count-checkbox[data-transaction-index]").forEach((checkbox) => {
        const transactionIndex = Number(checkbox.dataset.transactionIndex);
        if (checkbox.checked && Number.isInteger(transactionIndex)) excludedTransactionIndexes.add(transactionIndex);
      });
      return true;
    }

    function statementForStorage() {
      if (!applyCategoryEdits() || !isRecord(currentExtraction) || !Array.isArray(currentExtraction.transactions)) return null;
      const statement = structuredClone(currentExtraction);
      if (!isRecord(statement) || !Array.isArray(statement.transactions)) return null;
      statement.transactions = statement.transactions.filter((_, index) => !excludedTransactionIndexes.has(index));
      return statement;
    }

    async function extractPdf(path: string) {
      if (!path.toLowerCase().endsWith(".pdf")) {
        hideCategoryTotals();
        showErrorDetails();
        metadata.textContent = "Please select a PDF file";
        preview.textContent = `Unsupported file: ${path}`;
        result.hidden = false;
        return;
      }
      const apiKey = getStoredApiKey();
      if (!apiKey) {
        hideCategoryTotals();
        showErrorDetails();
        metadata.textContent = "OpenAI API key required";
        preview.textContent = "Add your OpenAI API key in Settings, then select the PDF again.";
        result.hidden = false;
        context.selectTab("settings");
        context.events.dispatchEvent(new Event("focus-api-key"));
        return;
      }
      selectedPath.textContent = path;
      selectedPath.hidden = false;
      chooseButton.disabled = true;
      chooseButton.textContent = "Analyzing…";
      try {
        const extracted = await invoke<unknown>("extract_pdf_with_openai", { path, apiKey });
        showExtractedStatement(extracted, "OpenAI structured JSON extraction", path);
      } catch (error) {
        hideCategoryTotals();
        showErrorDetails();
        metadata.textContent = "Could not analyze this PDF";
        preview.textContent = String(error);
        result.hidden = false;
      } finally {
        chooseButton.disabled = false;
        chooseButton.textContent = "Choose PDF";
      }
    }

    async function choosePdf() {
      chooseButton.disabled = true;
      chooseButton.textContent = "Opening file picker…";
      try {
        const path = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
        if (typeof path === "string") await extractPdf(path);
      } catch (error) {
        hideCategoryTotals();
        showErrorDetails();
        metadata.textContent = "Could not open the file picker";
        preview.textContent = String(error);
        result.hidden = false;
      } finally {
        chooseButton.disabled = false;
        chooseButton.textContent = "Choose PDF";
      }
    }

    categoryEditor.addEventListener("change", (event) => {
      if (!(event.target instanceof HTMLSelectElement) && !(event.target instanceof HTMLInputElement)) return;
      updateButton.disabled = false;
      updateStatus.textContent = "Unsaved dashboard changes";
      saveStatus.textContent = "Statement has unsaved changes";
    });
    toggleEditorButton.addEventListener("click", () => {
      const expanded = toggleEditorButton.getAttribute("aria-expanded") === "true";
      editorContent.hidden = expanded;
      toggleEditorButton.setAttribute("aria-expanded", String(!expanded));
      toggleEditorButton.setAttribute("aria-label", expanded ? "Expand transaction category review" : "Collapse transaction category review");
    });
    updateButton.addEventListener("click", () => {
      if (!applyCategoryEdits()) return;
      renderCategoryTotals(currentExtraction);
      preview.textContent = JSON.stringify(currentExtraction, null, 2);
      updateButton.disabled = true;
      updateStatus.textContent = "Dashboard updated";
    });
    saveButton.addEventListener("click", async () => {
      const statement = statementForStorage();
      if (!statement || !currentFilename) {
        saveStatus.textContent = "No extracted statement to save";
        return;
      }
      saveButton.disabled = true;
      saveButton.textContent = "Saving…";
      saveStatus.textContent = "";
      try {
        const saved = await invoke<SaveStatementResult>("save_statement", { filename: currentFilename, statement });
        renderCategoryTotals(currentExtraction);
        preview.textContent = JSON.stringify(currentExtraction, null, 2);
        updateButton.disabled = true;
        updateStatus.textContent = "Dashboard updated";
        saveStatus.textContent = `Saved ${saved.transactionCount} transaction${saved.transactionCount === 1 ? "" : "s"}`;
        context.events.dispatchEvent(new Event("statement-saved"));
      } catch (error) {
        saveStatus.textContent = String(error);
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = "Save to database";
      }
    });

    chooseButton.addEventListener("click", () => void choosePdf());
    dropZone.addEventListener("click", () => void choosePdf());
    dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void choosePdf();
      }
    });
    void getCurrentWindow().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter") dropZone.classList.add("is-dragging");
      else if (payload.type === "leave") dropZone.classList.remove("is-dragging");
      else if (payload.type === "drop") {
        dropZone.classList.remove("is-dragging");
        const [path] = payload.paths;
        if (path) void extractPdf(path);
      }
    });

    async function loadTestingStatementFromArguments() {
      if (!import.meta.env.DEV) return;
      try {
        if (!await invoke<boolean>("is_testing_mode")) return;
        const { default: testingStatement } = await import("../../test_data/testing-statement-jun-2026.json");
        showExtractedStatement(structuredClone(testingStatement), "Development testing JSON", "testing-statement-aug-2026.json");
      } catch (error) {
        console.error("Could not load the development testing JSON", error);
      }
    }
    void loadTestingStatementFromArguments();
  },
};
