import type { DataConnector } from "./types";
import { strFromU8, unzipSync } from "fflate";
import { hasSubnationalGeography } from "./query-capabilities";
import { fetchWithTransientRetry } from "./http";
import {
  isChineseQuery,
  requestedAnnualPeriods,
  requestedCalculation,
  requestsMonthlyOrQuarterlyFrequency,
  toFixedCell,
  wantsUnsupportedDailyFrequency,
} from "./query-utils";

type Indicator = {
  id: string;
  label: string;
  zh: string;
  unit: string;
  decimals: number;
  aliases: RegExp[];
  forceLevel?: boolean;
};

const INDICATORS: Indicator[] = [
  { id: "NY.GDP.MKTP.KD.ZG", label: "Real GDP growth", zh: "实际 GDP 增长率", unit: "%", decimals: 2, aliases: [/real gdp growth/i, /gdp growth/i, /经济增长率|GDP 增长|GDP增速/], forceLevel: true },
  { id: "NY.GDP.PCAP.CD", label: "GDP per capita", zh: "人均 GDP", unit: "current USD/person", decimals: 0, aliases: [/gdp per capita/i, /人均\s*gdp/i] },
  { id: "NY.GDP.MKTP.CD", label: "GDP", zh: "GDP", unit: "current USD", decimals: 0, aliases: [/gross domestic product/i, /\bgdp\b/i, /国内生产总值/] },
  { id: "FP.CPI.TOTL.ZG", label: "Consumer-price inflation", zh: "消费者价格通胀率", unit: "%", decimals: 2, aliases: [/consumer price inflation/i, /inflation rate/i, /\binflation\b/i, /通胀率|通货膨胀/], forceLevel: true },
  { id: "SL.UEM.TOTL.ZS", label: "Unemployment rate", zh: "失业率", unit: "% of labour force", decimals: 2, aliases: [/unemployment rate/i, /失业率/], forceLevel: true },
  { id: "SM.POP.NETM", label: "Net migration", zh: "净移民", unit: "persons", decimals: 0, aliases: [/net (?:international )?migration/i, /净(?:国际)?移民/], forceLevel: true },
  { id: "SP.POP.TOTL", label: "Population", zh: "人口", unit: "persons", decimals: 0, aliases: [/\bpopulation\b/i, /人口/] },
  { id: "SP.DYN.LE00.IN", label: "Life expectancy at birth", zh: "出生时预期寿命", unit: "years", decimals: 1, aliases: [/life expectancy/i, /预期寿命|平均寿命/] },
  { id: "EN.ATM.CO2E.PC", label: "CO₂ emissions per capita", zh: "人均二氧化碳排放", unit: "t/person", decimals: 2, aliases: [/co2 emissions? per capita/i, /carbon emissions? per capita/i, /人均.*(?:碳|二氧化碳).*排放/] },
  { id: "NE.TRD.GNFS.ZS", label: "Trade openness", zh: "贸易开放度", unit: "% of GDP", decimals: 2, aliases: [/trade.*(?:percent|%|share).*gdp/i, /trade openness/i, /贸易.*gdp|贸易开放度/] },
  { id: "GC.DOD.TOTL.GD.ZS", label: "Central government debt", zh: "中央政府债务", unit: "% of GDP", decimals: 2, aliases: [/government debt/i, /public debt/i, /政府债务|公共债务/] },
  { id: "IT.NET.USER.ZS", label: "Internet use", zh: "互联网使用率", unit: "% of population", decimals: 1, aliases: [/internet users?/i, /internet use/i, /互联网使用率|网民比例/] },
  { id: "SP.DYN.TFRT.IN", label: "Fertility rate", zh: "总和生育率", unit: "births/woman", decimals: 2, aliases: [/fertility rate/i, /生育率/] },
];

type Country = { code: string; label: string; zh: string; aliases: RegExp[] };

const COUNTRIES: Country[] = [
  { code: "CAN", label: "Canada", zh: "加拿大", aliases: [/\bcanada\b/i, /\bcanadian\b/i, /加拿大/] },
  { code: "USA", label: "United States", zh: "美国", aliases: [/united states/i, /\bu\.?s\.?a?\b/i, /美国/] },
  { code: "CHN", label: "China", zh: "中国", aliases: [/\bchina\b/i, /中国/] },
  { code: "GBR", label: "United Kingdom", zh: "英国", aliases: [/united kingdom/i, /\bu\.?k\.?\b/i, /英国/] },
  { code: "DEU", label: "Germany", zh: "德国", aliases: [/\bgermany\b/i, /德国/] },
  { code: "FRA", label: "France", zh: "法国", aliases: [/\bfrance\b/i, /法国/] },
  { code: "JPN", label: "Japan", zh: "日本", aliases: [/\bjapan\b/i, /日本/] },
  { code: "KOR", label: "South Korea", zh: "韩国", aliases: [/south korea/i, /\bkorea\b/i, /韩国/] },
  { code: "IND", label: "India", zh: "印度", aliases: [/\bindia\b/i, /印度/] },
  { code: "AUS", label: "Australia", zh: "澳大利亚", aliases: [/\baustralia\b/i, /澳大利亚|澳洲/] },
  { code: "NZL", label: "New Zealand", zh: "新西兰", aliases: [/new zealand/i, /新西兰/] },
  { code: "BRA", label: "Brazil", zh: "巴西", aliases: [/\bbrazil\b/i, /巴西/] },
  { code: "MEX", label: "Mexico", zh: "墨西哥", aliases: [/\bmexico\b/i, /墨西哥/] },
  { code: "CHE", label: "Switzerland", zh: "瑞士", aliases: [/\bswitzerland\b/i, /瑞士/] },
  { code: "NOR", label: "Norway", zh: "挪威", aliases: [/\bnorway\b/i, /挪威/] },
  { code: "SWE", label: "Sweden", zh: "瑞典", aliases: [/\bsweden\b/i, /瑞典/] },
  { code: "WLD", label: "World", zh: "全球", aliases: [/\bworld\b(?!\s+bank)/i, /\bglobal\b/i, /全球|世界/] },
  { code: "EUU", label: "European Union", zh: "欧盟", aliases: [/european union/i, /\beu\b/i, /欧盟/] },
];

type ApiPoint = {
  countryiso3code?: string;
  date?: string;
  value?: number | null;
};

type ApiMetadata = { lastupdated?: string };

type IndicatorPayload = { metadata: ApiMetadata; points: ApiPoint[]; retrievalUrl: string };

const downloadCache = new Map<string, { expiresAt: number; promise: Promise<IndicatorPayload> }>();

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}

async function downloadIndicatorCsv(indicatorId: string, countryCodes: Set<string>): Promise<IndicatorPayload> {
  const dataUrl = `https://api.worldbank.org/v2/en/indicator/${indicatorId}?downloadformat=csv`;
  const cached = downloadCache.get(indicatorId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = (async () => {
    const response = await fetchWithTransientRetry(dataUrl, {}, { timeoutMs: 25_000 });
    if (!response.ok) throw new Error(`World Bank indicator download returned ${response.status}`);
    const archive = await response.arrayBuffer();
    if (archive.byteLength > 5_000_000) throw new Error("World Bank indicator download exceeded the safety limit");
    const files = unzipSync(new Uint8Array(archive));
    const dataEntry = Object.entries(files).find(([name]) =>
      name.startsWith(`API_${indicatorId}_`) && name.toLowerCase().endsWith(".csv") && !name.startsWith("Metadata_"),
    );
    if (!dataEntry) throw new Error("World Bank indicator CSV was not found in the download");
    const lines = strFromU8(dataEntry[1]).replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    const updated = lines.find((line) => line.startsWith('"Last Updated Date"'));
    const headerIndex = lines.findIndex((line) => line.startsWith('"Country Name","Country Code"'));
    if (headerIndex < 0) throw new Error("World Bank indicator CSV headers were not found");
    const headers = parseCsvLine(lines[headerIndex]);
    const points: ApiPoint[] = [];
    for (const line of lines.slice(headerIndex + 1)) {
      const cells = parseCsvLine(line);
      const countryCode = cells[1];
      if (!countryCodes.has(countryCode)) continue;
      headers.slice(4).forEach((year, offset) => {
        const raw = cells[offset + 4]?.trim() ?? "";
        const value = raw === "" ? null : Number(raw);
        points.push({
          countryiso3code: countryCode,
          date: year,
          value: value !== null && Number.isFinite(value) ? value : null,
        });
      });
    }
    return {
      metadata: { lastupdated: updated ? parseCsvLine(updated)[1] : undefined },
      points,
      retrievalUrl: dataUrl,
    };
  })();
  downloadCache.set(indicatorId, { expiresAt: Date.now() + 6 * 60 * 60 * 1_000, promise });
  try {
    return await promise;
  } catch (error) {
    downloadCache.delete(indicatorId);
    throw error;
  }
}

function selectCountries(query: string) {
  const selected = COUNTRIES.filter((country) => country.aliases.some((alias) => alias.test(query)));
  return selected.slice(0, 5);
}

function formatValue(value: number | null, decimals: number) {
  if (value === null) return "";
  return toFixedCell(value, decimals);
}

function buildSummary(labels: string[], rows: Array<{ year: string; values: Array<number | null> }>, chinese: boolean) {
  return labels.flatMap((label, index) => {
    const points = rows.flatMap((row) => row.values[index] === null ? [] : [{ year: row.year, value: row.values[index]! }]);
    if (points.length < 2) return [];
    const first = points[0];
    const last = points.at(-1)!;
    const change = first.value === 0 ? null : ((last.value / first.value) - 1) * 100;
    if (change === null) return [];
    return chinese
      ? [`${label}从 ${first.year} 到 ${last.year} 变化 ${change >= 0 ? "+" : ""}${change.toFixed(1)}%。`]
      : [`${label} changed ${change >= 0 ? "+" : ""}${change.toFixed(1)}% from ${first.year} to ${last.year}.`];
  }).join(" ").slice(0, 500);
}

export const worldBankIndicatorsConnector: DataConnector = {
  id: "world-bank-indicators-api",
  async tryResolve(query) {
    if (wantsUnsupportedDailyFrequency(query) || requestsMonthlyOrQuarterlyFrequency(query) || hasSubnationalGeography(query)) return null;
    const indicator = INDICATORS.find((candidate) => candidate.aliases.some((alias) => alias.test(query)));
    if (!indicator) return null;
    const countries = selectCountries(query);
    if (!countries.length) return null;

    const chinese = isChineseQuery(query);
    const periods = requestedAnnualPeriods(query);
    const currentYear = new Date().getUTCFullYear();
    const startYear = currentYear - periods - 4;
    const url = new URL(`https://api.worldbank.org/v2/country/${countries.map((country) => country.code).join(";")}/indicator/${indicator.id}`);
    url.searchParams.set("format", "json");
    url.searchParams.set("date", `${startYear}:${currentYear}`);
    url.searchParams.set("per_page", String(Math.max(100, periods * countries.length + 20)));

    let metadata: ApiMetadata;
    let points: ApiPoint[];
    let retrievalUrl = url.toString();
    if (indicator.id === "SM.POP.NETM") {
      const downloaded = await downloadIndicatorCsv(indicator.id, new Set(countries.map((country) => country.code)));
      metadata = downloaded.metadata;
      points = downloaded.points;
      retrievalUrl = downloaded.retrievalUrl;
    } else {
      const response = await fetchWithTransientRetry(url, {}, { timeoutMs: 15_000 });
      if (!response.ok) throw new Error(`World Bank Indicators API returned ${response.status}`);
      const payload = await response.json() as [ApiMetadata, ApiPoint[]] | { message?: unknown };
      if (!Array.isArray(payload) || !Array.isArray(payload[1])) throw new Error("World Bank Indicators API returned an invalid payload");
      metadata = payload[0];
      points = payload[1];
    }

    const rawByCountry = new Map<string, Map<string, number | null>>();
    for (const country of countries) rawByCountry.set(country.code, new Map());
    for (const point of points) {
      if (!point.countryiso3code || !point.date || !rawByCountry.has(point.countryiso3code)) continue;
      const value = typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null;
      rawByCountry.get(point.countryiso3code)!.set(point.date, value);
    }

    const years = Array.from(new Set(points.flatMap((point) => point.date ? [point.date] : []))).sort();
    const calculation = indicator.forceLevel ? "level" as const : requestedCalculation(query);
    const rawRows = years.map((year) => ({
      year,
      values: countries.map((country) => rawByCountry.get(country.code)?.get(year) ?? null),
    }));
    const rows = rawRows.slice(calculation === "level" ? 0 : 1).map((row, index) => ({
      year: row.year,
      values: row.values.map((current, seriesIndex) => {
        if (calculation === "level") return current;
        const previous = rawRows[index]?.values[seriesIndex] ?? null;
        if (current === null || previous === null || previous === 0) return null;
        return ((current / previous) - 1) * 100;
      }),
    })).filter((row) => row.values.some((value) => value !== null)).slice(-periods);
    if (rows.length < 2) return null;

    const labels = countries.map((country) => chinese ? country.zh : country.label);
    const numericCells = rows.flatMap((row) => row.values);
    const availablePoints = numericCells.filter((value) => value !== null).length;
    const missingPoints = numericCells.length - availablePoints;
    const calculationLabel = calculation === "level" ? "" : (chinese ? " · 年度变化" : " · annual change");
    const sourceName = indicator.id === "SM.POP.NETM"
      ? "World Bank Indicators downloadable CSV"
      : "World Bank Indicators API";

    return {
      message: chinese
        ? `已通过${sourceName}校验 ${availablePoints}/${numericCells.length} 个年度数据点；本次不使用模型或网页搜索。`
        : `Validated ${availablePoints}/${numericCells.length} annual observations through the ${sourceName} with no model or Web Search call.`,
      widget: {
        title: `${chinese ? indicator.zh : indicator.label}${calculationLabel}`,
        subtitle: `${rows[0].year} – ${rows.at(-1)!.year} · ${indicator.id}${metadata.lastupdated ? ` · updated ${metadata.lastupdated}` : ""}`,
        visualization: "line_chart",
        columns: [
          { key: "year", label: chinese ? "年份" : "Year", dataType: "date", unit: null },
          ...labels.map((label, index) => ({ key: `series_${index + 1}`, label, dataType: "number" as const, unit: calculation === "level" ? indicator.unit : "%" })),
        ],
        rows: rows.map((row) => ({ cells: [row.year, ...row.values.map((value) => formatValue(value, calculation === "level" ? indicator.decimals : 2))] })),
        summary: buildSummary(labels, rows, chinese),
        sources: [
          { title: `World Bank indicator ${indicator.id}`, url: `https://data.worldbank.org/indicator/${indicator.id}` },
          { title: indicator.id === "SM.POP.NETM" ? "World Bank downloadable indicator CSV" : "World Bank Indicators API", url: retrievalUrl },
        ],
        dataQuality: {
          method: "official_connector",
          sourceName,
          requestedPoints: numericCells.length,
          availablePoints,
          missingPoints,
          coverageStart: rows[0].year,
          coverageEnd: rows.at(-1)!.year,
          frequency: "annual",
          verifiedAt: new Date().toISOString(),
        },
      },
    };
  },
};
