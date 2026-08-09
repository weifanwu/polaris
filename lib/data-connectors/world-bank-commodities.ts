import type { DataConnector } from "./types";
import { hasSubnationalGeography } from "./query-capabilities";
import { fetchWithTransientRetry } from "./http";
import { readWorksheet } from "./xlsx";
import {
  isChineseQuery,
  requestedCalculation,
  requestedMonthlyPeriods,
  toFixedCell,
  wantsUnsupportedDailyFrequency,
} from "./query-utils";

const SOURCE_PAGE = "https://www.worldbank.org/en/research/commodity-markets";
const FALLBACK_DATA_URL =
  "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx";

type CommodityDefinition = {
  header: string;
  zh: string;
  aliases: RegExp[];
};

const COMMODITIES: CommodityDefinition[] = [
  { header: "Crude oil, Brent", zh: "布伦特原油", aliases: [/brent/i, /布伦特/] },
  { header: "Crude oil, WTI", zh: "WTI 原油", aliases: [/\bwti\b/i, /西德州原油/] },
  { header: "Crude oil, average", zh: "原油", aliases: [/crude oil/i, /原油/] },
  { header: "Natural gas, US", zh: "美国天然气", aliases: [/us natural gas/i, /美国天然气/] },
  { header: "Natural gas, Europe", zh: "欧洲天然气", aliases: [/european natural gas/i, /欧洲天然气/] },
  { header: "Coffee, Arabica", zh: "阿拉比卡咖啡", aliases: [/arabica/i, /阿拉比卡/] },
  { header: "Coffee, Robusta", zh: "罗布斯塔咖啡", aliases: [/robusta/i, /罗布斯塔/] },
  { header: "Cocoa", zh: "可可", aliases: [/\bcocoa\b/i, /可可/] },
  { header: "Maize", zh: "玉米", aliases: [/\bmaize\b/i, /\bcorn\b/i, /玉米/] },
  { header: "Wheat, US HRW", zh: "美国硬红冬麦", aliases: [/hard red winter/i, /hrw/i, /硬红冬麦/] },
  { header: "Soybeans", zh: "大豆", aliases: [/soybeans?/i, /大豆/] },
  { header: "Palm oil", zh: "棕榈油", aliases: [/palm oil/i, /棕榈油/] },
  { header: "Sugar, world", zh: "国际糖价", aliases: [/world sugar/i, /global sugar/i, /国际糖价/] },
  { header: "Cotton, A Index", zh: "棉花", aliases: [/\bcotton\b/i, /棉花/] },
  { header: "Aluminum", zh: "铝", aliases: [/aluminum/i, /aluminium/i, /铝价|铝$/] },
  { header: "Copper", zh: "铜", aliases: [/\bcopper\b/i, /铜价|铜$/] },
  { header: "Nickel", zh: "镍", aliases: [/\bnickel\b/i, /镍价|镍$/] },
  { header: "Zinc", zh: "锌", aliases: [/\bzinc\b/i, /锌价|锌$/] },
  { header: "Gold", zh: "黄金", aliases: [/\bgold\b/i, /黄金|金价/] },
  { header: "Silver", zh: "白银", aliases: [/\bsilver\b/i, /白银|银价/] },
  { header: "Platinum", zh: "铂金", aliases: [/platinum/i, /铂金|铂价/] },
];

type MonthlyDataset = {
  dataUrl: string;
  updatedLabel: string;
  headers: Record<string, string>;
  units: Record<string, string>;
  rows: Array<{ date: string; values: Record<string, number | null> }>;
};

let cachedDataset: { expiresAt: number; promise: Promise<MonthlyDataset> } | null = null;

function isWorldBankHost(hostname: string) {
  return hostname === "worldbank.org" || hostname.endsWith(".worldbank.org");
}

function findCommodities(query: string) {
  return COMMODITIES.filter((commodity) => commodity.aliases.some((alias) => alias.test(query))).slice(0, 5);
}

async function discoverDataUrl() {
  try {
    const response = await fetchWithTransientRetry(SOURCE_PAGE, {}, { timeoutMs: 10_000 });
    if (!response.ok) return FALLBACK_DATA_URL;
    const html = await response.text();
    const match = html.match(/href=["']([^"']*CMO-Historical-Data-Monthly\.xlsx[^"']*)["']/i);
    if (!match) return FALLBACK_DATA_URL;
    const url = new URL(match[1].replace(/&amp;/g, "&"), SOURCE_PAGE);
    return isWorldBankHost(url.hostname) ? url.toString() : FALLBACK_DATA_URL;
  } catch {
    return FALLBACK_DATA_URL;
  }
}

function normalizeUnit(unit: string) {
  return unit.replace(/^\(\$\//, "USD/").replace(/^\(/, "").replace(/\)$/, "");
}

async function loadDataset() {
  const dataUrl = await discoverDataUrl();
  const response = await fetchWithTransientRetry(dataUrl, {}, { timeoutMs: 20_000 });
  if (!response.ok) throw new Error(`World Bank workbook returned ${response.status}`);
  if (!isWorldBankHost(new URL(response.url).hostname)) throw new Error("World Bank workbook redirected outside the trusted host");
  const workbook = await response.arrayBuffer();
  if (workbook.byteLength > 12_000_000) throw new Error("World Bank workbook exceeded the safety limit");

  const sheet = readWorksheet(workbook, "Monthly Prices");
  const headerRow = sheet.find((row) => Object.values(row.cells).includes("Gold"));
  if (!headerRow) throw new Error("World Bank commodity headers were not found");
  const unitRow = sheet.find((row) => row.number === headerRow.number + 1);
  if (!unitRow) throw new Error("World Bank commodity units were not found");

  const headers = headerRow.cells;
  const units = unitRow.cells;
  const dataRows = sheet
    .filter((row) => /^\d{4}M\d{2}$/.test(row.cells.A ?? ""))
    .map((row) => {
      const values: Record<string, number | null> = {};
      for (const [column, header] of Object.entries(headers)) {
        if (!header) continue;
        const value = Number(row.cells[column]);
        values[header.trim()] = Number.isFinite(value) ? value : null;
      }
      return { date: row.cells.A.replace("M", "-"), values };
    });

  const updatedLabel = sheet.find((row) => /^Updated on /i.test(row.cells.A ?? ""))?.cells.A ?? "Monthly update";
  return { dataUrl, updatedLabel, headers, units, rows: dataRows };
}

function getDataset() {
  const now = Date.now();
  if (!cachedDataset || cachedDataset.expiresAt <= now) {
    const promise = loadDataset();
    cachedDataset = { expiresAt: now + 6 * 60 * 60 * 1_000, promise };
    promise.catch(() => {
      if (cachedDataset?.promise === promise) cachedDataset = null;
    });
  }
  return cachedDataset.promise;
}

function buildSummary(
  names: string[],
  rows: Array<{ date: string; values: Array<number | null> }>,
  chinese: boolean,
  calculation: "level" | "mom" | "yoy",
) {
  const facts = names.flatMap((name, index) => {
    const points = rows.flatMap((row) => row.values[index] === null ? [] : [{ date: row.date, value: row.values[index]! }]);
    if (points.length < 2) return [];
    const first = points[0];
    const last = points.at(-1)!;
    const peak = points.reduce((best, point) => point.value > best.value ? point : best);
    if (calculation !== "level") {
      const average = points.reduce((total, point) => total + point.value, 0) / points.length;
      const comparison = calculation === "mom" ? (chinese ? "环比" : "MoM") : (chinese ? "同比" : "YoY");
      return chinese
        ? [`${name}区间平均${comparison}为 ${average.toFixed(1)}%，最高值出现在 ${peak.date}（${peak.value.toFixed(1)}%）。`]
        : [`${name} averaged ${average.toFixed(1)}% ${comparison}; the high was ${peak.value.toFixed(1)}% in ${peak.date}.`];
    }
    const change = ((last.value / first.value) - 1) * 100;
    return chinese
      ? [`${name}从 ${first.date} 到 ${last.date} 变化 ${change >= 0 ? "+" : ""}${change.toFixed(1)}%，区间高点在 ${peak.date}。`]
      : [`${name} changed ${change >= 0 ? "+" : ""}${change.toFixed(1)}% from ${first.date} to ${last.date}; the period high was in ${peak.date}.`];
  });
  return facts.join(" ").slice(0, 500);
}

export const worldBankCommodityConnector: DataConnector = {
  id: "world-bank-commodity-prices",
  async tryResolve(query) {
    if (wantsUnsupportedDailyFrequency(query) || hasSubnationalGeography(query)) return null;
    const selected = findCommodities(query);
    if (!selected.length) return null;

    const dataset = await getDataset();
    const chinese = isChineseQuery(query);
    const calculation = requestedCalculation(query);
    const requestedPeriods = requestedMonthlyPeriods(query);
    const offset = calculation === "yoy" ? 12 : calculation === "mom" ? 1 : 0;
    const sourceRows = dataset.rows.slice(-(requestedPeriods + offset));
    const rows = sourceRows.slice(offset).map((row, index) => ({
      date: row.date,
      values: selected.map((commodity) => {
        const current = row.values[commodity.header] ?? null;
        if (calculation === "level") return current;
        const previous = sourceRows[index].values[commodity.header] ?? null;
        if (current === null || previous === null || previous === 0) return null;
        return ((current / previous) - 1) * 100;
      }),
    }));

    const names = selected.map((commodity) => chinese ? commodity.zh : commodity.header);
    const unitColumns = Object.entries(dataset.headers).reduce<Record<string, string>>((result, [column, header]) => {
      result[header.trim()] = normalizeUnit(dataset.units[column] ?? "");
      return result;
    }, {});
    const numericCells = rows.flatMap((row) => row.values);
    const availablePoints = numericCells.filter((value) => value !== null).length;
    const missingPoints = numericCells.length - availablePoints;
    const calculationLabel = calculation === "mom" ? (chinese ? "月度环比" : "month-over-month change")
      : calculation === "yoy" ? (chinese ? "同比变化" : "year-over-year change")
        : (chinese ? "月度价格" : "monthly prices");
    const verifiedAt = new Date().toISOString();

    return {
      message: chinese
        ? `已从世界银行官方工作簿读取并校验 ${availablePoints}/${numericCells.length} 个数据点。`
        : `Loaded and validated ${availablePoints}/${numericCells.length} observations from the official World Bank workbook.`,
      widget: {
        title: `${names.join(" vs ")} · ${calculationLabel}`,
        subtitle: `${rows[0]?.date ?? "—"} – ${rows.at(-1)?.date ?? "—"} · ${dataset.updatedLabel}`,
        visualization: "line_chart",
        columns: [
          { key: "date", label: chinese ? "月份" : "Month", dataType: "date", unit: null },
          ...selected.map((commodity, index) => ({
            key: `series_${index + 1}`,
            label: names[index],
            dataType: "number" as const,
            unit: calculation === "level" ? (unitColumns[commodity.header] || null) : "%",
          })),
        ],
        rows: rows.map((row) => ({ cells: [row.date, ...row.values.map((value) => toFixedCell(value))] })),
        summary: buildSummary(names, rows, chinese, calculation),
        sources: [
          { title: "World Bank Commodity Markets", url: SOURCE_PAGE },
          { title: "Pink Sheet monthly workbook", url: dataset.dataUrl },
        ],
        dataQuality: {
          method: "official_connector",
          sourceName: "World Bank Pink Sheet",
          requestedPoints: numericCells.length,
          availablePoints,
          missingPoints,
          coverageStart: rows[0]?.date ?? null,
          coverageEnd: rows.at(-1)?.date ?? null,
          frequency: "monthly",
          verifiedAt,
        },
      },
    };
  },
};
