import "./styles.css";
import type { AppContext, TabController, TabDefinition, TabName } from "./app-types";
import { dashboardTab } from "./tabs/dashboard";
import { assetsTab } from "./tabs/assets";
import { insuranceTab } from "./tabs/insurance";
import { settingsTab } from "./tabs/settings";
import { statementsTab } from "./tabs/statements";
import { queryRequired } from "./ui-utils";

const tabDefinitions: TabDefinition[] = [statementsTab, assetsTab, insuranceTab, dashboardTab, settingsTab];
const initialTab: TabName = "statements";
const app = queryRequired<HTMLDivElement>(document, "#app");
const events = new EventTarget();
const controllers = new Map<TabName, TabController>();

function renderTabButton(tab: TabDefinition) {
  const selected = tab.id === initialTab;
  return `
    <button
      class="tab-button${selected ? " is-active" : ""}"
      id="${tab.id}-tab"
      role="tab"
      aria-selected="${selected}"
      aria-controls="${tab.id}-panel"
      data-tab="${tab.id}"
      ${selected ? "" : 'tabindex="-1"'}
    >
      ${tab.icon}
      <span>${tab.label}</span>
    </button>
  `;
}

function renderTabPanel(tab: TabDefinition) {
  const selected = tab.id === initialTab;
  return `
    <section
      class="tab-panel${tab.panelClassName ? ` ${tab.panelClassName}` : ""}"
      id="${tab.id}-panel"
      role="tabpanel"
      aria-labelledby="${tab.id}-tab"
      ${selected ? "" : "hidden"}
    >
      ${tab.render()}
    </section>
  `;
}

app.innerHTML = `
  <aside class="sidebar">
    <div class="brand" aria-label="Personal Finance Viewer">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M5 17.5V11m7 6.5v-11m7 11V3" /></svg>
      </span>
      <span class="brand-copy"><strong>Personal</strong><span>Finance Viewer</span></span>
    </div>

    <nav class="tab-list" role="tablist" aria-label="Application sections" aria-orientation="vertical">
      ${tabDefinitions.map(renderTabButton).join("")}
    </nav>

    <div class="privacy-note">
      <span class="privacy-dot" aria-hidden="true"></span>
      <span><strong>AI-assisted</strong>Selected PDFs are sent to OpenAI</span>
    </div>
  </aside>

  <div class="content-shell">
    ${tabDefinitions.map(renderTabPanel).join("")}
  </div>
`;

const tabs = Array.from(app.querySelectorAll<HTMLButtonElement>(".tab-button"));
const panels = Array.from(app.querySelectorAll<HTMLElement>(".tab-panel"));

function selectTab(tabName: TabName, focus = false) {
  tabs.forEach((tab) => {
    const selected = tab.dataset.tab === tabName;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  });

  panels.forEach((panel) => {
    panel.hidden = panel.id !== `${tabName}-panel`;
  });

  controllers.get(tabName)?.onActivate?.();
}

const context: AppContext = { events, selectTab };

tabDefinitions.forEach((definition) => {
  const panel = queryRequired<HTMLElement>(app, `#${definition.id}-panel`);
  const controller = definition.mount(panel, context);
  controllers.set(definition.id, controller ?? {});
});

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTab(tab.dataset.tab as TabName));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
    const nextIndex = (index + direction + tabs.length) % tabs.length;
    selectTab(tabs[nextIndex].dataset.tab as TabName, true);
  });
});
