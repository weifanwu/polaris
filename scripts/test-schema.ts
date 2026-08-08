import assert from "node:assert/strict";
import {
  buildResearchFallbackInstruction,
  inferPartialDataPolicy,
  inferResearchMode,
  isCompleteQualifiedDataRequest,
  parseConversationContext,
  parseConversationHistory,
  resolveDeterministicFollowUp,
} from "../lib/agent-policy";
import { toChartData } from "../components/widgets/chart-data";
import {
  requestedAnnualPeriods,
  requestedCalculation,
  requestedDailyPeriods,
  requestedMonthlyPeriods,
  requestedQuarterlyPeriods,
} from "../lib/data-connectors/query-utils";
import { readWorksheet } from "../lib/data-connectors/xlsx";
import { generateWidgetResultSchema, widgetSpecSchema } from "../lib/widget-schema";
import { strToU8, zipSync } from "fflate";

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
  dataQuality: {
    method: "official_connector",
    sourceName: "Example API",
    requestedPoints: 1,
    availablePoints: 1,
    missingPoints: 0,
    coverageStart: "2026-08-06",
    coverageEnd: "2026-08-06",
    frequency: "daily",
    verifiedAt: "2026-08-06T12:00:00.000Z",
  },
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
    rows: Array.from({ length: 121 }, () => ({ cells: ["2026-08-06", "42"] })),
  }).success,
  false,
  "more than 120 rows should fail",
);

assert.equal(
  widgetSpecSchema.safeParse({
    ...valid,
    rows: Array.from({ length: 120 }, (_, index) => ({ cells: [`2026-${String(index + 1).padStart(2, "0")}`, "42"] })),
  }).success,
  true,
  "official connectors should support up to 120 rows",
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
assert.match(
  resolveDeterministicFollowUp("软件行业", "加拿大软件失业率；最近10年；按月") ?? "",
  /software industry/,
  "a repeated industry selection should be merged without another model question",
);
assert.match(
  resolveDeterministicFollowUp("当前", "加拿大失业率；最近10年；按月") ?? "",
  /latest available observation/,
  "current should confirm the end of a relative rolling range",
);
assert.equal(
  isCompleteQualifiedDataRequest("加拿大IT行业最近10年月度失业率"),
  true,
  "an explicit industry, metric, period, and frequency must not trigger another scope question",
);
assert.equal(
  isCompleteQualifiedDataRequest("加拿大IT失业率"),
  false,
  "ambiguous requests should still use intent resolution",
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

const researchFallback = buildResearchFallbackInstruction("加拿大IT行业最近10年月度失业率");
assert.match(researchFallback, /Web research is mandatory/, "connector misses must trigger web research");
assert.match(researchFallback, /proxy/, "research should try honestly labelled proxy measures before failing");
assert.match(researchFallback, /Never substitute a national total/, "research must preserve qualified scope");

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

assert.equal(requestedMonthlyPeriods("过去两年的金价"), 24, "Chinese year ranges should become monthly periods");
assert.equal(requestedMonthlyPeriods("过去二十四个月的CPI"), 24, "compound Chinese numerals should be parsed");
assert.equal(requestedMonthlyPeriods("last 18 months of silver"), 18, "English month ranges should be parsed");
assert.equal(requestedDailyPeriods("最近7个交易日"), 7, "daily trading periods should be parsed");
assert.equal(requestedQuarterlyPeriods("过去五年人口"), 20, "year ranges should become quarterly periods");
assert.equal(requestedAnnualPeriods("过去十年GDP"), 10, "annual periods should be parsed");
assert.equal(requestedCalculation("黄金每个月环比"), "mom", "month-over-month calculations should be explicit");

const workbook = zipSync({
  "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook><sheets><sheet name="Monthly Prices" r:id="rId2"/></sheets></workbook>'),
  "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
  "xl/sharedStrings.xml": strToU8('<?xml version="1.0"?><sst><si><t>Gold</t></si><si><t>2026M07</t></si></sst>'),
  "xl/worksheets/sheet2.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row r="5"><c r="BR5" t="s"><v>0</v></c></row><row r="7"><c r="A7" t="s"><v>1</v></c><c r="BR7"><v>2400.5</v></c></row></sheetData></worksheet>'),
});
const parsedWorksheet = readWorksheet(workbook.buffer as ArrayBuffer, "Monthly Prices");
assert.equal(parsedWorksheet[0].cells.BR, "Gold", "XLSX shared strings should be decoded");
assert.equal(parsedWorksheet[1].cells.BR, "2400.5", "XLSX numeric cells should be decoded");

console.log("Polaris schema, connector, and agent-policy tests passed (32 cases).");
