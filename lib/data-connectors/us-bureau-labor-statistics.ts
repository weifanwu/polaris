import type { DataConnector } from "./types";
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
};

const SERIES: SeriesDefinition[] = [
  { id: "CUSR0000SA0L1E", label: "U.S. core CPI", zh: "美国核心 CPI", unit: "index (1982-84=100)", decimals: 3, aliases: [/core cpi/i, /核心\s*cpi|核心通胀/] },
  { id: "CUSR0000SA0", label: "U.S. CPI", zh: "美国 CPI", unit: "index (1982-84=100)", decimals: 3, aliases: [/consumer price index/i, /\bcpi\b/i, /inflation/i, /消费者?物价指数|消费价格指数|通胀/] },
  { id: "LNS14000000", label: "U.S. unemployment rate", zh: "美国失业率", unit: "%", decimals: 1, aliases: [/unemployment rate/i, /失业率/], forceLevel: true },
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

export const usBureauLaborStatisticsConnector: DataConnector = {
  id: "us-bls-public-data-api",
  async tryResolve(query) {
    if (wantsUnsupportedDailyFrequency(query)) return null;
    if (!/(united states|\bu\.?s\.?a?\b|american|美国)/i.test(query)) return null;
    if (/(canada|canadian|加拿大|中国|china|英国|united kingdom|日本|japan)/i.test(query)) return null;
    const series = SERIES.find((candidate) => candidate.aliases.some((alias) => alias.test(query)));
    if (!series) return null;

    const chinese = isChineseQuery(query);
    const periods = requestedMonthlyPeriods(query);
    const endYear = new Date().getUTCFullYear();
    const startYear = Math.max(endYear - 10, endYear - Math.ceil(periods / 12) - 1);
    const apiUrl = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seriesid: [series.id], startyear: String(startYear), endyear: String(endYear) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`BLS API returned ${response.status}`);
    const payload = await response.json() as BlsResponse;
    if (payload.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS API request failed: ${(payload.message ?? []).join(" ")}`);
    const data = payload.Results?.series?.[0]?.data ?? [];
    const rawRows = data.flatMap((datum) => {
      if (!datum.year || !/^M(0[1-9]|1[0-2])$/.test(datum.period ?? "")) return [];
      const value = Number(datum.value);
      return [{ date: `${datum.year}-${datum.period!.slice(1)}`, value: Number.isFinite(value) ? value : null }];
    }).sort((a, b) => a.date.localeCompare(b.date));

    let calculation = series.forceLevel ? "level" as const : requestedCalculation(query);
    if (series.id.includes("CPI") || series.id.startsWith("CU")) {
      if (calculation === "level" && /(inflation|通胀|涨幅)/i.test(query)) calculation = "yoy";
    }
    const offset = calculation === "yoy" ? 12 : calculation === "mom" ? 1 : 0;
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
      message: chinese
        ? `已通过美国劳工统计局公开 API 校验 ${availablePoints}/${rows.length} 个数据点；本次不使用模型或网页搜索。`
        : `Validated ${availablePoints}/${rows.length} observations through the U.S. BLS Public Data API with no model or Web Search call.`,
      widget: {
        title: `${label}${calculation === "level" ? "" : calculation === "mom" ? " · MoM" : " · YoY"}`,
        subtitle: `${rows[0].date} – ${rows.at(-1)!.date} · ${series.id} · seasonally adjusted`,
        visualization: "line_chart",
        columns: [
          { key: "date", label: chinese ? "月份" : "Month", dataType: "date", unit: null },
          { key: "value", label, dataType: "number", unit: calculation === "level" ? series.unit : "%" },
        ],
        rows: rows.map((row) => ({ cells: [row.date, toFixedCell(row.value, calculation === "level" ? series.decimals : 2)] })),
        summary,
        sources: [
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
          verifiedAt: new Date().toISOString(),
        },
      },
    };
  },
};
