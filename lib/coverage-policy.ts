export type CoverageFrequency = "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "mixed" | "unknown";

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

const COUNT = "([一二两三四五六七八九十\\d]+)";

function relativeCount(query: string, units: string) {
  const match = query.match(new RegExp(`(?:过去|最近|近|last|past)\\s*${COUNT}\\s*(?:${units})`, "i"));
  if (!match) return null;
  const count = parseCount(match[1]);
  return Number.isFinite(count) && count > 0 ? count : null;
}

function explicitMonthCount(query: string) {
  const match = query.match(new RegExp(`${COUNT}\\s*(?:个月|months?)`, "i"));
  if (!match) return null;
  const count = parseCount(match[1]);
  return Number.isFinite(count) && count > 0 ? count : null;
}

export function requestedPeriodTarget(query: string, frequency: CoverageFrequency) {
  const months = explicitMonthCount(query) ?? relativeCount(query, "个?月|months?");
  if (frequency === "monthly" || (frequency === "unknown" && months !== null)) {
    if (months !== null) return Math.min(months, 300);
    const years = relativeCount(query, "年|years?");
    return years === null ? null : Math.min(years * 12, 300);
  }

  if (frequency === "quarterly") {
    const quarters = relativeCount(query, "个?季度|quarters?");
    if (quarters !== null) return Math.min(quarters, 120);
    const years = relativeCount(query, "年|years?");
    return years === null ? null : Math.min(years * 4, 120);
  }

  if (frequency === "annual") {
    const years = relativeCount(query, "年|years?");
    return years === null ? null : Math.min(years, 60);
  }

  if (frequency === "daily") {
    const days = relativeCount(query, "个?(?:交易)?日|天|(?:trading )?days?");
    return days === null ? null : Math.min(days, 120);
  }

  if (frequency === "weekly") {
    const weeks = relativeCount(query, "周|weeks?");
    return weeks === null ? null : Math.min(weeks, 300);
  }

  return null;
}

export function evaluateRequestedCoverage(input: {
  query: string;
  frequency: CoverageFrequency;
  seriesCount: number;
  observedPeriods: number;
  availablePoints: number;
  allowPartialData: boolean;
}) {
  const targetPeriods = requestedPeriodTarget(input.query, input.frequency);
  const boundedSeriesCount = Math.max(1, input.seriesCount);
  if (targetPeriods === null) {
    return {
      targetPeriods: null,
      requestedPoints: Math.max(input.availablePoints, input.observedPeriods * boundedSeriesCount),
      minimumPeriods: 2,
      minimumPoints: 2,
      sufficient: input.observedPeriods >= 2 && input.availablePoints >= 2,
    };
  }

  const requestedPoints = targetPeriods * boundedSeriesCount;
  const ratio = input.allowPartialData ? 0.5 : 1;
  const minimumPeriods = Math.max(2, Math.ceil(targetPeriods * ratio));
  const minimumPoints = Math.max(2, Math.ceil(requestedPoints * ratio));
  return {
    targetPeriods,
    requestedPoints,
    minimumPeriods,
    minimumPoints,
    sufficient: input.observedPeriods >= minimumPeriods && input.availablePoints >= minimumPoints,
  };
}
