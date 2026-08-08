import type { DataConnector } from "./types";
import {
  isChineseQuery,
  requestedDailyPeriods,
  requestedMonthlyPeriods,
  toFixedCell,
  wantsUnsupportedDailyFrequency,
} from "./query-utils";

const SERIES = [
  { id: "V39079", label: "Policy interest rate", zh: "加拿大政策利率", unit: "%", aliases: [/policy (?:interest )?rate/i, /overnight rate/i, /政策利率|隔夜利率/] },
  { id: "BR.CDN", label: "Bank Rate", zh: "加拿大银行利率", unit: "%", aliases: [/\bbank rate\b/i, /银行利率/] },
  { id: "AVG.INTWO", label: "CORRA", zh: "加拿大隔夜回购利率 CORRA", unit: "%", aliases: [/\bcorra\b/i, /隔夜回购利率/] },
  { id: "V80691311", label: "Prime rate", zh: "加拿大最优惠利率", unit: "%", aliases: [/\bprime rate\b/i, /最优惠利率/] },
  { id: "V80691335", label: "5-year posted mortgage rate", zh: "五年期挂牌房贷利率", unit: "%", aliases: [/5.?year.*mortgage rate/i, /五年期.*房贷利率|5年期.*房贷利率/] },
  { id: "BROKER_AVERAGE_5YR_VRM", label: "Estimated variable mortgage rate", zh: "估算浮动房贷利率", unit: "%", aliases: [/variable mortgage rate/i, /浮动房贷利率|浮动按揭利率/] },
  { id: "BD.CDN.2YR.DQ.YLD", label: "Canada 2-year bond yield", zh: "加拿大 2 年期国债收益率", unit: "%", aliases: [/2.?year.*(?:canada|government).*bond yield/i, /canada.*2.?year.*yield/i, /2年期.*(?:国债|债券).*收益率/] },
  { id: "BD.CDN.5YR.DQ.YLD", label: "Canada 5-year bond yield", zh: "加拿大 5 年期国债收益率", unit: "%", aliases: [/5.?year.*(?:canada|government).*bond yield/i, /canada.*5.?year.*yield/i, /5年期.*(?:国债|债券).*收益率/] },
  { id: "BD.CDN.10YR.DQ.YLD", label: "Canada 10-year bond yield", zh: "加拿大 10 年期国债收益率", unit: "%", aliases: [/10.?year.*(?:canada|government).*bond yield/i, /canada.*10.?year.*yield/i, /10年期.*(?:国债|债券).*收益率/] },
  { id: "BD.CDN.LONG.DQ.YLD", label: "Canada long-term bond yield", zh: "加拿大长期国债收益率", unit: "%", aliases: [/long.?term.*(?:canada|government).*bond yield/i, /长期.*(?:国债|债券).*收益率/] },
  { id: "FXUSDCAD", label: "USD/CAD", zh: "美元兑加元", unit: "CAD per USD", aliases: [/usd.?cad/i, /美元兑加元/] },
  { id: "FXEURCAD", label: "EUR/CAD", zh: "欧元兑加元", unit: "CAD per EUR", aliases: [/eur.?cad/i, /欧元兑加元/] },
  { id: "FXGBPCAD", label: "GBP/CAD", zh: "英镑兑加元", unit: "CAD per GBP", aliases: [/gbp.?cad/i, /英镑兑加元/] },
  { id: "FXAUDCAD", label: "AUD/CAD", zh: "澳元兑加元", unit: "CAD per AUD", aliases: [/aud.?cad/i, /澳元兑加元/] },
  { id: "FXJPYCAD", label: "JPY/CAD", zh: "日元兑加元", unit: "CAD per JPY", aliases: [/jpy.?cad/i, /日元兑加元/] },
  { id: "FXCNYCAD", label: "CNY/CAD", zh: "人民币兑加元", unit: "CAD per CNY", aliases: [/cny.?cad/i, /人民币兑加元/] },
];

type ValetResponse = {
  observations?: Array<Record<string, { v?: string } | string>>;
};

export const bankOfCanadaConnector: DataConnector = {
  id: "bank-of-canada-valet",
  async tryResolve(query) {
    const selected = SERIES.filter((series) => series.aliases.some((alias) => alias.test(query))).slice(0, 4);
    if (!selected.length) return null;

    const chinese = isChineseQuery(query);
    const daily = wantsUnsupportedDailyFrequency(query);
    const periods = daily ? requestedDailyPeriods(query) : requestedMonthlyPeriods(query);
    const end = new Date();
    const start = new Date(end);
    if (daily) start.setUTCDate(start.getUTCDate() - Math.min(periods, 120) * 2);
    else start.setUTCMonth(start.getUTCMonth() - periods - 1);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    const url = new URL(`https://www.bankofcanada.ca/valet/observations/${selected.map((series) => series.id).join(",")}/json`);
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Bank of Canada Valet returned ${response.status}`);
    const payload = await response.json() as ValetResponse;
    const rawRows = (payload.observations ?? []).map((observation) => ({
      date: String(observation.d ?? ""),
      values: selected.map((series) => {
        const entry = observation[series.id];
        const value = typeof entry === "object" && entry ? Number(entry.v) : Number.NaN;
        return Number.isFinite(value) ? value : null;
      }),
    })).filter((row) => row.date);

    const rows = daily
      ? rawRows.slice(-Math.min(periods, 120))
      : Array.from(rawRows.reduce((months, row) => months.set(row.date.slice(0, 7), row), new Map<string, typeof rawRows[number]>()).values()).slice(-periods);
    if (rows.length < 2) return null;

    const numericCells = rows.flatMap((row) => row.values);
    const availablePoints = numericCells.filter((value) => value !== null).length;
    const missingPoints = numericCells.length - availablePoints;
    const labels = selected.map((series) => chinese ? series.zh : series.label);
    const sourceUrl = "https://www.bankofcanada.ca/valet-api-how-to/";
    const verifiedAt = new Date().toISOString();

    return {
      message: chinese
        ? `已通过加拿大央行 Valet API 校验 ${availablePoints}/${numericCells.length} 个数据点。`
        : `Validated ${availablePoints}/${numericCells.length} observations through the Bank of Canada Valet API.`,
      widget: {
        title: labels.join(" vs "),
        subtitle: `${rows[0].date} – ${rows.at(-1)!.date} · ${daily ? "daily" : "monthly last observation"}`,
        visualization: "line_chart",
        columns: [
          { key: "date", label: chinese ? "日期" : "Date", dataType: "date", unit: null },
          ...selected.map((series, index) => ({
            key: `series_${index + 1}`,
            label: labels[index],
            dataType: "number" as const,
            unit: series.unit,
          })),
        ],
        rows: rows.map((row) => ({ cells: [row.date, ...row.values.map((value) => toFixedCell(value, 4))] })),
        summary: chinese
          ? `数据直接来自加拿大央行，无需网页摘录；${daily ? "按日" : "按每月最后一个可用观测值"}对齐。`
          : `Direct Bank of Canada observations, aligned ${daily ? "daily" : "to the last available observation in each month"}.`,
        sources: [
          { title: "Bank of Canada Valet API", url: sourceUrl },
          { title: "Valet observations", url: url.toString() },
        ],
        dataQuality: {
          method: "official_connector",
          sourceName: "Bank of Canada Valet API",
          requestedPoints: numericCells.length,
          availablePoints,
          missingPoints,
          coverageStart: rows[0].date,
          coverageEnd: rows.at(-1)!.date,
          frequency: daily ? "daily" : "monthly",
          verifiedAt,
        },
      },
    };
  },
};
