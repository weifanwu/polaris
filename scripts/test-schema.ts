import assert from "node:assert/strict";
import {
  buildResearchFallbackInstruction,
  inferPartialDataPolicy,
  inferResearchMode,
  isCompleteQualifiedDataRequest,
  isKnownProxyResearchRequest,
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
import { listWorksheetNames } from "../lib/data-connectors/xlsx";
import { MAX_USER_DATA_CHARS, parseUserDataset, remoteDatasetFromUrl } from "../lib/user-dataset";
import { buildWidgetInsights } from "../lib/insight-engine";
import { fetchWithTransientRetry } from "../lib/data-connectors/http";
import { buildDashboardContext, buildReferencedWidgetDataset, MAX_DASHBOARD_CONTEXT_CHARS, parseDashboardContext, queryReferencesDashboard, queryReferencesDataset } from "../lib/dashboard-context";
import { buildRefreshContext, parseRefreshContext, validateRefreshCandidate } from "../lib/widget-refresh";
import { generateWidgetResultSchema, widgetSpecSchema } from "../lib/widget-schema";
import { applyRequestedHypotheses } from "../lib/hypothesis-data";
import { resolveOfficialConnector } from "../lib/data-connectors";
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
const parsedValidWidget = widgetSpecSchema.parse(valid);

const compactDashboard = buildDashboardContext([
  parsedValidWidget,
  { ...parsedValidWidget, id: "second-widget", title: "Second dashboard series", originalQuery: "second question" },
], "What is the latest inflation rate?");
assert.match(compactDashboard, /2 widgets/, "dashboard context should report the widget count");
assert.match(compactDashboard, /Test series/, "dashboard context should include every widget title");
assert.match(compactDashboard, /Second dashboard series/, "dashboard context should include later widget metadata");
assert.doesNotMatch(compactDashboard, /first:/, "unrelated questions should receive metadata only");

const expandedDashboard = buildDashboardContext([parsedValidWidget], "Compare the chart above with the current dashboard");
assert.equal(queryReferencesDashboard("对比一下仪表板上面的图"), true, "dashboard references should trigger richer compact context");
assert.match(expandedDashboard, /latest:/, "dashboard-referential questions should receive boundary observations");
assert.ok(expandedDashboard.length <= MAX_DASHBOARD_CONTEXT_CHARS, "dashboard context must stay within the input budget");
assert.equal(parseDashboardContext("x".repeat(MAX_DASHBOARD_CONTEXT_CHARS + 100)).length, MAX_DASHBOARD_CONTEXT_CHARS, "server dashboard context must be bounded independently");
assert.equal(queryReferencesDataset("这个是美国失业率数据，帮我重新画"), true, "dataset redraw requests should resolve to dashboard data");

const refreshContextFixture = buildRefreshContext(parsedValidWidget);
assert.deepEqual(parseRefreshContext(refreshContextFixture), refreshContextFixture, "refresh identity metadata should round-trip through the server parser");
assert.deepEqual(
  validateRefreshCandidate(parsedValidWidget, { ...parsedValidWidget, generatedAt: "2026-08-08T12:00:00.000Z" }),
  { compatible: true, changed: false },
  "generated timestamps alone must not update a widget",
);
assert.deepEqual(
  validateRefreshCandidate(parsedValidWidget, { ...parsedValidWidget, rows: [...parsedValidWidget.rows, { cells: ["2026-08-07", "43"] }] }),
  { compatible: true, changed: true },
  "new observations should update a compatible widget",
);
assert.equal(
  validateRefreshCandidate(parsedValidWidget, {
    ...parsedValidWidget,
    columns: [parsedValidWidget.columns[0], { ...parsedValidWidget.columns[1], label: "Different metric" }],
  }).compatible,
  false,
  "refresh must reject a changed metric identity",
);
assert.equal(
  validateRefreshCandidate(parsedValidWidget, {
    ...parsedValidWidget,
    dataQuality: { ...parsedValidWidget.dataQuality!, sourceName: "Different official source" },
  }).compatible,
  false,
  "official refresh must remain locked to the original connector",
);
const searchedWidget = widgetSpecSchema.parse({
  ...valid,
  dataQuality: { ...valid.dataQuality, method: "web_search", sourceName: "Example research" },
});
assert.equal(
  validateRefreshCandidate(searchedWidget, {
    ...searchedWidget,
    sources: [{ title: "Unrelated publisher", url: "https://unrelated.example/data" }],
  }).compatible,
  false,
  "web refresh must retain at least one original publisher domain",
);

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
    rows: Array.from({ length: 301 }, () => ({ cells: ["2026-08-06", "42"] })),
  }).success,
  false,
  "more than 300 rows should fail",
);

assert.equal(
  widgetSpecSchema.safeParse({
    ...valid,
    rows: Array.from({ length: 240 }, (_, index) => ({ cells: [`period-${String(index + 1).padStart(3, "0")}`, "42"] })),
  }).success,
  true,
  "official connectors should support 20 years of monthly rows",
);

assert.equal(
  widgetSpecSchema.safeParse({ ...valid, rows: [{ cells: ["2026-08-06"] }] }).success,
  false,
  "cell count must match column count",
);
assert.equal(
  widgetSpecSchema.safeParse({ ...valid, rows: [{ cells: ["2026-08-06", "42"], cellStatus: ["verified"] }] }).success,
  false,
  "cell provenance count must match the row shape",
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
assert.equal(
  generateWidgetResultSchema.safeParse({
    status: "cannot_answer",
    message: "The run stopped safely.",
    widget: null,
    trace: {
      mode: "fallback",
      summary: "A safe operational trace.",
      events: [{
        id: "trace-1",
        kind: "validation",
        status: "failed",
        title: "Widget validation failed",
        detail: "No incomplete widget was saved.",
        durationMs: 120,
      }],
    },
  }).success,
  true,
  "operational traces should pass the response contract",
);

assert.equal(
  widgetSpecSchema.safeParse({
    ...valid,
    sources: [],
    dataQuality: { ...valid.dataQuality, method: "user_data", sourceName: "analysis.csv" },
  }).success,
  true,
  "user-supplied datasets should be represented explicitly in quality metadata",
);
assert.deepEqual(
  parseUserDataset({ name: "sample.csv", format: "csv", content: "date,value\n2026-01,10" }),
  { name: "sample.csv", format: "csv", content: "date,value\n2026-01,10", truncated: false, origin: "attachment" },
  "valid user datasets should be bounded and parsed",
);
assert.equal(
  parseUserDataset({ name: "large.csv", format: "csv", content: "x".repeat(MAX_USER_DATA_CHARS + 1) }),
  null,
  "oversized user datasets must be rejected before model input",
);
assert.equal(
  parseUserDataset({ name: "report.pdf", format: "pdf", content: "", fileData: "data:application/pdf;base64,JVBERi0=" })?.format,
  "pdf",
  "bounded PDF attachments should pass through as file inputs",
);
assert.equal(
  remoteDatasetFromUrl("https://example.com/data/monthly.csv")?.format,
  "csv",
  "direct downloadable data URLs should be recognized by the file-first route",
);

const boundedHistory = parseConversationHistory(
  Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `turn-${index}-${"x".repeat(600)}`,
  })),
);
assert.equal(boundedHistory.length, 6, "only six bounded continuity turns should be retained");
assert.equal(
  Math.max(...boundedHistory.map((turn) => turn.content.length)),
  360,
  "fallback turns should be capped at 360 characters",
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
assert.match(
  resolveDeterministicFollowUp(
    "接受。直接采用最新季度 DHEA 可获得的最接近官方财富分组，不要推算。",
    "分析加拿大最新家庭财富分布；询问是否接受 DHEA 官方分组",
  ) ?? "",
  /preserve official names and definitions/,
  "DHEA grouping acceptance should be merged deterministically instead of asking again",
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
  isKnownProxyResearchRequest("加拿大IT行业最近10年月度失业率"),
  true,
  "known exact-series gaps should use the lower-cost proxy-discovery budget",
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

const hypothesisFixture = widgetSpecSchema.parse({
  ...valid,
  rows: [
    { cells: ["2026-01", "4.0"] },
    { cells: ["2026-02", ""] },
    { cells: ["2026-03", "4.4"] },
  ],
});
const hypothesis = applyRequestedHypotheses(hypothesisFixture, "缺少的数据按上下文推测，并标成 unverified");
assert.equal(hypothesis.appliedPoints, 1, "one small internal gap should be interpolated deterministically");
assert.equal(hypothesis.widget.rows[1].cells[1], "4.2", "interpolation should preserve the surrounding precision");
assert.equal(hypothesis.widget.rows[1].cellStatus?.[1], "unverified", "hypothesis cells must carry explicit provenance");
const dashboardDataset = buildReferencedWidgetDataset([hypothesis.widget], "这个数据帮我重新画");
assert.equal(dashboardDataset?.origin, "dashboard", "a referential redraw should reuse a bounded dashboard dataset");
assert.match(dashboardDataset?.content ?? "", /^2026-02,$/m, "previous hypothesis values must be removed before dashboard-data reuse");

assert.equal(requestedMonthlyPeriods("过去两年的金价"), 24, "Chinese year ranges should become monthly periods");
assert.equal(requestedMonthlyPeriods("过去二十四个月的CPI"), 24, "compound Chinese numerals should be parsed");
assert.equal(requestedMonthlyPeriods("last 18 months of silver"), 18, "English month ranges should be parsed");
assert.equal(requestedMonthlyPeriods("加拿大过去20年每月永久居民人数"), 240, "20-year monthly requests should preserve 240 requested periods");
assert.equal(requestedDailyPeriods("最近7个交易日"), 7, "daily trading periods should be parsed");
assert.equal(requestedQuarterlyPeriods("过去五年人口"), 20, "year ranges should become quarterly periods");
assert.equal(requestedAnnualPeriods("过去十年GDP"), 10, "annual periods should be parsed");
assert.equal(requestedCalculation("黄金每个月环比"), "mom", "month-over-month calculations should be explicit");

const insightFixture = widgetSpecSchema.parse({
  ...valid,
  title: "美国失业率",
  originalQuery: "过去十年美国每月失业率",
  rows: [
    { cells: ["2020-02", "3.5"] },
    { cells: ["2020-03", "4.4"] },
    { cells: ["2020-04", "14.8"] },
    { cells: ["2026-07", "4.1"] },
  ],
  dataQuality: { ...valid.dataQuality, requestedPoints: 4, availablePoints: 4, frequency: "monthly" },
});
const insight = buildWidgetInsights(insightFixture);
assert.match(insight, /2020-04/, "analysis should identify the dated peak instead of only comparing endpoints");
assert.match(insight, /最大相邻期变化/, "analysis should quantify the largest adjacent-period shift");
assert.match(insight, /不把.*因果/, "analysis should state its causal boundary");

const workbook = zipSync({
  "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook><sheets><sheet name="Monthly Prices" r:id="rId2"/></sheets></workbook>'),
  "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
  "xl/sharedStrings.xml": strToU8('<?xml version="1.0"?><sst><si><t>Gold</t></si><si><t>2026M07</t></si></sst>'),
  "xl/worksheets/sheet2.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row r="5"><c r="BR5" t="s"><v>0</v></c></row><row r="7"><c r="A7" t="s"><v>1</v></c><c r="BR7"><v>2400.5</v></c></row></sheetData></worksheet>'),
});
const parsedWorksheet = readWorksheet(workbook.buffer as ArrayBuffer, "Monthly Prices");
assert.deepEqual(listWorksheetNames(workbook.buffer as ArrayBuffer), ["Monthly Prices"], "XLSX sheet names should be discoverable for uploads");
assert.equal(parsedWorksheet[0].cells.BR, "Gold", "XLSX shared strings should be decoded");
assert.equal(parsedWorksheet[1].cells.BR, "2400.5", "XLSX numeric cells should be decoded");

const originalFetch = globalThis.fetch;
try {
  let transientAttempts = 0;
  globalThis.fetch = async () => {
    transientAttempts += 1;
    return new Response("", { status: transientAttempts === 1 ? 503 : 200 });
  };
  const recovered = await fetchWithTransientRetry("https://example.com/data", {}, { timeoutMs: 100, attempts: 2 });
  assert.equal(recovered.status, 200, "transient connector failures should receive one bounded retry");
  assert.equal(transientAttempts, 2, "bounded retry should stop after recovery");

  let permanentAttempts = 0;
  globalThis.fetch = async () => {
    permanentAttempts += 1;
    return new Response("", { status: 404 });
  };
  const permanentFailure = await fetchWithTransientRetry("https://example.com/missing", {}, { timeoutMs: 100, attempts: 2 });
  assert.equal(permanentFailure.status, 404, "non-transient connector responses should be returned immediately");
  assert.equal(permanentAttempts, 1, "4xx connector responses must not be retried");
} finally {
  globalThis.fetch = originalFetch;
}

try {
  let blsAttempts = 0;
  let fredAttempts = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.bls.gov")) {
      blsAttempts += 1;
      return new Response("maintenance", { status: 503 });
    }
    if (url.includes("fred.stlouisfed.org")) {
      fredAttempts += 1;
      return new Response("observation_date,UNRATE\n2026-04-01,4.1\n2026-05-01,\n2026-06-01,4.2\n2026-07-01,4.3\n", { status: 200 });
    }
    throw new Error(`Unexpected connector URL: ${url}`);
  };
  const blsFallback = await resolveOfficialConnector("过去十年美国每月失业率");
  assert.equal(blsFallback.status, "success", "a BLS outage should recover through the deterministic FRED mirror");
  assert.equal(blsAttempts, 2, "BLS should receive one bounded transient retry before fallback");
  assert.equal(fredAttempts, 1, "FRED fallback should be attempted once after BLS retry exhaustion");
  if (blsFallback.status === "success") {
    assert.match(blsFallback.result.message, /FRED/, "the fallback delivery path must be disclosed to the user");
    assert.equal(blsFallback.result.widget.dataQuality?.sourceName, "U.S. Bureau of Labor Statistics", "source identity should stay stable for refresh compatibility");
    assert.equal(blsFallback.result.widget.rows.find((row) => row.cells[0] === "2026-05")?.cells[1], "", "blank FRED observations must remain missing instead of becoming zero");
  }
} finally {
  globalThis.fetch = originalFetch;
}

try {
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  const snapshotFallback = await resolveOfficialConnector("过去十年美国每月失业率");
  assert.equal(snapshotFallback.status, "success", "a simultaneous BLS/FRED outage should use the versioned verified snapshot");
  if (snapshotFallback.status === "success") {
    assert.equal(snapshotFallback.result.widget.rows.length, 120, "the emergency snapshot should preserve the requested rolling history");
    assert.match(snapshotFallback.result.message, /快照|snapshot/i, "snapshot delivery must be disclosed in the answer");
    assert.match(snapshotFallback.result.widget.dataQuality?.scope ?? "", /snapshot/i, "snapshot provenance must be recorded in data quality metadata");
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Polaris schema, connector fallback, conversation continuity, provenance, refresh, and agent-policy tests passed.");
