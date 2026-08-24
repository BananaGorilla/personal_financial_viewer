import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { TabDefinition } from "../app-types";
import { generateDashboardPdf } from "../pdf-report";
import { addSvgText, formatAmount, formatMonth, queryRequired, svgElement, titleCase } from "../ui-utils";

type MonthlyAmount = {
  month: string;
  spendingCents: number;
  incomeCents: number;
};

type CategorySeries = {
  category: string;
  values: { month: string; amountCents: number }[];
};

type DashboardData = {
  currentAssetsCents: number;
  totalSpendingCents: number;
  totalIncomeCents: number;
  monthly: MonthlyAmount[];
  categories: CategorySeries[];
};

const SERIES_CLASS_COUNT = 8;

export const dashboardTab: TabDefinition = {
  id: "dashboard",
  label: "Dashboard",
  icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" /></svg>`,
  panelClassName: "dashboard-panel",
  render: () => `
    <header class="page-header dashboard-header">
      <div>
        <p class="eyebrow">FINANCIAL OVERVIEW</p>
        <h1>Spending timeline</h1>
        <p>Monthly totals and category trends from your imported statements.</p>
      </div>
      <button id="refresh-dashboard" class="secondary-button" type="button">Refresh</button>
    </header>

    <div id="dashboard-loading" class="dashboard-message" role="status">Loading dashboard…</div>
    <div id="dashboard-error" class="dashboard-message is-error" role="alert" hidden></div>
    <div id="dashboard-empty" class="dashboard-message dashboard-empty" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17.5V11m7 6.5v-11m7 11V3" /></svg>
      <strong>No transaction history yet</strong>
      <span>Import statements into the SQLite database to see monthly trends.</span>
    </div>

    <div id="dashboard-content" hidden>
      <section class="metric-grid" aria-label="All-time totals">
        <article class="metric-card assets-metric">
          <span>Current assets</span><strong id="dashboard-current-assets">0.00</strong><small>Savings, CPF, and investments</small>
        </article>
        <article class="metric-card spending-metric">
          <span>Total spending</span><strong id="dashboard-total-spending">0.00</strong><small>Across all imported months</small>
        </article>
        <article class="metric-card income-metric">
          <span>Total income</span><strong id="dashboard-total-income">0.00</strong><small>Across all imported months</small>
        </article>
      </section>

      <section class="chart-card" aria-labelledby="monthly-spending-title">
        <div class="chart-heading">
          <div><p class="eyebrow">MONTHLY CASH FLOW</p><h2 id="monthly-spending-title">Spending and income by month</h2></div>
          <div class="bar-chart-legend" aria-label="Chart legend">
            <span><i class="bar-legend-swatch is-spending" aria-hidden="true"></i>Spending</span>
            <span><i class="bar-legend-swatch is-income" aria-hidden="true"></i>Income</span>
          </div>
        </div>
        <div class="chart-scroll"><svg id="monthly-spending-chart" class="dashboard-chart" role="img" aria-labelledby="monthly-spending-title"></svg></div>
      </section>

      <section class="chart-card" aria-labelledby="category-trends-title">
        <div class="chart-heading">
          <div><p class="eyebrow">CATEGORY TRENDS</p><h2 id="category-trends-title">Spending by category</h2></div>
          <span class="chart-filter-hint">Select categories to compare</span>
        </div>
        <div id="category-filters" class="category-filters" aria-label="Displayed categories"></div>
        <div class="chart-scroll"><svg id="category-line-chart" class="dashboard-chart" role="img" aria-labelledby="category-trends-title"></svg></div>
      </section>

      <section class="chart-card" aria-labelledby="category-share-title">
        <div class="chart-heading pie-chart-heading">
          <div><p class="eyebrow">MONTHLY BREAKDOWN</p><h2 id="category-share-title">Category share</h2></div>
          <label class="month-select-label" for="pie-month-select"><span>Month</span><select id="pie-month-select" aria-controls="category-pie-chart"></select></label>
        </div>
        <div id="pie-chart-content" class="pie-chart-layout">
          <svg id="category-pie-chart" viewBox="0 0 320 320" role="img" aria-labelledby="category-share-title"></svg>
          <div id="pie-chart-legend" class="pie-chart-legend" aria-label="Category spending legend"></div>
        </div>
        <div id="pie-chart-empty" class="pie-chart-empty" hidden>No spending was recorded for this month.</div>
      </section>

      <section class="dashboard-export" aria-labelledby="dashboard-export-title">
        <div>
          <p class="eyebrow">REPORT</p>
          <h2 id="dashboard-export-title">Keep a copy of your financial overview</h2>
          <p>Includes current assets, income, spending, monthly cash flow, and the selected category trends.</p>
          <span id="dashboard-export-status" role="status" aria-live="polite"></span>
        </div>
        <button id="generate-dashboard-pdf" class="primary-button generate-pdf-button" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v5h5M10 15h4m-4 3h4" /></svg>
          <span>Generate PDF</span>
        </button>
      </section>
    </div>
  `,
  mount(panel, context) {
    const refreshButton = queryRequired<HTMLButtonElement>(panel, "#refresh-dashboard");
    const loading = queryRequired<HTMLElement>(panel, "#dashboard-loading");
    const errorMessage = queryRequired<HTMLElement>(panel, "#dashboard-error");
    const empty = queryRequired<HTMLElement>(panel, "#dashboard-empty");
    const content = queryRequired<HTMLElement>(panel, "#dashboard-content");
    const currentAssets = queryRequired<HTMLElement>(panel, "#dashboard-current-assets");
    const totalSpending = queryRequired<HTMLElement>(panel, "#dashboard-total-spending");
    const totalIncome = queryRequired<HTMLElement>(panel, "#dashboard-total-income");
    const monthlyChart = queryRequired<SVGSVGElement>(panel, "#monthly-spending-chart");
    const lineChart = queryRequired<SVGSVGElement>(panel, "#category-line-chart");
    const categoryFilters = queryRequired<HTMLElement>(panel, "#category-filters");
    const pieMonthSelect = queryRequired<HTMLSelectElement>(panel, "#pie-month-select");
    const pieChart = queryRequired<SVGSVGElement>(panel, "#category-pie-chart");
    const pieContent = queryRequired<HTMLElement>(panel, "#pie-chart-content");
    const pieLegend = queryRequired<HTMLElement>(panel, "#pie-chart-legend");
    const pieEmpty = queryRequired<HTMLElement>(panel, "#pie-chart-empty");
    const generatePdfButton = queryRequired<HTMLButtonElement>(panel, "#generate-dashboard-pdf");
    const exportStatus = queryRequired<HTMLElement>(panel, "#dashboard-export-status");

    const selectedCategories = new Set<string>();
    let currentData: DashboardData | null = null;
    let requestInFlight = false;
    let selectedPieMonth: string | null = null;

    function formatAxisAmount(amountCents: number) {
      return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(amountCents / 100);
    }

    function chartDimensions(svg: SVGSVGElement, itemCount: number) {
      const availableWidth = svg.parentElement?.clientWidth ?? 640;
      const width = Math.max(620, availableWidth, itemCount * 62 + 88);
      const height = 300;
      const margin = { top: 18, right: 20, bottom: 48, left: 64 };
      svg.style.width = `${width}px`;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      return { width, height, margin, plotWidth: width - margin.left - margin.right, plotHeight: height - margin.top - margin.bottom };
    }

    function drawChartGrid(svg: SVGSVGElement, maximum: number, dimensions: ReturnType<typeof chartDimensions>) {
      const { width, height, margin, plotWidth, plotHeight } = dimensions;
      svg.append(svgElement("rect", { x: margin.left, y: margin.top, width: plotWidth, height: plotHeight, class: "chart-frame" }));
      for (let tick = 0; tick <= 4; tick += 1) {
        const ratio = tick / 4;
        const y = margin.top + plotHeight - ratio * plotHeight;
        svg.append(svgElement("line", { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: "chart-grid-line" }));
        addSvgText(svg, formatAxisAmount(maximum * ratio), margin.left - 10, y + 4, "chart-axis-label", "end");
      }
      addSvgText(svg, "Amount", 16, margin.top + plotHeight / 2, "chart-axis-title", "middle")
        .setAttribute("transform", `rotate(-90 16 ${margin.top + plotHeight / 2})`);
      addSvgText(svg, "Month", margin.left + plotWidth / 2, height - 7, "chart-axis-title", "middle");
    }

    function renderMonthlyChart(data: DashboardData) {
      monthlyChart.replaceChildren();
      const description = svgElement("desc");
      description.textContent = "Grouped bars comparing spending and income for each imported month.";
      monthlyChart.append(description);
      const dimensions = chartDimensions(monthlyChart, data.monthly.length * 1.2);
      const { margin, plotWidth, plotHeight } = dimensions;
      const maximum = Math.max(...data.monthly.flatMap((item) => [item.spendingCents, item.incomeCents]), 1);
      drawChartGrid(monthlyChart, maximum, dimensions);
      const slotWidth = plotWidth / data.monthly.length;
      const groupWidth = Math.min(62, slotWidth * 0.76);
      const gap = Math.min(7, groupWidth * 0.12);
      const barWidth = (groupWidth - gap) / 2;
      data.monthly.forEach((item, index) => {
        const groupX = margin.left + slotWidth * index + (slotWidth - groupWidth) / 2;
        ([
          { label: "Spending", amountCents: item.spendingCents, className: "spending-bar" },
          { label: "Income", amountCents: item.incomeCents, className: "income-bar" },
        ] as const).forEach((series, seriesIndex) => {
          const barHeight = (series.amountCents / maximum) * plotHeight;
          const bar = svgElement("rect", { x: groupX + seriesIndex * (barWidth + gap), y: margin.top + plotHeight - barHeight, width: barWidth, height: Math.max(barHeight, 1), rx: 4, class: series.className, tabindex: 0 });
          const title = svgElement("title");
          title.textContent = `${series.label} · ${formatMonth(item.month)}: ${formatAmount(series.amountCents, null)}`;
          bar.append(title);
          monthlyChart.append(bar);
        });
        addSvgText(monthlyChart, formatMonth(item.month), margin.left + slotWidth * index + slotWidth / 2, margin.top + plotHeight + 23, "chart-axis-label", "middle");
      });
    }

    function renderLineChart(data: DashboardData) {
      lineChart.replaceChildren();
      const months = data.monthly.map((item) => item.month);
      const visibleSeries = data.categories.filter((series) => selectedCategories.has(series.category));
      const dimensions = chartDimensions(lineChart, months.length);
      const { margin, plotWidth, plotHeight } = dimensions;
      const valuesBySeries = visibleSeries.map((series) => {
        const byMonth = new Map(series.values.map((value) => [value.month, value.amountCents]));
        return { series, values: months.map((month) => byMonth.get(month) ?? 0) };
      });
      const maximum = Math.max(...valuesBySeries.flatMap((item) => item.values), 1);
      drawChartGrid(lineChart, maximum, dimensions);
      if (visibleSeries.length === 0) {
        addSvgText(lineChart, "Select at least one category to display its trend.", margin.left + plotWidth / 2, margin.top + plotHeight / 2, "chart-empty-label", "middle");
      }
      const xForIndex = (index: number) => months.length === 1
        ? margin.left + plotWidth / 2
        : margin.left + (index / (months.length - 1)) * plotWidth;
      valuesBySeries.forEach(({ series, values }) => {
        const colorIndex = data.categories.findIndex((item) => item.category === series.category) % SERIES_CLASS_COUNT;
        const points = values.map((value, index) => ({ x: xForIndex(index), y: margin.top + plotHeight - (value / maximum) * plotHeight, value, month: months[index] }));
        lineChart.append(svgElement("path", { d: points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" "), class: `category-line series-${colorIndex}` }));
        points.forEach((point) => {
          const marker = svgElement("circle", { cx: point.x, cy: point.y, r: 4, class: `category-point series-${colorIndex}`, tabindex: 0 });
          const title = svgElement("title");
          title.textContent = `${titleCase(series.category)} · ${formatMonth(point.month)}: ${formatAmount(point.value, null)}`;
          marker.append(title);
          lineChart.append(marker);
        });
      });
      months.forEach((month, index) => addSvgText(lineChart, formatMonth(month), xForIndex(index), margin.top + plotHeight + 23, "chart-axis-label", "middle"));
    }

    function renderFilters(data: DashboardData) {
      categoryFilters.replaceChildren();
      data.categories.forEach((series, index) => {
        const label = document.createElement("label");
        label.className = "category-filter";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedCategories.has(series.category);
        checkbox.value = series.category;
        const swatch = document.createElement("span");
        swatch.className = `category-swatch series-${index % SERIES_CLASS_COUNT}`;
        const name = document.createElement("span");
        name.textContent = titleCase(series.category);
        label.append(checkbox, swatch, name);
        categoryFilters.append(label);
      });
    }

    function piePoint(center: number, radius: number, angle: number) {
      return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
    }

    function pieSlicePath(startAngle: number, endAngle: number) {
      const center = 160;
      const radius = 118;
      const start = piePoint(center, radius, startAngle);
      const end = piePoint(center, radius, endAngle);
      const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
      return `M ${center} ${center} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
    }

    function renderPieMonthOptions(data: DashboardData) {
      const months = data.monthly.map((item) => item.month);
      if (!selectedPieMonth || !months.includes(selectedPieMonth)) selectedPieMonth = months.at(-1) ?? null;
      pieMonthSelect.replaceChildren();
      months.forEach((month) => {
        const option = document.createElement("option");
        option.value = month;
        option.textContent = formatMonth(month);
        option.selected = month === selectedPieMonth;
        pieMonthSelect.append(option);
      });
    }

    function renderPieChart(data: DashboardData) {
      pieChart.replaceChildren();
      pieLegend.replaceChildren();
      if (!selectedPieMonth) {
        pieContent.hidden = true;
        pieEmpty.hidden = false;
        return;
      }
      const categories = data.categories
        .map((series, index) => ({ category: series.category, colorIndex: index % SERIES_CLASS_COUNT, amountCents: series.values.find((value) => value.month === selectedPieMonth)?.amountCents ?? 0 }))
        .filter((item) => item.amountCents > 0)
        .sort((left, right) => right.amountCents - left.amountCents);
      const totalCents = categories.reduce((sum, item) => sum + item.amountCents, 0);
      pieContent.hidden = totalCents === 0;
      pieEmpty.hidden = totalCents > 0;
      if (totalCents === 0) return;
      const description = svgElement("desc");
      description.textContent = `${formatMonth(selectedPieMonth)} category spending totaling ${formatAmount(totalCents, null)}.`;
      pieChart.append(description);
      let angle = -Math.PI / 2;
      categories.forEach((item) => {
        const ratio = item.amountCents / totalCents;
        const endAngle = angle + ratio * Math.PI * 2;
        const slice = categories.length === 1 ? svgElement("circle", { cx: 160, cy: 160, r: 118 }) : svgElement("path", { d: pieSlicePath(angle, endAngle) });
        slice.setAttribute("class", `pie-slice series-${item.colorIndex}`);
        slice.setAttribute("aria-label", `${titleCase(item.category)}: ${formatAmount(item.amountCents, null)}, ${(ratio * 100).toFixed(1)}%`);
        const title = svgElement("title");
        title.textContent = `${titleCase(item.category)} · ${formatAmount(item.amountCents, null)} · ${(ratio * 100).toFixed(1)}%`;
        slice.append(title);
        pieChart.append(slice);
        angle = endAngle;
        const legendItem = document.createElement("div");
        legendItem.className = "pie-legend-item";
        const swatch = document.createElement("span");
        swatch.className = `category-swatch series-${item.colorIndex}`;
        const label = document.createElement("span");
        label.className = "pie-legend-label";
        label.textContent = titleCase(item.category);
        const value = document.createElement("strong");
        value.textContent = formatAmount(item.amountCents, null);
        const percentage = document.createElement("span");
        percentage.className = "pie-legend-percentage";
        percentage.textContent = `${(ratio * 100).toFixed(1)}%`;
        legendItem.append(swatch, label, value, percentage);
        pieLegend.append(legendItem);
      });
    }

    function render(data: DashboardData) {
      const hadData = currentData !== null;
      const availableCategories = new Set(data.categories.map((series) => series.category));
      if (!hadData) data.categories.forEach((series) => selectedCategories.add(series.category));
      else [...selectedCategories].forEach((category) => { if (!availableCategories.has(category)) selectedCategories.delete(category); });
      currentData = data;
      loading.hidden = true;
      errorMessage.hidden = true;
      const isEmpty = data.monthly.length === 0;
      empty.hidden = !isEmpty;
      content.hidden = isEmpty;
      if (isEmpty) return;
      totalSpending.textContent = formatAmount(data.totalSpendingCents, null);
      totalIncome.textContent = formatAmount(data.totalIncomeCents, null);
      currentAssets.textContent = formatAmount(data.currentAssetsCents, "SGD");
      renderFilters(data);
      renderMonthlyChart(data);
      renderLineChart(data);
      renderPieMonthOptions(data);
      renderPieChart(data);
    }

    async function load() {
      if (requestInFlight) return;
      requestInFlight = true;
      refreshButton.disabled = true;
      loading.hidden = false;
      errorMessage.hidden = true;
      try {
        render(await invoke<DashboardData>("get_dashboard_data"));
      } catch (error) {
        loading.hidden = true;
        content.hidden = true;
        empty.hidden = true;
        errorMessage.textContent = String(error);
        errorMessage.hidden = false;
      } finally {
        requestInFlight = false;
        refreshButton.disabled = false;
      }
    }

    refreshButton.addEventListener("click", () => void load());
    categoryFilters.addEventListener("change", (event) => {
      if (!(event.target instanceof HTMLInputElement) || !currentData) return;
      if (event.target.checked) selectedCategories.add(event.target.value);
      else selectedCategories.delete(event.target.value);
      renderLineChart(currentData);
    });
    pieMonthSelect.addEventListener("change", () => {
      if (!currentData) return;
      selectedPieMonth = pieMonthSelect.value;
      renderPieChart(currentData);
    });
    generatePdfButton.addEventListener("click", async () => {
      if (!currentData) return;
      const date = new Date();
      generatePdfButton.disabled = true;
      exportStatus.textContent = "Choose where to save the PDF…";
      try {
        const datePart = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
        const selectedPath = await save({ defaultPath: `financial-dashboard-${datePart}.pdf`, filters: [{ name: "PDF document", extensions: ["pdf"] }] });
        if (!selectedPath) {
          exportStatus.textContent = "";
          return;
        }
        const targetPath = selectedPath.toLowerCase().endsWith(".pdf") ? selectedPath : `${selectedPath}.pdf`;
        exportStatus.textContent = "Generating PDF…";
        const bytes = generateDashboardPdf(currentData, selectedCategories, date);
        await invoke("save_pdf_report", { path: targetPath, bytes: Array.from(bytes) });
        exportStatus.textContent = `Saved ${targetPath.split(/[\\/]/).at(-1)}`;
      } catch (failure) {
        exportStatus.textContent = `Could not generate PDF: ${String(failure)}`;
      } finally {
        generatePdfButton.disabled = false;
      }
    });
    context.events.addEventListener("statement-saved", () => {
      currentData = null;
      selectedCategories.clear();
    });
    const resizeObserver = new ResizeObserver(() => {
      if (!currentData || content.hidden) return;
      renderMonthlyChart(currentData);
      renderLineChart(currentData);
    });
    resizeObserver.observe(panel);

    return { onActivate: () => void load(), destroy: () => resizeObserver.disconnect() };
  },
};
