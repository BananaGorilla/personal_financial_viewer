const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export function queryRequired<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required UI element: ${selector}`);
  return element;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function titleCase(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatAmount(amountCents: number, currency: string | null) {
  const amount = amountCents / 100;

  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
    } catch {
      // Fall through when the extracted currency is not a valid ISO currency code.
    }
  }

  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatMonth(month: string) {
  const parsed = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(parsed.valueOf())
    ? month
    : new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }).format(parsed);
}

export function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  Object.entries(attributes).forEach(([attribute, value]) => element.setAttribute(attribute, String(value)));
  return element;
}

export function addSvgText(
  svg: SVGSVGElement,
  text: string,
  x: number,
  y: number,
  className: string,
  anchor: "start" | "middle" | "end" = "start",
) {
  const label = svgElement("text", { x, y, class: className, "text-anchor": anchor });
  label.textContent = text;
  svg.append(label);
  return label;
}
