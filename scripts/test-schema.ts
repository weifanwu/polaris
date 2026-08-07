import assert from "node:assert/strict";
import { widgetSpecSchema } from "../lib/widget-schema";

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

console.log("WidgetSpec schema tests passed (4 cases).");
