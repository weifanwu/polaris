import type { DataConnector } from "./types";
import { fetchWithTransientRetry } from "./http";
import {
  isChineseQuery,
  requestedMonthlyPeriods,
  toFixedCell,
} from "./query-utils";
import { readWorksheet } from "./xlsx";

const CREA_STATS_URL = "https://stats.crea.ca/en-ca/";
const CREA_STATIC_QUERY_URL = "https://stats.crea.ca/page-data/sq/d/2257240888.json";
const CREA_PAGE_DATA_URL = "https://stats.crea.ca/page-data/en-CA/page-data.json";
const CACHE_TTL_MS = 60 * 60 * 1_000;

type PriceObservation = {
  period: string;
  value: number;
};

type WorkbookCache = {
  workbookUrl: string;
  observations: PriceObservation[];
  fetchedAt: number;
};

let workbookCache: WorkbookCache | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function findWorkbookCandidate(value: unknown): string | null {
  if (typeof value === "string" && /News_release_chart_data_[^\s"']+\.xlsx(?:\?[^\s"']*)?$/i.test(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findWorkbookCandidate(child);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const child of Object.values(record)) {
    const found = findWorkbookCandidate(child);
    if (found) return found;
  }
  return null;
}

function validateWorkbookUrl(candidate: string) {
  const normalized = candidate.startsWith("//") ? `https:${candidate}` : candidate;
  const url = new URL(normalized);
  if (
    url.protocol !== "https:"
    || url.hostname !== "assets.ctfassets.net"
    || !url.pathname.toLowerCase().endsWith(".xlsx")
  ) {
    throw new Error("CREA metadata returned an unexpected workbook URL");
  }
  return url.toString();
}

async function fetchJson(url: string) {
  const response = await fetchWithTransientRetry(url, {}, { timeoutMs: 12_000 });
  if (!response.ok) throw new Error(`CREA metadata returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

async function discoverWorkbookUrl() {
  try {
    const directMetadata = await fetchJson(CREA_STATIC_QUERY_URL);
    const directCandidate = findWorkbookCandidate(directMetadata);
    if (directCandidate) return validateWorkbookUrl(directCandidate);
  } catch (error) {
    console.warn("[Polaris CREA connector] Stable metadata query failed; trying page index", error);
  }

  const pageData = asRecord(await fetchJson(CREA_PAGE_DATA_URL));
  const hashes = pageData?.staticQueryHashes;
  if (!Array.isArray(hashes)) throw new Error("CREA page metadata did not contain static query hashes");
  const metadata = await Promise.all(hashes.slice(0, 16).flatMap((hash) => {
    if (typeof hash !== "string" || !/^\d+$/.test(hash)) return [];
    return [fetchJson(`https://stats.crea.ca/page-data/sq/d/${hash}.json`).catch(() => null)];
  }));
  for (const payload of metadata) {
    const candidate = findWorkbookCandidate(payload);
    if (candidate) return validateWorkbookUrl(candidate);
  }
  throw new Error("CREA did not publish a discoverable monthly statistics workbook");
}

function excelSerialToMonth(value: string) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 1) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseAveragePriceWorkbook(workbook: ArrayBuffer) {
  const rows = readWorksheet(workbook, "Chart 4");
  const byPeriod = new Map<string, number>();
  for (const row of rows) {
    const period = excelSerialToMonth(row.cells.A ?? "");
    const value = Number(row.cells.B);
    if (period && Number.isFinite(value) && value > 0) byPeriod.set(period, value);
  }
  const observations = Array.from(byPeriod, ([period, value]) => ({ period, value }))
    .sort((a, b) => a.period.localeCompare(b.period));
  if (observations.length < 240) {
    throw new Error(`CREA workbook returned only ${observations.length} monthly average-price observations`);
  }
  return observations;
}

async function loadAveragePrices() {
  if (workbookCache && Date.now() - workbookCache.fetchedAt < CACHE_TTL_MS) return workbookCache;
  const workbookUrl = await discoverWorkbookUrl();
  const response = await fetchWithTransientRetry(workbookUrl, {}, { timeoutMs: 20_000 });
  if (!response.ok) throw new Error(`CREA workbook returned ${response.status}`);
  const observations = parseAveragePriceWorkbook(await response.arrayBuffer());
  workbookCache = { workbookUrl, observations, fetchedAt: Date.now() };
  return workbookCache;
}

function isNationalAveragePriceQuery(query: string) {
  const housing = /(?:average (?:home|house|residential|sale) price|residential average price|home prices?|house prices?|平均(?:住宅|房屋|房产|房)价|平均住宅售价|住宅平均售价)/i.test(query);
  const canada = /(?:\bcanada\b|\bcanadian\b|national|加拿大|全国)/i.test(query);
  const incompatibleMetric = /(?:benchmark|home price index|\bhpi\b|基准价|价格指数|房价指数)/i.test(query);
  const subnational = /(?:toronto|ottawa|vancouver|montr[eé]al|calgary|edmonton|winnipeg|halifax|ontario|qu[eé]bec|alberta|british columbia|多伦多|渥太华|温哥华|蒙特利尔|卡尔加里|埃德蒙顿|温尼伯|哈利法克斯|安大略|魁北克|阿尔伯塔|不列颠哥伦比亚|卑诗)/i.test(query);
  const incompatibleFrequency = /(?:季度|每季|逐季|年度|每年|逐年|quarterly|annual|yearly)/i.test(query)
    && !/(?:每月|逐月|月度|个月|monthly|months?)/i.test(query);
  return housing && canada && !incompatibleMetric && !subnational && !incompatibleFrequency;
}

function percentageChange(first: number, last: number) {
  return first === 0 ? null : ((last / first) - 1) * 100;
}

export const canadianRealEstateAssociationConnector: DataConnector = {
  id: "crea-national-average-price",
  async tryResolve(query) {
    if (!isNationalAveragePriceQuery(query)) return null;

    const chinese = isChineseQuery(query);
    const requested = requestedMonthlyPeriods(query, 240);
    const { workbookUrl, observations } = await loadAveragePrices();
    const selected = observations.slice(-requested);
    if (selected.length < 2) return null;

    const availablePoints = selected.length;
    const missingPoints = Math.max(0, requested - availablePoints);
    const first = selected[0];
    const last = selected.at(-1)!;
    const peak = selected.reduce((best, row) => row.value > best.value ? row : best, first);
    const trough = selected.reduce((best, row) => row.value < best.value ? row : best, first);
    const change = percentageChange(first.value, last.value);
    const coverageNote = missingPoints
      ? (chinese
          ? `用户请求 ${requested} 个月，当前 CREA 工作簿提供其中 ${availablePoints} 个月；更早月份保持缺失。`
          : `The request covers ${requested} months; CREA's workbook provides ${availablePoints}, with earlier months left missing.`)
      : "";

    return {
      message: chinese
        ? `已直接解析 CREA 官方月度 XLSX，校验 ${availablePoints}/${requested} 个全国平均住宅售价观测；本次未使用模型或网页搜索。`
        : `Parsed CREA's official monthly XLSX and validated ${availablePoints}/${requested} national average residential sale-price observations without a model or Web Search.`,
      widget: {
        title: chinese ? "加拿大全国平均住宅售价" : "Canada national average residential sale price",
        subtitle: `${first.period} – ${last.period} · actual (not seasonally adjusted) · all housing types`,
        visualization: "line_chart",
        columns: [
          { key: "month", label: chinese ? "月份" : "Month", dataType: "date", unit: null },
          { key: "average_price", label: chinese ? "全国平均住宅售价" : "National average residential sale price", dataType: "number", unit: "CAD" },
        ],
        rows: selected.map((row) => ({ cells: [row.period, toFixedCell(row.value, 0)] })),
        summary: `${coverageNote} ${chinese
          ? `从 ${first.period} 的 $${Math.round(first.value).toLocaleString("en-CA")} 变为 ${last.period} 的 $${Math.round(last.value).toLocaleString("en-CA")}${change === null ? "" : `（${change >= 0 ? "+" : ""}${change.toFixed(1)}%）`}；区间高点为 ${peak.period} 的 $${Math.round(peak.value).toLocaleString("en-CA")}，低点为 ${trough.period} 的 $${Math.round(trough.value).toLocaleString("en-CA")}。该平均值会受到各地区及成交房型组合变化影响，不等同于 MLS® HPI 基准价。`
          : `The national average moved from $${Math.round(first.value).toLocaleString("en-CA")} in ${first.period} to $${Math.round(last.value).toLocaleString("en-CA")}${change === null ? "" : ` (${change >= 0 ? "+" : ""}${change.toFixed(1)}%)`}. The period peak was $${Math.round(peak.value).toLocaleString("en-CA")} in ${peak.period}, and the trough was $${Math.round(trough.value).toLocaleString("en-CA")} in ${trough.period}. This average is affected by regional and property-type sales mix and is not an MLS® HPI benchmark price.`}`.trim(),
        sources: [
          { title: "CREA National Statistics", url: CREA_STATS_URL },
          { title: "CREA monthly news release chart data (XLSX)", url: workbookUrl },
        ],
        dataQuality: {
          method: "official_connector",
          sourceName: "Canadian Real Estate Association",
          requestedPoints: requested,
          availablePoints,
          missingPoints,
          coverageStart: first.period,
          coverageEnd: last.period,
          frequency: "monthly",
          verifiedAt: new Date().toISOString(),
          scope: (chinese
            ? "地区：加拿大全国 · 指标：实际（未经季节调整）平均住宅成交价 · 全部住宅类型"
            : "Geography: Canada · Actual (not seasonally adjusted) average residential sale price · All housing types").slice(0, 240),
        },
      },
    };
  },
};
