import { invoke } from "@tauri-apps/api/core";
import type { TabDefinition } from "../app-types";
import { formatAmount, queryRequired } from "../ui-utils";

type ItemKind = "loan";

type FinancialItem = {
  id: number;
  description: string;
  amountCents: number;
};

type AssetsData = {
  savingsCents: number;
  cpfCents: number;
  investmentsCents: number;
  annualIncomeCents: number;
  loans: FinancialItem[];
};

function parseAmount(value: string) {
  const normalized = value.replaceAll(",", "").trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, decimal = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function amountInput(id: string, label: string, help: string) {
  return `
    <label class="asset-field" for="${id}">
      <span>${label}</span>
      <span class="amount-input-wrap"><span aria-hidden="true">$</span><input id="${id}" inputmode="decimal" placeholder="0.00" aria-describedby="${id}-help" /></span>
      <small id="${id}-help">${help}</small>
    </label>
  `;
}

function listSection(kind: ItemKind, title: string, description: string) {
  return `
    <section class="asset-list-card" aria-labelledby="${kind}-title">
      <div class="asset-list-heading">
        <div><p class="eyebrow">${kind === "loan" ? "LIABILITIES" : "PROTECTION"}</p><h2 id="${kind}-title">${title}</h2><p>${description}</p></div>
        <strong id="${kind}-total" class="asset-list-total">0.00</strong>
      </div>
      <div class="asset-table-wrap">
        <table class="asset-table">
          <thead><tr><th>Description</th><th>Amount</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody id="${kind}-items"></tbody>
        </table>
      </div>
      <form id="${kind}-form" class="asset-item-form">
        <input id="${kind}-description" aria-label="${title} description" placeholder="Description" maxlength="120" required />
        <span class="amount-input-wrap compact"><span aria-hidden="true">$</span><input id="${kind}-amount" aria-label="${title} amount" inputmode="decimal" placeholder="0.00" required /></span>
        <div class="asset-form-actions">
          <button id="${kind}-cancel" class="text-button" type="button" hidden>Cancel</button>
          <button id="${kind}-submit" class="secondary-button" type="submit">Add ${kind === "loan" ? "loan" : "policy"}</button>
        </div>
      </form>
      <p id="${kind}-status" class="asset-inline-status" role="status" aria-live="polite"></p>
    </section>
  `;
}

export const assetsTab: TabDefinition = {
  id: "assets",
  label: "Assets",
  icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.5 12 4l9 5.5M5 10.5V19m4-8.5V19m6-8.5V19m4-8.5V19M3 20h18" /></svg>`,
  panelClassName: "assets-panel",
  render: () => `
    <header class="page-header">
      <p class="eyebrow">NET WORTH</p>
      <h1>Assets</h1>
      <p>Keep a simple snapshot of what you own, owe, and protect.</p>
    </header>

    <div id="assets-loading" class="dashboard-message" role="status">Loading assets…</div>
    <div id="assets-error" class="dashboard-message is-error" role="alert" hidden></div>

    <div id="assets-content" hidden>
      <section class="asset-overview" aria-label="Asset overview">
        <article><span>Total assets</span><strong id="total-assets">0.00</strong></article>
        <article><span>Total loans</span><strong id="total-loans">0.00</strong></article>
        <article class="net-worth-card"><span>Net worth</span><strong id="net-worth">0.00</strong></article>
      </section>

      <section class="asset-balance-card" aria-labelledby="asset-balance-title">
        <div class="asset-card-heading"><div><p class="eyebrow">YOUR BALANCES</p><h2 id="asset-balance-title">Asset amounts</h2></div><span>Amounts are saved in SGD</span></div>
        <form id="asset-summary-form">
          <div class="asset-field-grid">
            ${amountInput("savings-amount", "Savings", "Cash and savings accounts")}
            ${amountInput("cpf-amount", "CPF", "Total CPF balance")}
            ${amountInput("investments-amount", "Investments", "Stocks, funds, and other investments")}
            ${amountInput("annual-income-amount", "Annual income", "Your gross income per year")}
          </div>
          <div class="asset-summary-actions"><span id="asset-summary-status" role="status" aria-live="polite"></span><button class="primary-button" type="submit">Save amounts</button></div>
        </form>
      </section>

      <div class="asset-lists asset-lists-single">
        ${listSection("loan", "Loans", "Mortgages and other outstanding balances.")}
      </div>
    </div>
  `,
  mount(panel) {
    const loading = queryRequired<HTMLElement>(panel, "#assets-loading");
    const error = queryRequired<HTMLElement>(panel, "#assets-error");
    const content = queryRequired<HTMLElement>(panel, "#assets-content");
    const summaryForm = queryRequired<HTMLFormElement>(panel, "#asset-summary-form");
    const summaryStatus = queryRequired<HTMLElement>(panel, "#asset-summary-status");
    const savingsInput = queryRequired<HTMLInputElement>(panel, "#savings-amount");
    const cpfInput = queryRequired<HTMLInputElement>(panel, "#cpf-amount");
    const investmentsInput = queryRequired<HTMLInputElement>(panel, "#investments-amount");
    const annualIncomeInput = queryRequired<HTMLInputElement>(panel, "#annual-income-amount");
    const totalAssets = queryRequired<HTMLElement>(panel, "#total-assets");
    const totalLoans = queryRequired<HTMLElement>(panel, "#total-loans");
    const netWorth = queryRequired<HTMLElement>(panel, "#net-worth");
    let data: AssetsData | null = null;

    const formatInput = (cents: number) => (cents / 100).toFixed(2);
    const showError = (message: unknown) => {
      loading.hidden = true;
      content.hidden = true;
      error.textContent = String(message);
      error.hidden = false;
    };

    function updateOverview() {
      if (!data) return;
      const assetCents = data.savingsCents + data.cpfCents + data.investmentsCents;
      const loanCents = data.loans.reduce((sum, item) => sum + item.amountCents, 0);
      totalAssets.textContent = formatAmount(assetCents, "SGD");
      totalLoans.textContent = formatAmount(loanCents, "SGD");
      netWorth.textContent = formatAmount(assetCents - loanCents, "SGD");
      netWorth.classList.toggle("is-negative", assetCents - loanCents < 0);
      queryRequired<HTMLElement>(panel, "#loan-total").textContent = formatAmount(loanCents, "SGD");
    }

    function setupList(kind: ItemKind) {
      const tbody = queryRequired<HTMLTableSectionElement>(panel, `#${kind}-items`);
      const form = queryRequired<HTMLFormElement>(panel, `#${kind}-form`);
      const description = queryRequired<HTMLInputElement>(panel, `#${kind}-description`);
      const amount = queryRequired<HTMLInputElement>(panel, `#${kind}-amount`);
      const submit = queryRequired<HTMLButtonElement>(panel, `#${kind}-submit`);
      const cancel = queryRequired<HTMLButtonElement>(panel, `#${kind}-cancel`);
      const status = queryRequired<HTMLElement>(panel, `#${kind}-status`);
      let editingId: number | null = null;
      const noun = "loan";
      const items = () => data!.loans;

      function stopEditing() {
        editingId = null;
        form.reset();
        submit.textContent = `Add ${noun}`;
        cancel.hidden = true;
      }

      function renderRows() {
        tbody.replaceChildren();
        if (items().length === 0) {
          const row = tbody.insertRow();
          const cell = row.insertCell();
          cell.colSpan = 3;
          cell.className = "asset-empty-row";
          cell.textContent = "No loans added yet.";
          return;
        }
        items().forEach((item) => {
          const row = tbody.insertRow();
          const descriptionCell = row.insertCell();
          descriptionCell.textContent = item.description;
          const amountCell = row.insertCell();
          amountCell.textContent = formatAmount(item.amountCents, "SGD");
          const actions = row.insertCell();
          actions.className = "asset-row-actions";
          const edit = document.createElement("button");
          edit.type = "button";
          edit.className = "icon-button";
          edit.title = `Edit ${noun}`;
          edit.setAttribute("aria-label", `Edit ${item.description}`);
          edit.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.75 4.75L8 20l11-11-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></svg>`;
          edit.addEventListener("click", () => {
            editingId = item.id;
            description.value = item.description;
            amount.value = formatInput(item.amountCents);
            submit.textContent = `Save ${noun}`;
            cancel.hidden = false;
            description.focus();
          });
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "icon-button danger";
          remove.title = `Remove ${noun}`;
          remove.setAttribute("aria-label", `Remove ${item.description}`);
          remove.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg>`;
          remove.addEventListener("click", async () => {
            if (!window.confirm(`Remove “${item.description}”?`)) return;
            remove.disabled = true;
            try {
              await invoke("delete_financial_item", { id: item.id, kind });
              const index = items().findIndex((candidate) => candidate.id === item.id);
              if (index >= 0) items().splice(index, 1);
              if (editingId === item.id) stopEditing();
              renderRows();
              updateOverview();
              status.textContent = `${item.description} removed`;
            } catch (failure) {
              status.textContent = String(failure);
            }
          });
          actions.append(edit, remove);
        });
      }

      cancel.addEventListener("click", stopEditing);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const amountCents = parseAmount(amount.value);
        const cleanDescription = description.value.trim();
        if (!cleanDescription || amountCents === null) {
          status.textContent = "Enter a description and a valid non-negative amount.";
          return;
        }
        submit.disabled = true;
        status.textContent = "Saving…";
        try {
          if (editingId === null) {
            const id = await invoke<number>("add_financial_item", { kind, description: cleanDescription, amountCents });
            items().push({ id, description: cleanDescription, amountCents });
            status.textContent = `${cleanDescription} added`;
          } else {
            await invoke("update_financial_item", { id: editingId, kind, description: cleanDescription, amountCents });
            const item = items().find((candidate) => candidate.id === editingId)!;
            item.description = cleanDescription;
            item.amountCents = amountCents;
            status.textContent = `${cleanDescription} updated`;
          }
          stopEditing();
          renderRows();
          updateOverview();
        } catch (failure) {
          status.textContent = String(failure);
        } finally {
          submit.disabled = false;
        }
      });
      return renderRows;
    }

    const renderLoans = setupList("loan");

    function render(nextData: AssetsData) {
      data = nextData;
      savingsInput.value = formatInput(data.savingsCents);
      cpfInput.value = formatInput(data.cpfCents);
      investmentsInput.value = formatInput(data.investmentsCents);
      annualIncomeInput.value = formatInput(data.annualIncomeCents);
      renderLoans();
      updateOverview();
      loading.hidden = true;
      error.hidden = true;
      content.hidden = false;
    }

    summaryForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = [savingsInput, cpfInput, investmentsInput, annualIncomeInput].map((input) => parseAmount(input.value));
      if (values.some((value) => value === null)) {
        summaryStatus.textContent = "Enter valid non-negative amounts.";
        return;
      }
      const [savingsCents, cpfCents, investmentsCents, annualIncomeCents] = values as number[];
      const button = queryRequired<HTMLButtonElement>(summaryForm, "button[type=submit]");
      button.disabled = true;
      summaryStatus.textContent = "Saving…";
      try {
        await invoke("save_asset_summary", { savingsCents, cpfCents, investmentsCents, annualIncomeCents });
        Object.assign(data!, { savingsCents, cpfCents, investmentsCents, annualIncomeCents });
        updateOverview();
        summaryStatus.textContent = "Amounts saved";
      } catch (failure) {
        summaryStatus.textContent = String(failure);
      } finally {
        button.disabled = false;
      }
    });

    invoke<AssetsData>("get_assets_data").then(render).catch(showError);
    return { onActivate: () => { if (!data) invoke<AssetsData>("get_assets_data").then(render).catch(showError); } };
  },
};
