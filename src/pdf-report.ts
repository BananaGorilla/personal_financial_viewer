type MonthlyAmount = {
  month: string;
  spendingCents: number;
  incomeCents: number;
};

type CategorySeries = {
  category: string;
  values: { month: string; amountCents: number }[];
};

export type DashboardReportData = {
  currentAssetsCents: number;
  totalSpendingCents: number;
  totalIncomeCents: number;
  monthly: MonthlyAmount[];
  categories: CategorySeries[];
};

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const PALETTE = ["#4f7fe5", "#2eb67d", "#e78a42", "#9a6bd4", "#e85d7b", "#32a7bc", "#b5a228", "#74839b"];

function rgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function number(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function pdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/([\\()])/g, "\\$1");
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortLabel(value: string, limit = 24) {
  const label = titleCase(value);
  return label.length > limit ? `${label.slice(0, limit - 3)}...` : label;
}

function formatCurrency(cents: number) {
  return `SGD ${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCompact(cents: number) {
  const amount = cents / 100;
  if (Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(amount) >= 1_000) return `${(amount / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return amount.toFixed(0);
}

function formatMonth(month: string, short = false) {
  const [year, rawMonth] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const name = names[Number(rawMonth) - 1] ?? rawMonth;
  return short ? `${name} ${year.slice(-2)}` : `${name} ${year}`;
}

class PdfPage {
  private commands: string[] = [];

  fillRect(x: number, y: number, width: number, height: number, color: string) {
    const [red, green, blue] = rgb(color);
    this.commands.push(`${number(red)} ${number(green)} ${number(blue)} rg ${number(x)} ${number(PAGE_HEIGHT - y - height)} ${number(width)} ${number(height)} re f`);
  }

  strokeLine(x1: number, y1: number, x2: number, y2: number, color: string, width = 1) {
    const [red, green, blue] = rgb(color);
    this.commands.push(`${number(red)} ${number(green)} ${number(blue)} RG ${number(width)} w ${number(x1)} ${number(PAGE_HEIGHT - y1)} m ${number(x2)} ${number(PAGE_HEIGHT - y2)} l S`);
  }

  circle(x: number, y: number, radius: number, color: string) {
    const c = radius * 0.5522848;
    const [red, green, blue] = rgb(color);
    const py = PAGE_HEIGHT - y;
    this.commands.push(`${number(red)} ${number(green)} ${number(blue)} rg ${number(x + radius)} ${number(py)} m ${number(x + radius)} ${number(py + c)} ${number(x + c)} ${number(py + radius)} ${number(x)} ${number(py + radius)} c ${number(x - c)} ${number(py + radius)} ${number(x - radius)} ${number(py + c)} ${number(x - radius)} ${number(py)} c ${number(x - radius)} ${number(py - c)} ${number(x - c)} ${number(py - radius)} ${number(x)} ${number(py - radius)} c ${number(x + c)} ${number(py - radius)} ${number(x + radius)} ${number(py - c)} ${number(x + radius)} ${number(py)} c f`);
  }

  polyline(points: { x: number; y: number }[], color: string, width = 1.5) {
    if (points.length < 2) return;
    const [red, green, blue] = rgb(color);
    const path = points.map((point, index) => `${number(point.x)} ${number(PAGE_HEIGHT - point.y)} ${index === 0 ? "m" : "l"}`).join(" ");
    this.commands.push(`${number(red)} ${number(green)} ${number(blue)} RG ${number(width)} w 1 J 1 j ${path} S`);
  }

  text(value: string, x: number, y: number, size: number, color = "#172033", bold = false) {
    const [red, green, blue] = rgb(color);
    this.commands.push(`BT /${bold ? "F2" : "F1"} ${number(size)} Tf ${number(red)} ${number(green)} ${number(blue)} rg ${number(x)} ${number(PAGE_HEIGHT - y)} Td (${pdfText(value)}) Tj ET`);
  }

  stream() {
    return this.commands.join("\n");
  }
}

function drawHeader(page: PdfPage, title: string, subtitle: string, generatedAt: Date, pageNumber: number) {
  page.fillRect(0, 0, PAGE_WIDTH, 8, "#4f7fe5");
  page.text("PERSONAL FINANCE VIEWER", 42, 34, 8, "#4f7fe5", true);
  page.text(title, 42, 60, 23, "#172033", true);
  page.text(subtitle, 42, 79, 9, "#647087");
  page.text(`Generated ${generatedAt.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}`, 650, 34, 8, "#647087");
  page.text(`Page ${pageNumber} of 2`, 756, 573, 8, "#7a8598");
}

function drawMetric(page: PdfPage, x: number, label: string, value: string, color: string) {
  page.fillRect(x, 103, 238, 69, "#f3f6fb");
  page.fillRect(x, 103, 4, 69, color);
  page.text(label.toUpperCase(), x + 17, 123, 8, "#69758a", true);
  const size = value.length > 19 ? 16 : value.length > 15 ? 18 : 21;
  page.text(value, x + 17, 153, size, "#172033", true);
}

function drawChartFrame(page: PdfPage, title: string, x: number, y: number, width: number, height: number) {
  page.text(title, x, y - 17, 12, "#172033", true);
  page.fillRect(x, y, width, height, "#fbfcfe");
  page.strokeLine(x, y + height, x + width, y + height, "#cfd7e5");
  page.strokeLine(x, y, x, y + height, "#cfd7e5");
}

function drawGrid(page: PdfPage, x: number, y: number, width: number, height: number, maximum: number) {
  for (let tick = 0; tick <= 4; tick += 1) {
    const lineY = y + height - (tick / 4) * height;
    page.strokeLine(x, lineY, x + width, lineY, "#e4e9f1", 0.7);
    page.text(formatCompact(maximum * tick / 4), x - 33, lineY + 3, 7, "#7a8598");
  }
}

function drawMonthlyChart(page: PdfPage, data: DashboardReportData) {
  const frame = { x: 76, y: 225, width: 708, height: 278 };
  drawChartFrame(page, "Monthly cash flow", frame.x, frame.y, frame.width, frame.height);
  page.fillRect(611, 188, 8, 8, "#4f7fe5");
  page.text("Spending", 624, 196, 8, "#647087");
  page.fillRect(690, 188, 8, 8, "#2eb67d");
  page.text("Income", 703, 196, 8, "#647087");
  const maximum = Math.max(1, ...data.monthly.flatMap((item) => [item.spendingCents, item.incomeCents]));
  drawGrid(page, frame.x, frame.y, frame.width, frame.height, maximum);
  const slot = frame.width / Math.max(data.monthly.length, 1);
  const groupWidth = Math.min(34, slot * 0.72);
  const barWidth = Math.max(2, (groupWidth - 3) / 2);
  const labelEvery = Math.max(1, Math.ceil(data.monthly.length / 12));
  data.monthly.forEach((item, index) => {
    const baseX = frame.x + slot * index + (slot - groupWidth) / 2;
    const spendingHeight = item.spendingCents / maximum * frame.height;
    const incomeHeight = item.incomeCents / maximum * frame.height;
    page.fillRect(baseX, frame.y + frame.height - spendingHeight, barWidth, spendingHeight, "#4f7fe5");
    page.fillRect(baseX + barWidth + 3, frame.y + frame.height - incomeHeight, barWidth, incomeHeight, "#2eb67d");
    if (index % labelEvery === 0 || index === data.monthly.length - 1) {
      page.text(formatMonth(item.month, true), frame.x + slot * index + slot / 2 - 13, frame.y + frame.height + 16, 7, "#6f7a8e");
    }
  });
}

function drawCategoryChart(page: PdfPage, data: DashboardReportData, selectedCategories: Set<string>) {
  const visible = data.categories.filter((series) => selectedCategories.has(series.category));
  const months = data.monthly.map((item) => item.month);
  const legendRows = Math.max(1, Math.ceil(visible.length / 4));
  const chartTop = Math.min(184, 128 + legendRows * 18);
  const frame = { x: 76, y: chartTop, width: 708, height: 490 - chartTop };
  let legendX = 76;
  let legendY = 116;
  visible.forEach((series, index) => {
    if (index > 0 && index % 4 === 0) {
      legendX = 76;
      legendY += 18;
    }
    const colorIndex = data.categories.findIndex((candidate) => candidate.category === series.category) % PALETTE.length;
    page.fillRect(legendX, legendY - 7, 8, 8, PALETTE[colorIndex]);
    page.text(shortLabel(series.category, 20), legendX + 13, legendY, 7.5, "#556176");
    legendX += 177;
  });
  drawChartFrame(page, "Category spending trends", frame.x, frame.y, frame.width, frame.height);
  const seriesValues = visible.map((series) => {
    const byMonth = new Map(series.values.map((value) => [value.month, value.amountCents]));
    return { series, values: months.map((month) => byMonth.get(month) ?? 0) };
  });
  const maximum = Math.max(1, ...seriesValues.flatMap((item) => item.values));
  drawGrid(page, frame.x, frame.y, frame.width, frame.height, maximum);
  if (visible.length === 0) {
    page.text("No categories were selected when this report was generated.", 255, frame.y + frame.height / 2, 11, "#7a8598");
    return;
  }
  const xForIndex = (index: number) => months.length <= 1 ? frame.x + frame.width / 2 : frame.x + index / (months.length - 1) * frame.width;
  seriesValues.forEach(({ series, values }) => {
    const colorIndex = data.categories.findIndex((candidate) => candidate.category === series.category) % PALETTE.length;
    const points = values.map((value, index) => ({ x: xForIndex(index), y: frame.y + frame.height - value / maximum * frame.height }));
    page.polyline(points, PALETTE[colorIndex], 1.6);
    points.forEach((point) => page.circle(point.x, point.y, 2.3, PALETTE[colorIndex]));
  });
  const labelEvery = Math.max(1, Math.ceil(months.length / 12));
  months.forEach((month, index) => {
    if (index % labelEvery === 0 || index === months.length - 1) page.text(formatMonth(month, true), xForIndex(index) - 13, frame.y + frame.height + 16, 7, "#6f7a8e");
  });
}

function assemblePdf(pages: PdfPage[]) {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  const pageIds: number[] = [];
  pages.forEach((page) => {
    const stream = page.stream();
    const contentId = objects.length + 1;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = objects.length + 1;
    pageIds.push(pageId);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
  });
  objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

  let output = "%PDF-1.4\n%PFVREPORT\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}

export function generateDashboardPdf(data: DashboardReportData, selectedCategories: Set<string>, generatedAt = new Date()) {
  const overview = new PdfPage();
  drawHeader(overview, "Financial dashboard report", "Assets, income, spending, and monthly cash flow", generatedAt, 1);
  drawMetric(overview, 42, "Current assets", formatCurrency(data.currentAssetsCents), "#4f7fe5");
  drawMetric(overview, 302, "Total income", formatCurrency(data.totalIncomeCents), "#2eb67d");
  drawMetric(overview, 562, "Total spending", formatCurrency(data.totalSpendingCents), "#e78a42");
  drawMonthlyChart(overview, data);

  const categories = new PdfPage();
  drawHeader(categories, "Category trends", "Monthly spending for the categories selected on the dashboard", generatedAt, 2);
  drawCategoryChart(categories, data, selectedCategories);
  return assemblePdf([overview, categories]);
}
