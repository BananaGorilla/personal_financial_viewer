import type { TabDefinition } from "../app-types";
import { invoke } from "@tauri-apps/api/core";
import { queryRequired } from "../ui-utils";

export const API_KEY_STORAGE_KEY = "personal-finance-viewer.ai-api-key";

export function getStoredApiKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export const settingsTab: TabDefinition = {
  id: "settings",
  label: "Settings",
  icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1-1.55V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.55 1H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" /></svg>`,
  render: () => `
    <header class="page-header">
      <p class="eyebrow">PREFERENCES</p>
      <h1>Settings</h1>
      <p>Configure how your finance viewer works.</p>
    </header>

    <section class="settings-card" aria-labelledby="ai-settings-title">
      <div class="settings-card-heading">
        <span class="settings-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14.5 5.5a4 4 0 1 1-5.2 6.06L3.5 17.35V21h3.65v-2.2h2.2v-2.2h2.2l1.9-1.9" /><circle cx="14.5" cy="5.5" r=".75" /></svg></span>
        <div><h2 id="ai-settings-title">AI connection</h2><p>Add the API key for your AI provider.</p></div>
      </div>

      <form id="api-key-form">
        <label for="api-key">AI API key</label>
        <div class="secret-input-wrap">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5a4 4 0 1 1-5.2 6.06L3.5 17.35V21h3.65v-2.2h2.2v-2.2h2.2l1.9-1.9" /></svg>
          <input id="api-key" name="api-key" type="password" placeholder="Enter your API key" autocomplete="off" spellcheck="false" aria-describedby="api-key-help" />
        </div>
        <p id="api-key-help" class="field-help">Your key is masked and stored on this device. It is sent only to the OpenAI API with your request.</p>
        <div class="form-actions">
          <span id="save-status" class="save-status" role="status" aria-live="polite"></span>
          <button type="submit" class="primary-button">Save key</button>
        </div>
      </form>
    </section>

    <section class="settings-card danger-settings-card" aria-labelledby="data-settings-title">
      <div class="settings-card-heading">
        <span class="settings-icon danger-settings-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 6h18M9 6V4h6v2m-9 0 1 15h10l1-15M10 10v7m4-7v7" /></svg></span>
        <div><h2 id="data-settings-title">Start fresh</h2><p>Permanently remove all saved finance data from this device.</p></div>
      </div>
      <div class="danger-settings-content">
        <p>Imported statements, assets, loans, and insurance policies will be deleted. Your AI key will remain saved.</p>
        <div class="form-actions">
          <span id="clear-data-status" class="save-status" role="status" aria-live="polite"></span>
          <button id="clear-data" class="danger-button" type="button">Clear database</button>
        </div>
      </div>
    </section>
  `,
  mount(panel, context) {
    const form = queryRequired<HTMLFormElement>(panel, "#api-key-form");
    const input = queryRequired<HTMLInputElement>(panel, "#api-key");
    const status = queryRequired<HTMLSpanElement>(panel, "#save-status");
    const clearButton = queryRequired<HTMLButtonElement>(panel, "#clear-data");
    const clearStatus = queryRequired<HTMLSpanElement>(panel, "#clear-data-status");

    input.value = getStoredApiKey();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const key = input.value.trim();

      try {
        if (key) localStorage.setItem(API_KEY_STORAGE_KEY, key);
        else localStorage.removeItem(API_KEY_STORAGE_KEY);
        input.value = key;
        status.textContent = key ? "Key saved" : "Saved (no key)";
        window.setTimeout(() => { status.textContent = ""; }, 2500);
      } catch {
        status.textContent = "Could not save the key";
      }
    });

    clearButton.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Clear all saved finance data? This permanently deletes imported statements, assets, loans, and insurance policies."
      );
      if (!confirmed) return;

      clearButton.disabled = true;
      clearButton.textContent = "Clearing…";
      clearStatus.textContent = "";
      try {
        await invoke("clear_all_finance_data");
        clearStatus.textContent = "Database cleared. You can start fresh.";
        context.events.dispatchEvent(new Event("finance-data-cleared"));
      } catch (error) {
        clearStatus.textContent = `Could not clear the database: ${String(error)}`;
      } finally {
        clearButton.disabled = false;
        clearButton.textContent = "Clear database";
      }
    });

    context.events.addEventListener("focus-api-key", () => input.focus());
  },
};
