"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WidgetSpec } from "@/types";
import { formatAxis, toChartData } from "./chart-data";

const colors = ["#22d3ee", "#8b5cf6", "#f59e0b", "#10b981", "#fb7185"];

export function BarWidget({ widget }: { widget: WidgetSpec }) {
  const xKey = widget.columns[0]?.key;
  const series = widget.columns.filter((column) => column.dataType === "number");

  return (
    <div className="chart-area">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={toChartData(widget)} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#25303a" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey={xKey} stroke="#71808e" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="#71808e" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatAxis} width={48} />
          <Tooltip contentStyle={{ background: "#11171d", border: "1px solid #2a3741", borderRadius: 10 }} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
          {series.map((column, index) => (
            <Bar
              key={column.key}
              dataKey={column.key}
              name={column.unit ? `${column.label} (${column.unit})` : column.label}
              fill={colors[index % colors.length]}
              radius={[5, 5, 1, 1]}
              maxBarSize={48}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
