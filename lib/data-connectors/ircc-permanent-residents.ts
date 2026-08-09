import type { DataConnector } from "./types";
import { ConnectorUnavailableError } from "./types";
import { fetchWithTransientRetry } from "./http";
import { isChineseQuery, requestedMonthlyPeriods } from "./query-utils";
import { listWorksheetNames, readWorksheet, type SpreadsheetRow } from "./xlsx";

const CONNECTOR_ID = "ircc-permanent-residents";
const SOURCE_NAME = "IRCC Monthly Permanent Residents";
const DATASET_URL = "https://open.canada.ca/data/en/dataset/f7e5498e-0ad8-4417-85c9-9b8aff9b9eda";
const WORKBOOK_URL = "https://www.ircc.canada.ca/opendata-donneesouvertes/data/EN_ODP-PR-ProvImmCat.xlsx";
const CACHE_MS = 6 * 60 * 60 * 1_000;

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

type MonthlyAdmission = { period: string; value: number };
let cache: { loadedAt: number; rows: MonthlyAdmission[] } | null = null;
let inFlight: Promise<MonthlyAdmission[]> | null = null;

function parsePublishedNumber(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized || normalized === "--") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function rowByNumber(rows: SpreadsheetRow[], number: number) {
  return rows.find((row) => row.number === number);
}

function parseMonthlyTotals(rows: SpreadsheetRow[]) {
  const yearRow = rowByNumber(rows, 3);
  const monthRow = rowByNumber(rows, 5);
  const totalRow = rows.find((row) => /^Total$/i.test(row.cells.A?.trim() ?? ""));
  if (!yearRow || !monthRow || !totalRow) {
    throw new Error("IRCC workbook headers or national total row changed");
  }

  let activeYear = "";
  const result: MonthlyAdmission[] = [];
  for (const column of Object.keys(monthRow.cells)) {
    const yearCandidate = yearRow.cells[column]?.trim() ?? "";
    if (/^20\d{2}$/.test(yearCandidate)) activeYear = yearCandidate;
    const month = MONTHS[monthRow.cells[column]?.trim() ?? ""];
    if (!activeYear || !month) continue;
    const value = parsePublishedNumber(totalRow.cells[column] ?? "");
    if (value === null) continue;
    result.push({ period: `${activeYear}-${month}`, value });
  }

  return result
    .filter((row, index, all) => all.findIndex((candidate) => candidate.period === row.period) === index)
    .sort((left, right) => left.period.localeCompare(right.period));
}

async function fetchMonthlyTotals() {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache.rows;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const response = await fetchWithTransientRetry(WORKBOOK_URL, {}, { timeoutMs: 18_000, attempts: 2 });
    if (!response.ok) throw new Error(`IRCC workbook returned HTTP ${response.status}`);
    const workbook = await response.arrayBuffer();
    const sheetName = listWorksheetNames(workbook)[0];
    if (!sheetName) throw new Error("IRCC workbook did not contain a worksheet");
    const result = parseMonthlyTotals(readWorksheet(workbook, sheetName));
    if (result.length < 100) throw new Error("IRCC workbook returned insufficient monthly coverage");
    cache = { loadedAt: Date.now(), rows: result };
    return result;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

function supportsQuery(query: string) {
  const canada = /(?:加拿大|\bcanada\b|canadian)/i.test(query);
  const admissions = /(?:新增永久居民|永久居民(?:人数|数量|增长|趋势|入境|登陆)?|permanent residents?|permanent resident admissions?)/i.test(query);
  const excludes = /(?:申请|获批率|processing|applications?|temporary residents?|临时居民)/i.test(query);
  return canada && admissions && !excludes;
}

export const irccPermanentResidentsConnector: DataConnector = {
  id: CONNECTOR_ID,
  supportsQuery,
  async tryResolve(query) {
    if (!supportsQuery(query)) return null;
    const chinese = isChineseQuery(query);
    const requested = requestedMonthlyPeriods(query, 120);

    let allRows: MonthlyAdmission[];
    try {
      allRows = await fetchMonthlyTotals();
    } catch (error) {
      throw new ConnectorUnavailableError({
        connectorId: CONNECTOR_ID,
        sourceName: SOURCE_NAME,
        message: chinese
          ? "IRCC 官方月度永久居民工作簿暂时无法读取；现有仪表板数据不会被替换。"
          : "The official IRCC monthly permanent-resident workbook is temporarily unavailable; existing dashboard data was preserved.",
        cause: error,
      });
    }

    const rows = allRows.slice(-requested);
    if (rows.length < 2) return null;
    const requestedPoints = requested;
    const availablePoints = rows.length;
    const missingPoints = Math.max(0, requestedPoints - availablePoints);
    const coverageNote = missingPoints
      ? (chinese
        ? `用户请求 ${requestedPoints} 个月；IRCC 当前月度文件仅提供 ${allRows[0].period} 起的 ${availablePoints} 个可用月份，未将更早的年度数据伪装成月度数据。`
        : `The request covers ${requestedPoints} months; IRCC's current monthly file provides ${availablePoints} available months beginning ${allRows[0].period}. Earlier annual data was not relabelled as monthly.`)
      : (chinese
        ? `已返回最近 ${availablePoints} 个官方月度观测。`
        : `Returned the latest ${availablePoints} official monthly observations.`);

    return {
      message: chinese
        ? `已直接解析 IRCC 官方 XLSX 的加拿大全国 Total 行，得到 ${availablePoints}/${requestedPoints} 个月度观测；本次不使用模型或网页搜索。`
        : `Parsed Canada's national Total row directly from the official IRCC XLSX and returned ${availablePoints}/${requestedPoints} monthly observations without a model or Web Search.`,
      widget: {
        title: chinese ? "加拿大新增永久居民（月度）" : "New permanent residents in Canada (monthly)",
        subtitle: `${rows[0].period} – ${rows.at(-1)!.period} · ${chinese ? "全国永久居民入境人数" : "national permanent-resident admissions"}`,
        visualization: "line_chart",
        columns: [
          { key: "month", label: chinese ? "月份" : "Month", dataType: "date", unit: null },
          { key: "admissions", label: chinese ? "新增永久居民" : "Permanent residents admitted", dataType: "number", unit: chinese ? "人" : "people" },
        ],
        rows: rows.map((row) => ({ cells: [row.period, String(row.value)] })),
        summary: `${coverageNote} ${chinese ? "IRCC 对较小单元格实施披露控制并将其他值取整到最接近的 5；本图采用工作簿已公布的全国 Total，不对被抑制的分项自行补值。数据为初步值，后续发布可能修订。" : "IRCC suppresses small cells and rounds other values to the nearest five. This chart uses the workbook's published national Total and does not infer suppressed components. Values are preliminary and may be revised."}`,
        sources: [
          { title: "IRCC Permanent Residents – Monthly Updates", url: DATASET_URL },
          { title: "IRCC Province/Territory and Immigration Category XLSX", url: WORKBOOK_URL },
        ],
        dataQuality: {
          method: "official_connector",
          sourceName: SOURCE_NAME,
          requestedPoints,
          availablePoints,
          missingPoints,
          coverageStart: rows[0].period,
          coverageEnd: rows.at(-1)!.period,
          frequency: "monthly",
          verifiedAt: new Date().toISOString(),
          scope: (chinese
            ? `加拿大全国 · 新增永久居民 · IRCC 已发布 Total · ${missingPoints ? `请求窗口早于官方月度覆盖 ${missingPoints} 个月` : "完整请求窗口"}`
            : `Canada total · permanent-resident admissions · published IRCC Total · ${missingPoints ? `${missingPoints} requested months predate monthly coverage` : "complete requested window"}`).slice(0, 240),
        },
      },
    };
  },
};
