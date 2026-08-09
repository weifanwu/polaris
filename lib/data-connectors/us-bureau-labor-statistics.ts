import { ConnectorUnavailableError, type DataConnector } from "./types";
import { hasSubnationalGeography } from "./query-capabilities";
import { fetchWithTransientRetry } from "./http";
import { US_UNEMPLOYMENT_SNAPSHOT } from "./us-unemployment-snapshot";
import {
  isChineseQuery,
  requestedCalculation,
  requestedMonthlyPeriods,
  toFixedCell,
  wantsUnsupportedDailyFrequency,
} from "./query-utils";

type SeriesDefinition = {
  id: string;
  label: string;
  zh: string;
  unit: string;
  decimals: number;
  aliases: RegExp[];
  forceLevel?: boolean;
  fredId?: string;
};

const SERIES: SeriesDefinition[] = [
  { id: "CUSR0000SA0L1E", label: "U.S. core CPI", zh: "美国核心 CPI", unit: "index (1982-84=100)", decimals: 3, aliases: [/core cpi/i, /核心\s*cpi|核心通胀/] },
  { id: "CUSR0000SA0", label: "U.S. CPI", zh: "美国 CPI", unit: "index (1982-84=100)", decimals: 3, aliases: [/consumer price index/i, /\bcpi\b/i, /inflation/i, /消费者?物价指数|消费价格指数|通胀/] },
  { id: "LNS14000000", label: "U.S. unemployment rate", zh: "美国失业率", unit: "%", decimals: 1, aliases: [/unemployment rate/i, /失业率/], forceLevel: true, fredId: "UNRATE" },
  { id: "LNS11300000", label: "U.S. labour-force participation rate", zh: "美国劳动参与率", unit: "%", decimals: 1, aliases: [/participation rate/i, /labou?r force participation/i, /劳动参与率|劳动力参与率/], forceLevel: true },
  { id: "CES0500000003", label: "U.S. average hourly earnings", zh: "美国平均时薪", unit: "USD/hour", decimals: 2, aliases: [/average hourly earnings/i, /average hourly wage/i, /平均时薪|小时工资/] },
  { id: "CES0000000001", label: "U.S. nonfarm payrolls", zh: "美国非农就业人数", unit: "thousand jobs", decimals: 0, aliases: [/nonfarm payrolls?/i, /payroll employment/i, /非农就业|非农人数/] },
  { id: "LNS12000000", label: "U.S. employment level", zh: "美国就业人数", unit: "thousand persons", decimals: 0, aliases: [/employment level/i, /就业人数|就业人口/] },
];

type BlsDatum = { year?: string; period?: string; value?: string };
type BlsResponse = {
  status?: string;
  message?: string[];
  Results?: { series?: Array<{ seriesID?: string; data?: BlsDatum[] }> };
};
type RawRow = { date: string; value: number | null };
const BLS_OUTAGE_COOLDOWN_MS = 10 * 60 * 1_000;
let blsUnavailableUntil = 0;

class BlsFetchError extends Error {
  status?: number;
  retryAfterSeconds?: number;

  constructor(message: string, input: { status?: number; retryAfterSeconds?: number; cause?: unknown } = {}) {
    super(message, { cause: input.cause });
    this.name = "BlsFetchError";
    this.status = input.status;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

function yearWindows(startYear: number, endYear: number) {
  const windows: Array<{ startYear: number; endYear: number }> = [];
  for (let cursor = startYear; cursor <= endYear; cursor += 10) {
    windows.push({ startYear: cursor, endYear: Math.min(cursor + 9, endYear) });
  }
  return windows;
}

async function fetchBlsRows(seriesId: string, startYear: number, endYear: number) {
  const apiUrl = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
  const collected: RawRow[] = [];

  // The unregistered public API allows at most ten calendar years per query.
  // A rolling ten-year monthly window can touch eleven named calendar years,
  // so requests are split and then deterministically joined.
  for (const window of yearWindows(startYear, endYear)) {
    const response = await fetchWithTransientRetry(apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seriesid: [seriesId],
        startyear: String(window.startYear),
        endyear: String(window.endYear),
      }),
    }, { timeoutMs: 15_000 });
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new BlsFetchError(`BLS API returned ${response.status}`, {
        status: response.status,
        ...(Number.isFinite(retryAfter) && retryAfter >= 0 ? { retryAfterSeconds: retryAfter } : {}),
      });
    }
    const payload = await response.json() as BlsResponse;
    if (payload.status !== "REQUEST_SUCCEEDED") {
      throw new BlsFetchError(`BLS API request failed: ${(payload.message ?? []).join(" ")}`);
    }
    const data = payload.Results?.series?.[0]?.data ?? [];
    for (const datum of data) {
      if (!datum.year || !/^M(0[1-9]|1[0-2])$/.test(datum.period ?? "")) continue;
      const value = Number(datum.value);
      collected.push({
        date: `${datum.year}-${datum.period!.slice(1)}`,
        value: Number.isFinite(value) ? value : null,
      });
    }
  }

  return Array.from(new Map(collected.map((row) => [row.date, row])).values())
    .sort((left, right) => left.date.localeCompare(right.date));
}

async function fetchFredRows(fredId: string, startYear: number, endYear: number) {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", fredId);
  url.searchParams.set("cosd", `${startYear}-01-01`);
  url.searchParams.set("coed", `${endYear}-12-31`);
  const response = await fetchWithTransientRetry(url, {}, { timeoutMs: 15_000 });
  if (!response.ok) throw new Error(`FRED CSV returned ${response.status}`);
  const text = await response.text();
  const rows = text.split(/\r?\n/).slice(1).flatMap((line): RawRow[] => {
    const [date, rawValue] = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return [];
    const cleanValue = rawValue?.trim() ?? "";
    if (!cleanValue || cleanValue === ".") return [{ date: date.slice(0, 7), value: null }];
    const value = Number(cleanValue);
    return Number.isFinite(value) ? [{ date: date.slice(0, 7), value }] : [];
  });
  if (rows.filter((row) => row.value !== null).length < 2) throw new Error("FRED CSV did not contain enough monthly observations");
  return Array.from(new Map(rows.map((row) => [row.date, row])).values())
    .sort((left, right) => left.date.localeCompare(right.date));
}

export const usBureauLaborStatisticsConnector: DataConnector = {
  id: "us-bls-public-data-api",
  async tryResolve(query) {
    if (wantsUnsupportedDailyFrequency(query) || hasSubnationalGeography(query)) return null;
    if (!/(united states|\bu\.?s\.?a?\b|american|美国)/i.test(query)) return null;
    if (/(canada|canadian|加拿大|中国|china|英国|united kingdom|日本|japan)/i.test(query)) return null;
    const series = SERIES.find((candidate) => candidate.aliases.some((alias) => alias.test(query)));
    if (!series) return null;

    const chinese = isChineseQuery(query);
    const periods = requestedMonthlyPeriods(query);
    let calculation = series.forceLevel ? "level" as const : requestedCalculation(query);
    if ((series.id.includes("CPI") || series.id.startsWith("CU"))
      && calculation === "level" && /(inflation|通胀|涨幅)/i.test(query)) {
      calculation = "yoy";
    }
    const offset = calculation === "yoy" ? 12 : calculation === "mom" ? 1 : 0;
    const endYear = new Date().getUTCFullYear();
    const lookbackMonths = periods + offset;
    const startYear = endYear - Math.ceil(lookbackMonths / 12);
    let rawRows: RawRow[];
    let deliveredViaFred = false;
    let deliveredViaSnapshot = false;

    try {
      if (Date.now() < blsUnavailableUntil) {
        throw new BlsFetchError("BLS API circuit is temporarily open after a recent transient failure", { status: 503 });
      }
      rawRows = await fetchBlsRows(series.id, startYear, endYear);
      blsUnavailableUntil = 0;
    } catch (blsError) {
      const transient = !(blsError instanceof BlsFetchError)
        || blsError.status === undefined
        || blsError.status === 408
        || blsError.status === 429
        || blsError.status >= 500;
      if (transient) blsUnavailableUntil = Date.now() + BLS_OUTAGE_COOLDOWN_MS;
      if (!series.fredId) {
        throw new ConnectorUnavailableError({
          connectorId: "us-bls-public-data-api",
          sourceName: "U.S. Bureau of Labor Statistics",
          message: chinese
            ? "已匹配美国劳工统计局官方序列，但官方 API 暂时不可用；Polaris 未启动高成本网页搜索。"
            : "The exact U.S. BLS series matched, but its official API is temporarily unavailable; Polaris did not start a costly Web Search fallback.",
          ...(blsError instanceof BlsFetchError && blsError.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: blsError.retryAfterSeconds }
            : {}),
          cause: blsError,
        });
      }
      try {
        rawRows = await fetchFredRows(series.fredId, startYear, endYear);
        deliveredViaFred = true;
      } catch (fredError) {
        if (series.id === "LNS14000000" && US_UNEMPLOYMENT_SNAPSHOT.rows.length >= 2) {
          rawRows = US_UNEMPLOYMENT_SNAPSHOT.rows.map((row) => ({ ...row }));
          deliveredViaSnapshot = true;
        } else {
        throw new ConnectorUnavailableError({
          connectorId: "us-bls-public-data-api",
          sourceName: "U.S. Bureau of Labor Statistics",
          message: chinese
            ? "已匹配美国劳工统计局官方序列，但 BLS 与 FRED 结构化备用源当前都不可用；Polaris 已停止，没有启动网页搜索。"
            : "The exact U.S. BLS series matched, but both BLS and the structured FRED fallback are currently unavailable; Polaris stopped without Web Search.",
          ...(blsError instanceof BlsFetchError && blsError.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: blsError.retryAfterSeconds }
            : {}),
          cause: fredError,
        });
        }
      }
    }

    const rows = rawRows.slice(offset).map((row, index) => {
      if (calculation === "level") return row;
      const previous = rawRows[index]?.value ?? null;
      if (row.value === null || previous === null || previous === 0) return { date: row.date, value: null };
      return { date: row.date, value: ((row.value / previous) - 1) * 100 };
    }).slice(-periods);
    if (rows.length < 2) return null;

    const availablePoints = rows.filter((row) => row.value !== null).length;
    const label = chinese ? series.zh : series.label;
    const first = rows.find((row) => row.value !== null);
    const last = rows.findLast((row) => row.value !== null);
    const summary = first && last
      ? (chinese
          ? `${label}从 ${first.date} 的 ${toFixedCell(first.value)} 变为 ${last.date} 的 ${toFixedCell(last.value)}。`
          : `${label} moved from ${toFixedCell(first.value)} in ${first.date} to ${toFixedCell(last.value)} in ${last.date}.`)
      : "";

    return {
      message: deliveredViaSnapshot
        ? (chinese
            ? `BLS 与 FRED 实时接口暂时不可用；已使用 ${US_UNEMPLOYMENT_SNAPSHOT.fetchedAt.slice(0, 10)} 核验并随版本保存的 BLS/FRED 官方快照，返回 ${availablePoints}/${rows.length} 个数据点；数据检索阶段未使用模型或网页搜索。`
            : `The live BLS and FRED endpoints were unavailable; returned ${availablePoints}/${rows.length} observations from the BLS/FRED official snapshot verified on ${US_UNEMPLOYMENT_SNAPSHOT.fetchedAt.slice(0, 10)}; data retrieval used no model or Web Search.`)
        : deliveredViaFred
        ? (chinese
            ? `BLS 官方 API 暂时不可用；已通过 FRED 的 BLS 镜像数据校验 ${availablePoints}/${rows.length} 个数据点；数据检索阶段未使用模型或网页搜索。`
            : `The BLS API was temporarily unavailable; validated ${availablePoints}/${rows.length} observations through FRED's BLS-sourced series; data retrieval used no model or Web Search.`)
        : (chinese
            ? `已通过美国劳工统计局公开 API 校验 ${availablePoints}/${rows.length} 个数据点；数据检索阶段未使用模型或网页搜索。`
            : `Validated ${availablePoints}/${rows.length} observations through the U.S. BLS Public Data API; data retrieval used no model or Web Search.`),
      widget: {
        title: `${label}${calculation === "level" ? "" : calculation === "mom" ? " · MoM" : " · YoY"}`,
        subtitle: `${rows[0].date} – ${rows.at(-1)!.date} · ${series.id} · seasonally adjusted${deliveredViaSnapshot ? ` · verified snapshot ${US_UNEMPLOYMENT_SNAPSHOT.fetchedAt.slice(0, 10)}` : deliveredViaFred ? " · BLS data via FRED" : ""}`,
        visualization: "line_chart",
        columns: [
          { key: "date", label: chinese ? "月份" : "Month", dataType: "date", unit: null },
          { key: "value", label, dataType: "number", unit: calculation === "level" ? series.unit : "%" },
        ],
        rows: rows.map((row) => ({ cells: [row.date, toFixedCell(row.value, calculation === "level" ? series.decimals : 2)] })),
        summary,
        sources: (deliveredViaFred || deliveredViaSnapshot) && series.fredId
          ? [
              { title: `FRED ${series.fredId} (source: BLS)`, url: `https://fred.stlouisfed.org/series/${series.fredId}` },
              { title: `BLS series ${series.id}`, url: `https://data.bls.gov/timeseries/${series.id}` },
            ]
          : [
              { title: `BLS series ${series.id}`, url: `https://data.bls.gov/timeseries/${series.id}` },
              { title: "BLS Public Data API", url: "https://www.bls.gov/developers/api_signature_v2.htm" },
            ],
        dataQuality: {
          method: "official_connector",
          sourceName: "U.S. Bureau of Labor Statistics",
          requestedPoints: rows.length,
          availablePoints,
          missingPoints: rows.length - availablePoints,
          coverageStart: rows[0].date,
          coverageEnd: rows.at(-1)!.date,
          frequency: "monthly",
          verifiedAt: deliveredViaSnapshot ? US_UNEMPLOYMENT_SNAPSHOT.fetchedAt : new Date().toISOString(),
          ...(deliveredViaSnapshot
            ? { scope: `Live BLS and FRED endpoints unavailable; using a versioned official snapshot verified ${US_UNEMPLOYMENT_SNAPSHOT.fetchedAt} through ${US_UNEMPLOYMENT_SNAPSHOT.coverageEnd}. Refresh will prefer live sources.` }
            : deliveredViaFred
              ? { scope: "BLS observations delivered through the FRED structured-data mirror after a transient BLS API failure." }
              : {}),
        },
      },
    };
  },
};
