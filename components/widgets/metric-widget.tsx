import { TrendingUp } from "lucide-react";
import type { WidgetSpec } from "@/types";

export function MetricWidget({ widget }: { widget: WidgetSpec }) {
  const numericIndex = widget.columns.findIndex(
    (column) => column.dataType === "number",
  );
  const column = widget.columns[numericIndex];
  const value = widget.rows[0]?.cells[numericIndex] ?? "—";

  return (
    <div className="metric-body">
      <div className="metric-icon"><TrendingUp size={17} /></div>
      <div className="metric-value-row">
        <strong>{value}</strong>
        {column?.unit ? <span>{column.unit}</span> : null}
      </div>
      <p>{column?.label}</p>
      <small>{widget.summary}</small>
    </div>
  );
}
