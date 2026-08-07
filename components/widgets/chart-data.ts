import type { WidgetSpec } from "@/types";

export function toChartData(widget: WidgetSpec) {
  return widget.rows.map((row) => {
    const point: Record<string, string | number | null> = {};
    widget.columns.forEach((column, index) => {
      const value = row.cells[index] ?? "";
      if (column.dataType !== "number") {
        point[column.key] = value;
        return;
      }

      const normalized = value.replace(/,/g, "").trim();
      const numeric = normalized ? Number(normalized) : Number.NaN;
      point[column.key] = Number.isFinite(numeric) ? numeric : null;
    });
    return point;
  });
}

export function formatAxis(value: number) {
  return Intl.NumberFormat("en", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
}
