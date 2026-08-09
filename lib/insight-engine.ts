import type { WidgetSpec } from "./widget-schema";

type Point = { period: string; value: number; rowIndex: number };

function numericValue(value: string) {
  const normalized = value.replace(/[,$%\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number, unit: string | null) {
  const absolute = Math.abs(value);
  const decimals = absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2;
  const formatted = new Intl.NumberFormat("en-CA", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(value);
  return unit === "%" ? `${formatted}%` : unit ? `${formatted} ${unit}` : formatted;
}

function signed(value: number, unit: string | null) {
  return `${value >= 0 ? "+" : ""}${formatNumber(value, unit)}`;
}

function recentOffset(frequency: string) {
  if (frequency === "monthly") return 12;
  if (frequency === "quarterly") return 4;
  if (frequency === "weekly") return 52;
  if (frequency === "daily") return 30;
  return 1;
}

function seriesPoints(widget: WidgetSpec, columnIndex: number): Point[] {
  return widget.rows.flatMap((row, rowIndex) => {
    if (row.cellStatus?.[columnIndex] === "unverified") return [];
    const value = numericValue(row.cells[columnIndex] ?? "");
    return value === null ? [] : [{
      period: row.cells[0] || String(rowIndex + 1),
      value,
      rowIndex,
    }];
  });
}

function periodsAreAdjacent(from: string, to: string, frequency: string) {
  if (frequency === "monthly") {
    const left = from.match(/^(\d{4})-(\d{2})$/);
    const right = to.match(/^(\d{4})-(\d{2})$/);
    if (!left || !right) return false;
    return Number(right[1]) * 12 + Number(right[2]) - (Number(left[1]) * 12 + Number(left[2])) === 1;
  }
  if (frequency === "quarterly") {
    const left = from.match(/^(\d{4})-?Q([1-4])$/i);
    const right = to.match(/^(\d{4})-?Q([1-4])$/i);
    if (!left || !right) return false;
    return Number(right[1]) * 4 + Number(right[2]) - (Number(left[1]) * 4 + Number(left[2])) === 1;
  }
  return true;
}

function periodBefore(period: string, frequency: string, offset: number) {
  if (frequency === "monthly") {
    const match = period.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const absolute = Number(match[1]) * 12 + Number(match[2]) - 1 - offset;
    return `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, "0")}`;
  }
  if (frequency === "quarterly") {
    const match = period.match(/^(\d{4})-?Q([1-4])$/i);
    if (!match) return null;
    const absolute = Number(match[1]) * 4 + Number(match[2]) - 1 - offset;
    return `${Math.floor(absolute / 4)}-Q${(absolute % 4) + 1}`;
  }
  return null;
}

function largestMove(points: Point[], frequency: string) {
  let result: { from: Point; to: Point; change: number } | null = null;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].rowIndex - points[index - 1].rowIndex !== 1
      || !periodsAreAdjacent(points[index - 1].period, points[index].period, frequency)) continue;
    const change = points[index].value - points[index - 1].value;
    if (!result || Math.abs(change) > Math.abs(result.change)) {
      result = { from: points[index - 1], to: points[index], change };
    }
  }
  return result;
}

function cleanExisting(summary: string) {
  return summary.replace(/\s+/g, " ").trim();
}

/**
 * Produces reproducible, decision-grade observations from the rendered rows.
 * It deliberately avoids causal claims: causes require separate sourced evidence.
 */
export function buildWidgetInsights(widget: WidgetSpec, existingSummary = widget.summary) {
  const chinese = /[\u3400-\u9fff]/.test(`${widget.originalQuery} ${widget.title}`);
  const numericColumns = widget.columns.flatMap((column, index) =>
    index > 0 && column.dataType === "number" ? [{ column, index }] : [],
  );
  if (!numericColumns.length) return cleanExisting(existingSummary).slice(0, 1_600);

  const frequency = widget.dataQuality?.frequency ?? "unknown";
  const offset = recentOffset(frequency);
  const observedSeries = numericColumns.map(({ column, index }) => ({
    column,
    index,
    points: seriesPoints(widget, index),
  })).filter((series) => series.points.length > 0);
  if (!observedSeries.length) return cleanExisting(existingSummary).slice(0, 1_600);

  const signalParts = observedSeries.slice(0, 3).flatMap(({ column, points }) => {
    if (points.length < 2) return [];
    const first = points[0];
    const latest = points.at(-1)!;
    const delta = latest.value - first.value;
    const percent = first.value === 0 ? null : (delta / Math.abs(first.value)) * 100;
    if (chinese) {
      return [`${column.label} 最新为 ${formatNumber(latest.value, column.unit)}（${latest.period}），较 ${first.period} ${signed(delta, column.unit)}${percent === null ? "" : `，相对变化 ${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`}`];
    }
    return [`${column.label} is ${formatNumber(latest.value, column.unit)} in ${latest.period}, ${signed(delta, column.unit)} from ${first.period}${percent === null ? "" : ` (${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%)`}`];
  });

  const primary = observedSeries[0];
  const primaryMin = primary.points.reduce((best, point) => point.value < best.value ? point : best);
  const primaryMax = primary.points.reduce((best, point) => point.value > best.value ? point : best);
  const primaryMove = largestMove(primary.points, frequency);
  const turningParts = chinese
    ? [`${primary.column.label} 区间高点为 ${formatNumber(primaryMax.value, primary.column.unit)}（${primaryMax.period}），低点为 ${formatNumber(primaryMin.value, primary.column.unit)}（${primaryMin.period}）${primaryMove ? `；最大相邻期变化发生在 ${primaryMove.from.period}→${primaryMove.to.period}（${signed(primaryMove.change, primary.column.unit)}）` : ""}`]
    : [`${primary.column.label} ranged from ${formatNumber(primaryMin.value, primary.column.unit)} (${primaryMin.period}) to ${formatNumber(primaryMax.value, primary.column.unit)} (${primaryMax.period})${primaryMove ? `; the largest adjacent-period move was ${signed(primaryMove.change, primary.column.unit)} from ${primaryMove.from.period} to ${primaryMove.to.period}` : ""}`];

  const recentParts = observedSeries.slice(0, 3).flatMap(({ column, points }) => {
    if (points.length <= offset) return [];
    const latest = points.at(-1)!;
    const expectedPeriod = periodBefore(latest.period, frequency, offset);
    const prior = expectedPeriod
      ? points.find((point) => point.period.toUpperCase() === expectedPeriod.toUpperCase())
      : points.at(-(offset + 1));
    if (!prior) return [];
    const delta = latest.value - prior.value;
    const window = frequency === "monthly" ? (chinese ? "过去12个月" : "the last 12 months")
      : frequency === "quarterly" ? (chinese ? "过去4个季度" : "the last four quarters")
        : chinese ? "近期窗口" : "the recent window";
    return [chinese
      ? `${column.label}${window}${delta >= 0 ? "上升" : "下降"} ${formatNumber(Math.abs(delta), column.unit)}`
      : `${column.label} ${delta >= 0 ? "rose" : "fell"} ${formatNumber(Math.abs(delta), column.unit)} over ${window}`];
  });

  const latestComparable = observedSeries.flatMap(({ column, points }) => {
    const latest = points.at(-1);
    return latest ? [{ column, latest }] : [];
  });
  let comparison = "";
  const comparableUnits = new Set(latestComparable.map(({ column }) => column.unit ?? ""));
  if (latestComparable.length >= 2 && comparableUnits.size === 1) {
    const commonPeriod = widget.rows.map((row) => row.cells[0]).reverse().find((period) =>
      observedSeries.slice(0, 4).every((series) => series.points.some((point) => point.period === period)),
    );
    if (commonPeriod) {
      const values = observedSeries.slice(0, 4).map((series) => ({
        column: series.column,
        point: series.points.find((point) => point.period === commonPeriod)!,
      })).sort((left, right) => right.point.value - left.point.value);
      const leader = values[0];
      const laggard = values.at(-1)!;
      comparison = chinese
        ? `${commonPeriod} 的共同观测中，${leader.column.label}最高（${formatNumber(leader.point.value, leader.column.unit)}），较${laggard.column.label}高 ${formatNumber(leader.point.value - laggard.point.value, leader.column.unit)}。`
        : `At the latest common observation (${commonPeriod}), ${leader.column.label} was highest at ${formatNumber(leader.point.value, leader.column.unit)}, ${formatNumber(leader.point.value - laggard.point.value, leader.column.unit)} above ${laggard.column.label}.`;
    }
  }

  const quality = widget.dataQuality;
  const missing = quality?.missingPoints ?? widget.rows.reduce((total, row) =>
    total + numericColumns.filter(({ index }) => !(row.cells[index] ?? "").trim()).length, 0);
  const unverified = quality?.unverifiedPoints ?? 0;
  const qualityText = chinese
    ? `${quality?.availablePoints ?? observedSeries.reduce((sum, series) => sum + series.points.length, 0)}/${quality?.requestedPoints ?? widget.rows.length * numericColumns.length} 个数值可用${missing ? `，${missing} 个缺失` : ""}${unverified ? `，其中 ${unverified} 个为明确标注的未验证假设值` : ""}。这里只描述数据中的关联和转折，不把时间上的同时发生解释为因果。`
    : `${quality?.availablePoints ?? observedSeries.reduce((sum, series) => sum + series.points.length, 0)}/${quality?.requestedPoints ?? widget.rows.length * numericColumns.length} values are available${missing ? `, with ${missing} missing` : ""}${unverified ? ` and ${unverified} explicitly marked unverified hypotheses` : ""}. These observations describe patterns in the data and do not assign causes.`;

  const existing = cleanExisting(existingSummary);
  const lines = chinese
    ? [
      `核心信号｜${signalParts.join("；")}。`,
      `转折与幅度｜${turningParts.join("；")}。`,
      recentParts.length ? `近期动量｜${recentParts.join("；")}。` : "",
      comparison ? `横向比较｜${comparison}` : "",
      existing && !signalParts.some((part) => existing.includes(part.slice(0, 24))) ? `分析背景｜${existing}` : "",
      `数据边界｜${qualityText}`,
    ]
    : [
      `Core signal | ${signalParts.join("; ")}.`,
      `Range and turning points | ${turningParts.join("; ")}.`,
      recentParts.length ? `Recent momentum | ${recentParts.join("; ")}.` : "",
      comparison ? `Cross-series comparison | ${comparison}` : "",
      existing && !signalParts.some((part) => existing.includes(part.slice(0, 24))) ? `Analytical context | ${existing}` : "",
      `Data boundary | ${qualityText}`,
    ];

  return lines.filter(Boolean).join("\n\n").slice(0, 1_600);
}

export function enrichWidgetInsights(widget: WidgetSpec) {
  return { ...widget, summary: buildWidgetInsights(widget) };
}
