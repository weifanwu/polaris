import assert from "node:assert/strict";
import {
  inferPartialDataPolicy,
  inferResearchMode,
  parseConversationContext,
  parseConversationHistory,
} from "../lib/agent-policy";
import { toChartData } from "../components/widgets/chart-data";
import { generateWidgetResultSchema, widgetSpecSchema } from "../lib/widget-schema";

const valid = {
  id: "test-widget",
  title: "Test series",
  subtitle: "A valid widget",
  visualization: "line_chart",
  columns: [
    { key: "date", label: "Date", dataType: "date", unit: null },
    { key: "value", label: "Value", dataType: "number", unit: "USD" },
  ],
  rows: [{ cells: ["2026-08-06", "42"] }],
  summary: "Schema fixture",
  originalQuery: "test",
  sources: [{ title: "Example", url: "https://example.com" }],
  generatedAt: "2026-08-06T12:00:00.000Z",
} as const;

assert.equal(widgetSpecSchema.safeParse(valid).success, true, "valid widget should pass");

assert.equal(
  widgetSpecSchema.safeParse({
    ...valid,
    columns: Array.from({ length: 7 }, (_, index) => ({
      key: `c${index}`,
      label: `Column ${index}`,
      dataType: "string",
      unit: null,
    })),
    rows: [{ cells: Array.from({ length: 7 }, () => "value") }],
  }).success,
  false,
  "more than 6 columns should fail",
);

assert.equal(
  widgetSpecSchema.safeParse({
    ...valid,
    rows: Array.from({ length: 31 }, () => ({ cells: ["2026-08-06", "42"] })),
  }).success,
  false,
  "more than 30 rows should fail",
);

assert.equal(
  widgetSpecSchema.safeParse({ ...valid, rows: [{ cells: ["2026-08-06"] }] }).success,
  false,
  "cell count must match column count",
);

assert.equal(
  generateWidgetResultSchema.safeParse({
    status: "needs_clarification",
    message: "Which geography?",
    widget: null,
    conversationContext: "Compare benchmark prices monthly",
    usage: {
      inputTokens: 120,
      cachedInputTokens: 80,
      outputTokens: 30,
      webSearchCalls: 0,
      modelCalls: 1,
    },
  }).success,
  true,
  "cost telemetry and compact context should pass",
);

const boundedHistory = parseConversationHistory(
  Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `turn-${index}-${"x".repeat(600)}`,
  })),
);
assert.equal(boundedHistory.length, 4, "only four fallback turns should be retained");
assert.equal(
  Math.max(...boundedHistory.map((turn) => turn.content.length)),
  400,
  "fallback turns should be capped at 400 characters",
);
assert.equal(
  parseConversationContext(`  ${"x".repeat(700)}  `).length,
  500,
  "conversation context should be capped at 500 characters",
);

assert.equal(
  inferResearchMode("比较多伦多和渥太华最近两年每个月的环比"),
  "complex",
  "long monthly comparisons should use the complex route",
);
assert.equal(
  inferResearchMode("微软最近 7 个交易日收盘价"),
  "simple",
  "short direct lookups should use the lower-cost route",
);
assert.equal(
  inferPartialDataPolicy("有多少显示多少，不要补值"),
  true,
  "partial data should be allowed by default",
);
assert.equal(
  inferPartialDataPolicy("必须完整连续，不能缺失"),
  false,
  "explicit completeness requirements should disable partial data",
);

const chartWithGap = toChartData(
  widgetSpecSchema.parse({
    ...valid,
    columns: [
      { key: "date", label: "Date", dataType: "date", unit: null },
      { key: "toronto", label: "Toronto", dataType: "number", unit: "%" },
      { key: "ottawa", label: "Ottawa", dataType: "number", unit: "%" },
    ],
    rows: [{ cells: ["2026-06", "1.2", ""] }],
  }),
);
assert.equal(chartWithGap[0].ottawa, null, "missing numeric values should render as gaps");
assert.equal(chartWithGap[0].toronto, 1.2, "verified numeric values should remain numeric");

console.log("Polaris schema and agent-policy tests passed (14 cases).");
