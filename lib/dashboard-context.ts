import type { WidgetSpec } from "./widget-schema";

export const MAX_DASHBOARD_CONTEXT_CHARS = 4_200;
const BASE_CONTEXT_CHARS = 1_400;
const DASHBOARD_REFERENCE = /(?:dashboard|widget|chart|table|graph|these|those|above|existing|current dashboard|仪表板|组件|图表|表格|这些|那些|上面|已有|现有|刚才|之前|目前的图)/i;

function clean(value: string | null | undefined, limit: number) {
  return (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, limit);
}

function rowPreview(widget: WidgetSpec, row: WidgetSpec["rows"][number] | undefined) {
  if (!row) return "";
  return row.cells.map((cell, index) => `${clean(widget.columns[index]?.label, 28)}=${clean(cell, 45)}`)
    .join(", ")
    .slice(0, 240);
}

function compactWidgetLine(widget: WidgetSpec) {
  const quality = widget.dataQuality;
  const columns = widget.columns.map((column) => `${clean(column.label, 32)}${column.unit ? ` (${clean(column.unit, 18)})` : ""}`)
    .join(", ")
    .slice(0, 220);
  return `[${clean(widget.id, 40)}] ${clean(widget.title, 80)} | ${widget.visualization} | ${widget.rows.length} rows | coverage ${quality?.coverageStart ?? "?"}→${quality?.coverageEnd ?? "?"} | columns: ${columns} | source: ${clean(quality?.sourceName ?? widget.sources[0]?.title ?? "unknown", 70)} | request: ${clean(widget.originalQuery, 100)}`;
}

export function queryReferencesDashboard(query: string) {
  return DASHBOARD_REFERENCE.test(query);
}

export function buildDashboardContext(widgets: WidgetSpec[], query: string) {
  if (!widgets.length) return "";
  const expanded = queryReferencesDashboard(query);
  const budget = expanded ? MAX_DASHBOARD_CONTEXT_CHARS : BASE_CONTEXT_CHARS;
  const lines = [
    `Dashboard snapshot: ${widgets.length} widget${widgets.length === 1 ? "" : "s"}. ${expanded ? "Compact metadata plus boundary observations; no full raw tables." : "Metadata index only; no raw rows."}`,
  ];

  for (const widget of widgets) {
    const base = compactWidgetLine(widget);
    const details = expanded
      ? ` | summary: ${clean(widget.summary, 180)} | first: ${rowPreview(widget, widget.rows[0])} | latest: ${rowPreview(widget, widget.rows.at(-1))}`
      : "";
    const minimum = `[${clean(widget.id, 40)}] ${clean(widget.title, 80)} | ${widget.rows.length} rows | ${widget.dataQuality?.coverageEnd ?? "coverage unknown"}`;
    const candidate = `${base}${details}`;
    const remainingWidgets = widgets.length - (lines.length - 1) - 1;
    const reserve = Math.max(0, remainingWidgets * 90);
    const available = budget - lines.join("\n").length - reserve - 1;
    lines.push(available >= candidate.length ? candidate : minimum.slice(0, Math.max(80, available)));
  }

  const context = lines.join("\n");
  return context.length <= budget ? context : `${context.slice(0, budget - 20)}\n[context bounded]`;
}

export function parseDashboardContext(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, MAX_DASHBOARD_CONTEXT_CHARS) : "";
}
