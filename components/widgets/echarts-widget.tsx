"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import type { WidgetSpec } from "@/types";
import { formatAxis, toChartData } from "./chart-data";

echarts.use([
  AriaComponent,
  BarChart,
  CanvasRenderer,
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  LineChart,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
]);

const COLORS = ["#38d9ef", "#a78bfa", "#f6b94b", "#46d6a6", "#fb7185"];

function valueLabel(value: unknown, unit: string | null) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "No data";
  const formatted = Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(numeric);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function EChartsWidget({ widget, type }: { widget: WidgetSpec; type: "line" | "bar" }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const data = useMemo(() => toChartData(widget), [widget]);
  const xKey = widget.columns[0]?.key;
  const numericColumns = useMemo(
    () => widget.columns.filter((column) => column.dataType === "number"),
    [widget.columns],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !xKey || !numericColumns.length) return;

    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    const hasZoom = data.length > 16;
    const option: EChartsCoreOption = {
      animationDuration: 450,
      animationEasing: "cubicOut",
      aria: {
        enabled: true,
        description: `${widget.title}. ${widget.summary}`,
        decal: { show: true },
      },
      backgroundColor: "transparent",
      color: COLORS,
      dataset: {
        dimensions: widget.columns.map((column) => column.key),
        source: data,
      },
      grid: {
        top: numericColumns.length > 1 ? 34 : 16,
        right: 22,
        bottom: hasZoom ? 56 : 28,
        left: 14,
        containLabel: true,
      },
      legend: numericColumns.length > 1 ? {
        top: 0,
        icon: "roundRect",
        itemWidth: 17,
        itemHeight: 3,
        textStyle: { color: "#9aaab3", fontSize: 10 },
      } : undefined,
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "rgba(11, 17, 22, .96)",
        borderColor: "#32414c",
        borderWidth: 1,
        padding: [9, 11],
        textStyle: { color: "#e8f0f3", fontSize: 11 },
        axisPointer: { type: "cross", lineStyle: { color: "#526774", type: "dashed" } },
      },
      xAxis: {
        type: "category",
        boundaryGap: type === "bar",
        axisLine: { lineStyle: { color: "#2a3640" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#71818c",
          fontSize: 10,
          hideOverlap: true,
          interval: Math.max(0, Math.ceil(data.length / 8) - 1),
        },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: "#71818c", fontSize: 10, formatter: (value: number) => formatAxis(value) },
        splitLine: { lineStyle: { color: "#202b33", type: "dashed" } },
      },
      dataZoom: hasZoom ? [
        { type: "inside", start: Math.max(0, 100 - (16 / data.length) * 100), end: 100 },
        {
          type: "slider",
          height: 16,
          bottom: 6,
          start: Math.max(0, 100 - (16 / data.length) * 100),
          end: 100,
          borderColor: "transparent",
          backgroundColor: "#111920",
          fillerColor: "rgba(56, 217, 239, .16)",
          dataBackground: { lineStyle: { color: "#3e515d" }, areaStyle: { color: "#26343d" } },
          handleStyle: { color: "#6bd9e9", borderColor: "#0d1419" },
          textStyle: { color: "#71818c", fontSize: 8 },
        },
      ] : undefined,
      series: numericColumns.map((column, index) => ({
        type,
        name: column.unit ? `${column.label} (${column.unit})` : column.label,
        encode: { x: xKey, y: column.key, tooltip: [column.key] },
        connectNulls: false,
        showSymbol: type === "line" && data.length <= 30,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: type === "line" ? { width: 2.4, color: COLORS[index % COLORS.length] } : undefined,
        itemStyle: { color: COLORS[index % COLORS.length], borderRadius: type === "bar" ? [3, 3, 0, 0] : undefined },
        emphasis: { focus: "series" },
        valueFormatter: (value: unknown) => valueLabel(value, column.unit),
        markPoint: type === "line" ? {
          symbolSize: 32,
          label: { color: "#071013", fontSize: 8, formatter: "{b}" },
          data: [
            { type: "max", name: "High" },
            { type: "min", name: "Low" },
          ],
        } : undefined,
        markLine: type === "line" ? {
          silent: true,
          symbol: ["none", "none"],
          label: { color: "#71818c", fontSize: 8, formatter: "Avg {c}" },
          lineStyle: { color: COLORS[index % COLORS.length], opacity: 0.34, type: "dashed" },
          data: [{ type: "average", name: "Average" }],
        } : undefined,
      })),
    };

    chart.setOption(option, true);
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [data, numericColumns, type, widget.columns, widget.summary, widget.title, xKey]);

  return <div ref={containerRef} className="chart-area echarts-canvas" role="img" aria-label={widget.title} />;
}
