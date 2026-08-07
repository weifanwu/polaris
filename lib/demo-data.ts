import type { DashboardWidget } from "@/types";

const generatedAt = "2026-08-06T16:00:00.000Z";

export const demoWidgets: DashboardWidget[] = [
  {
    id: "demo-msft",
    title: "Microsoft · 7 day close",
    subtitle: "Demo data · illustrative values only",
    visualization: "line_chart",
    columns: [
      { key: "date", label: "Date", dataType: "date", unit: null },
      { key: "close", label: "Close", dataType: "number", unit: "USD" },
    ],
    rows: [
      { cells: ["2026-07-28", "504.18"] },
      { cells: ["2026-07-29", "508.41"] },
      { cells: ["2026-07-30", "511.06"] },
      { cells: ["2026-07-31", "509.74"] },
      { cells: ["2026-08-03", "515.29"] },
      { cells: ["2026-08-04", "518.62"] },
      { cells: ["2026-08-05", "521.14"] },
    ],
    summary: "A local sample series for checking chart interactions.",
    originalQuery: "显示微软最近 7 个交易日的收盘价",
    sources: [],
    generatedAt,
    isDemo: true,
  },
  {
    id: "demo-rates",
    title: "Bank of Canada policy rate",
    subtitle: "Demo data · illustrative values only",
    visualization: "bar_chart",
    columns: [
      { key: "date", label: "Decision", dataType: "date", unit: null },
      { key: "rate", label: "Rate", dataType: "number", unit: "%" },
    ],
    rows: [
      { cells: ["2025-09", "2.75"] },
      { cells: ["2025-12", "2.50"] },
      { cells: ["2026-03", "2.50"] },
      { cells: ["2026-06", "2.25"] },
    ],
    summary: "A local sample for checking categorical comparisons.",
    originalQuery: "显示加拿大央行最近一年的政策利率变化",
    sources: [],
    generatedAt,
    isDemo: true,
  },
  {
    id: "demo-gold",
    title: "Gold spot price",
    subtitle: "Demo data · illustrative values only",
    visualization: "metric",
    columns: [
      { key: "price", label: "Gold", dataType: "number", unit: "USD/oz" },
    ],
    rows: [{ cells: ["2384.70"] }],
    summary: "A local metric card for checking compact widgets.",
    originalQuery: "比较今天黄金和白银的价格",
    sources: [],
    generatedAt,
    isDemo: true,
  },
];
