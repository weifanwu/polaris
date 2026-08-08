"use client";

import { lazy, Suspense } from "react";
import type { WidgetSpec } from "@/types";

const LazyEChartsWidget = lazy(() =>
  import("./echarts-widget").then((module) => ({ default: module.EChartsWidget })),
);

export function InteractiveChart({ widget, type }: { widget: WidgetSpec; type: "line" | "bar" }) {
  return (
    <Suspense fallback={<div className="chart-area chart-loading">Compiling chart…</div>}>
      <LazyEChartsWidget widget={widget} type={type} />
    </Suspense>
  );
}
