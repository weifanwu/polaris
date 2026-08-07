import type { WidgetSpec } from "@/types";

export function toChartData(widget: WidgetSpec) {
  return widget.rows.map((row) => {
    const point: Record<string, string | number> = {};
    widget.columns.forEach((column, index) => {
      const value = row.cells[index] ?? "";
      point[column.key] =
        column.dataType === "number" ? Number(value.replace(/,/g, "")) : value;
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
