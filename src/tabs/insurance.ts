import { invoke } from "@tauri-apps/api/core";
import type { TabDefinition } from "../app-types";
import { queryRequired } from "../ui-utils";

type InsurancePolicy = { id: number; name: string };

export const insuranceTab: TabDefinition = {
  id: "insurance",
  label: "Insurance",
  icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" /><path d="M8.5 12 10.8 14.3 15.8 9.3" /></svg>`,
  panelClassName: "insurance-panel",
  render: () => `
    <header class="page-header">
      <p class="eyebrow">YOUR PROTECTION</p>
      <h1>Insurance</h1>
      <p>Keep a private list of the insurance policies you hold. More policy details can be added here later.</p>
    </header>

    <section class="insurance-card" aria-labelledby="insurance-policies-title">
      <div class="insurance-card-heading">
        <div><p class="eyebrow">POLICIES</p><h2 id="insurance-policies-title">Your insurance policies</h2></div>
        <span id="insurance-count" class="insurance-count">0 policies</span>
      </div>
      <div class="insurance-table-wrap">
        <table class="insurance-table">
          <thead><tr><th>Policy</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody id="insurance-policies"></tbody>
        </table>
      </div>
      <form id="insurance-policy-form" class="insurance-form">
        <label class="visually-hidden" for="insurance-policy-name">Policy name</label>
        <input id="insurance-policy-name" maxlength="120" placeholder="Policy name" required />
        <button id="insurance-cancel" class="text-button" type="button" hidden>Cancel</button>
        <button id="insurance-submit" class="secondary-button" type="submit">Add policy</button>
      </form>
      <p id="insurance-status" class="asset-inline-status" role="status" aria-live="polite"></p>
    </section>
  `,
  mount(panel) {
    const body = queryRequired<HTMLTableSectionElement>(panel, "#insurance-policies");
    const count = queryRequired<HTMLElement>(panel, "#insurance-count");
    const form = queryRequired<HTMLFormElement>(panel, "#insurance-policy-form");
    const name = queryRequired<HTMLInputElement>(panel, "#insurance-policy-name");
    const submit = queryRequired<HTMLButtonElement>(panel, "#insurance-submit");
    const cancel = queryRequired<HTMLButtonElement>(panel, "#insurance-cancel");
    const status = queryRequired<HTMLElement>(panel, "#insurance-status");
    let policies: InsurancePolicy[] = [];
    let editingId: number | null = null;

    function stopEditing() {
      editingId = null;
      form.reset();
      submit.textContent = "Add policy";
      cancel.hidden = true;
    }

    function render() {
      body.replaceChildren();
      count.textContent = `${policies.length} ${policies.length === 1 ? "policy" : "policies"}`;
      if (policies.length === 0) {
        const row = body.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 2;
        cell.className = "asset-empty-row";
        cell.textContent = "No insurance policies added yet.";
        return;
      }
      policies.forEach((policy) => {
        const row = body.insertRow();
        row.insertCell().textContent = policy.name;
        const actions = row.insertCell();
        actions.className = "asset-row-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "icon-button";
        edit.setAttribute("aria-label", `Edit ${policy.name}`);
        edit.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.75 4.75L8 20l11-11-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></svg>`;
        edit.addEventListener("click", () => {
          editingId = policy.id;
          name.value = policy.name;
          submit.textContent = "Save policy";
          cancel.hidden = false;
          name.focus();
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-button danger";
        remove.setAttribute("aria-label", `Remove ${policy.name}`);
        remove.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg>`;
        remove.addEventListener("click", async () => {
          if (!window.confirm(`Remove “${policy.name}”?`)) return;
          remove.disabled = true;
          try {
            await invoke("delete_insurance_policy", { id: policy.id });
            policies = policies.filter((item) => item.id !== policy.id);
            if (editingId === policy.id) stopEditing();
            render();
            status.textContent = `${policy.name} removed`;
          } catch (error) { status.textContent = String(error); }
        });
        actions.append(edit, remove);
      });
    }

    cancel.addEventListener("click", stopEditing);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = name.value.trim();
      if (!value) { status.textContent = "Enter a policy name."; return; }
      submit.disabled = true;
      status.textContent = "Saving…";
      try {
        if (editingId === null) {
          const id = await invoke<number>("add_insurance_policy", { name: value });
          policies.push({ id, name: value });
          status.textContent = `${value} added`;
        } else {
          await invoke("update_insurance_policy", { id: editingId, name: value });
          const policy = policies.find((item) => item.id === editingId)!;
          policy.name = value;
          status.textContent = `${value} updated`;
        }
        stopEditing();
        render();
      } catch (error) { status.textContent = String(error); }
      finally { submit.disabled = false; }
    });

    const load = () => invoke<InsurancePolicy[]>("get_insurance_policies").then((items) => { policies = items; render(); }).catch((error) => { status.textContent = String(error); });
    load();
    return { onActivate: load };
  },
};
