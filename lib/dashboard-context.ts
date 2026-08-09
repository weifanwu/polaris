import type { WidgetSpec } from "./widget-schema";
import type { UserDataset } from "./user-dataset";

export const MAX_DASHBOARD_CONTEXT_CHARS = 4_200;
const BASE_CONTEXT_CHARS = 1_400;
const DASHBOARD_REFERENCE = /(?:dashboard|widget|chart|table|graph|dataset|these|those|above|existing|current dashboard|redraw|replot|same data|this data|仪表板|组件|图表|表格|数据集|这些|那些|这个|这份|该数据|上面|已有|现有|刚才|之前|重新画|重画|补齐|推测|目前的图)/i;
const DATASET_REFERENCE = /(?:this|that|same|attached|above|previous|dashboard).{0,18}(?:data|dataset|chart|table)|(?:redraw|replot)|(?:这个|这份|该|刚才|上面|之前|已有|现有).{0,18}(?:数据|数据集|图|表)|(?:重新画|重画|补齐|补全|推测).{0,18}(?:数据|缺失|图|表)/i;
const IDENTITY_SIGNALS = [
  /(?:美国|united states|\bu\.?s\.?\b)/i,
  /(?:加拿大|canada)/i,
  /(?:安大略|ontario)/i,
  /(?:多伦多|toronto|gta|trreb)/i,
  /(?:渥太华|ottawa|oreb)/i,
  /(?:失业率|unemployment)/i,
  /(?:就业|employment)/i,
  /(?:通胀|cpi|inflation)/i,
  /(?:房价|housing|home price)/i,
  /(?:黄金|金价|gold)/i,
  /(?:gdp|国内生产总值)/i,
];

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
  return `[${clean(widget.id, 40)}] ${clean(widget.title, 80)} | ${widget.visualization} | ${widget.rows.length} rows | coverage ${quality?.coverageStart ?? "?"}→${quality?.coverageEnd ?? "?"}${quality?.unverifiedPoints ? ` | ${quality.unverifiedPoints} unverified hypothesis points` : ""} | columns: ${columns} | source: ${clean(quality?.sourceName ?? widget.sources[0]?.title ?? "unknown", 70)} | request: ${clean(widget.originalQuery, 100)}`;
}

export function queryReferencesDashboard(query: string) {
  return DASHBOARD_REFERENCE.test(query);
}

export function queryReferencesDataset(query: string) {
  return DATASET_REFERENCE.test(query);
}

function csvCell(value: string) {
  const sanitized = value.replace(/[\r\n]+/g, " ");
  return /[",]/.test(sanitized) ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
}

function widgetAsCsv(widget: WidgetSpec) {
  const header = widget.columns.map((column) => csvCell(column.label)).join(",");
  const rows = widget.rows.map((row) => row.cells.map((cell, index) =>
    csvCell(row.cellStatus?.[index] === "unverified" ? "" : cell),
  ).join(","));
  return [header, ...rows].join("\n");
}

export function buildReferencedWidgetDataset(widgets: WidgetSpec[], query: string): UserDataset | null {
  if (!queryReferencesDataset(query)) return null;
  const candidates = [...widgets].reverse();
  const queryTerms = query.toLowerCase().match(/[a-z]{3,}|[\u3400-\u9fff]{2,}/g) ?? [];
  const selected = candidates
    .map((widget, recency) => {
      const identity = `${widget.title} ${widget.subtitle} ${widget.originalQuery}`.toLowerCase();
      const overlap = queryTerms.filter((term) => identity.includes(term)).length;
      const signalOverlap = IDENTITY_SIGNALS.filter((signal) => signal.test(query) && signal.test(identity)).length;
      const userDataPreference = widget.dataQuality?.method === "user_data" && /(?:paste|pasted|attach|upload|自己|粘贴|上传)/i.test(query) ? 5 : 0;
      return { widget, score: overlap * 10 + signalOverlap * 8 + userDataPreference - recency };
    })
    .sort((left, right) => right.score - left.score)[0]?.widget;
  if (!selected) return null;
  const content = widgetAsCsv(selected);
  return {
    name: `Dashboard · ${selected.title}`.slice(0, 120),
    format: "csv",
    content,
    origin: "dashboard",
  };
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
