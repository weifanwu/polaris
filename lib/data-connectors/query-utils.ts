const NUMBER_WORDS: Record<string, number> = {
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function parseCount(value: string) {
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  if (value === "十") return 10;
  const [tens, ones] = value.split("十");
  if (value.includes("十")) {
    return (NUMBER_WORDS[tens] ?? 1) * 10 + (NUMBER_WORDS[ones] ?? 0);
  }
  return NUMBER_WORDS[value] ?? Number.NaN;
}

export function requestedMonthlyPeriods(query: string, fallback = 24) {
  const months = query.match(/(?:过去|最近|近|last|past)\s*([一二两三四五六七八九十\d]+)\s*(?:个?月|months?)/i);
  if (months) return Math.min(Math.max(parseCount(months[1]), 2), 120);

  const years = query.match(/(?:过去|最近|近|last|past)\s*([一二两三四五六七八九十\d]+)\s*(?:年|years?)/i);
  if (years) return Math.min(Math.max(parseCount(years[1]) * 12, 2), 120);

  return fallback;
}

export function requestedDailyPeriods(query: string, fallback = 30) {
  const days = query.match(/(?:过去|最近|近|last|past)\s*([一二两三四五六七八九十\d]+)\s*(?:个?(?:交易)?日|天|(?:trading )?days?)/i);
  if (days) return Math.min(Math.max(parseCount(days[1]), 2), 120);
  return fallback;
}

export function requestedQuarterlyPeriods(query: string, fallback = 20) {
  const quarters = query.match(/(?:过去|最近|近|last|past)\s*([一二两三四五六七八九十\d]+)\s*(?:个?季度|quarters?)/i);
  if (quarters) return Math.min(Math.max(parseCount(quarters[1]), 2), 120);

  const years = query.match(/(?:过去|最近|近|last|past)\s*([一二两三四五六七八九十\d]+)\s*(?:年|years?)/i);
  if (years) return Math.min(Math.max(parseCount(years[1]) * 4, 2), 120);

  return fallback;
}

export function requestedAnnualPeriods(query: string, fallback = 10) {
  const years = query.match(/(?:过去|最近|近|last|past)\s*([一二两三四五六七八九十\d]+)\s*(?:年|years?)/i);
  if (years) return Math.min(Math.max(parseCount(years[1]), 2), 60);
  return fallback;
}

export function requestedCalculation(query: string) {
  if (/(环比|month.?over.?month|\bmom\b)/i.test(query)) return "mom" as const;
  if (/(同比|year.?over.?year|\byoy\b)/i.test(query)) return "yoy" as const;
  return "level" as const;
}

export function wantsUnsupportedDailyFrequency(query: string) {
  return /(逐日|每天|每日|交易日|收盘价|intraday|daily|trading days?|close price)/i.test(query);
}

export function requestsMonthlyOrQuarterlyFrequency(query: string) {
  return /(每月|逐月|月度|个?月|环比|每季|季度|monthly|months?|month.?over.?month|quarterly|quarters?|quarter.?over.?quarter|\bmom\b|\bqoq\b)/i.test(query);
}

export function isChineseQuery(query: string) {
  return /[\u3400-\u9fff]/.test(query);
}

export function toFixedCell(value: number | null, decimals = 2) {
  if (value === null || !Number.isFinite(value)) return "";
  return Number(value.toFixed(decimals)).toString();
}
