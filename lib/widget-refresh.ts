import type { WidgetSpec } from "./widget-schema";

export type RefreshContext = {
  title: string;
  visualization: WidgetSpec["visualization"];
  columns: Array<{ label: string; dataType: WidgetSpec["columns"][number]["dataType"]; unit: string | null }>;
  method: NonNullable<WidgetSpec["dataQuality"]>["method"] | "unknown";
  sourceName: string;
  coverageEnd: string | null;
  sourceHosts: string[];
};

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildRefreshContext(widget: WidgetSpec): RefreshContext {
  return {
    title: widget.title.slice(0, 120),
    visualization: widget.visualization,
    columns: widget.columns.map((column) => ({
      label: column.label.slice(0, 80),
      dataType: column.dataType,
      unit: column.unit?.slice(0, 40) ?? null,
    })),
    method: widget.dataQuality?.method ?? "unknown",
    sourceName: (widget.dataQuality?.sourceName ?? "").slice(0, 120),
    coverageEnd: widget.dataQuality?.coverageEnd ?? null,
    sourceHosts: Array.from(new Set(widget.sources.map((source) => sourceHost(source.url)).filter(Boolean))).slice(0, 5),
  };
}

export function parseRefreshContext(value: unknown): RefreshContext | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RefreshContext>;
  if (
    typeof candidate.title !== "string"
    || !["table", "line_chart", "bar_chart", "metric"].includes(candidate.visualization ?? "")
    || !Array.isArray(candidate.columns)
    || candidate.columns.length < 1
    || candidate.columns.length > 6
  ) return null;
  const columns = candidate.columns.flatMap((column) => {
    if (!column || typeof column !== "object") return [];
    if (typeof column.label !== "string" || !["string", "number", "date"].includes(column.dataType)) return [];
    return [{
      label: column.label.slice(0, 80),
      dataType: column.dataType,
      unit: typeof column.unit === "string" ? column.unit.slice(0, 40) : null,
    }];
  });
  if (columns.length !== candidate.columns.length) return null;
  const method = ["official_connector", "web_search", "user_data", "unknown"].includes(candidate.method ?? "")
    ? candidate.method as RefreshContext["method"]
    : "unknown";
  return {
    title: candidate.title.slice(0, 120),
    visualization: candidate.visualization as RefreshContext["visualization"],
    columns,
    method,
    sourceName: typeof candidate.sourceName === "string" ? candidate.sourceName.slice(0, 120) : "",
    coverageEnd: typeof candidate.coverageEnd === "string" ? candidate.coverageEnd.slice(0, 40) : null,
    sourceHosts: Array.isArray(candidate.sourceHosts)
      ? candidate.sourceHosts.flatMap((host) => typeof host === "string" ? [host.toLowerCase().slice(0, 120)] : []).slice(0, 5)
      : [],
  };
}

export function widgetDataFingerprint(widget: WidgetSpec) {
  return JSON.stringify({
    columns: widget.columns.map((column) => ({
      label: normalizeIdentity(column.label),
      dataType: column.dataType,
      unit: normalizeIdentity(column.unit),
    })),
    rows: widget.rows.map((row) => row.cells.map((cell) => cell.trim())),
  });
}

export function validateRefreshCandidate(existing: WidgetSpec, candidate: WidgetSpec) {
  if (candidate.visualization !== existing.visualization) {
    return { compatible: false, reason: "Visualization type changed, so the existing widget was preserved." } as const;
  }
  if (candidate.columns.length !== existing.columns.length) {
    return { compatible: false, reason: "Column count changed, so the existing widget was preserved." } as const;
  }
  const columnsMatch = existing.columns.every((column, index) => {
    const next = candidate.columns[index];
    return next
      && column.dataType === next.dataType
      && normalizeIdentity(column.label) === normalizeIdentity(next.label)
      && normalizeIdentity(column.unit) === normalizeIdentity(next.unit);
  });
  if (!columnsMatch) {
    return { compatible: false, reason: "Metric, unit, or column identity changed, so the existing widget was preserved." } as const;
  }
  if (existing.dataQuality?.method === "official_connector") {
    if (candidate.dataQuality?.method !== "official_connector"
      || normalizeIdentity(existing.dataQuality.sourceName) !== normalizeIdentity(candidate.dataQuality.sourceName)) {
      return { compatible: false, reason: "The refresh switched away from the original official source, so the existing widget was preserved." } as const;
    }
  }
  if (existing.dataQuality?.method === "web_search") {
    if (candidate.dataQuality?.method !== "web_search") {
      return { compatible: false, reason: "The refresh switched away from the original Web Search data route, so the existing widget was preserved." } as const;
    }
    const existingHosts = new Set(existing.sources.map((source) => sourceHost(source.url)).filter(Boolean));
    const candidateHosts = new Set(candidate.sources.map((source) => sourceHost(source.url)).filter(Boolean));
    if (existingHosts.size && candidateHosts.size
      && !Array.from(existingHosts).some((host) => candidateHosts.has(host))) {
      return { compatible: false, reason: "The refreshed sources did not overlap the original publisher domains, so the existing widget was preserved." } as const;
    }
  }
  if (existing.dataQuality?.coverageEnd && candidate.dataQuality?.coverageEnd
    && candidate.dataQuality.coverageEnd < existing.dataQuality.coverageEnd) {
    return { compatible: false, reason: "The refreshed coverage ended earlier than the existing data, so the existing widget was preserved." } as const;
  }
  return {
    compatible: true,
    changed: widgetDataFingerprint(existing) !== widgetDataFingerprint(candidate),
  } as const;
}
