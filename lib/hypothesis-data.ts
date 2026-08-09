import type { WidgetSpec } from "./widget-schema";

const HYPOTHESIS_REQUEST = /(?:推测|估算|假设|补(?:齐|全|上)?缺失|插值|hypothesi[sz]e|estimate|infer|impute|interpolate|fill.{0,12}missing)/i;

function numericValue(value: string) {
  const normalized = value.replace(/[$£€¥,%\s,]/g, "");
  const numeric = normalized ? Number(normalized) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function decimals(value: string) {
  const match = value.trim().match(/\.(\d+)/);
  return Math.min(4, match?.[1].length ?? 0);
}

function formatHypothesis(value: number, left: string, right: string) {
  const precision = Math.max(decimals(left), decimals(right));
  return value.toFixed(precision);
}

export function requestsHypothesisData(query: string) {
  return HYPOTHESIS_REQUEST.test(query);
}

export type HypothesisApplication = {
  widget: WidgetSpec;
  requested: boolean;
  appliedPoints: number;
  method: string | null;
  note: string | null;
};

export function applyRequestedHypotheses(widget: WidgetSpec, query: string): HypothesisApplication {
  if (!requestsHypothesisData(query)) {
    return { widget, requested: false, appliedPoints: 0, method: null, note: null };
  }

  const numericIndices = widget.columns.flatMap((column, index) => column.dataType === "number" ? [index] : []);
  const totalNumericCells = widget.rows.length * numericIndices.length;
  const maximumHypotheses = Math.min(6, Math.max(2, Math.ceil(totalNumericCells * 0.05)));
  const candidates: Array<{ rowIndex: number; columnIndex: number; value: string }> = [];

  for (const columnIndex of numericIndices) {
    let rowIndex = 0;
    while (rowIndex < widget.rows.length) {
      if (widget.rows[rowIndex].cells[columnIndex]?.trim()) {
        rowIndex += 1;
        continue;
      }
      const gapStart = rowIndex;
      while (rowIndex < widget.rows.length && !widget.rows[rowIndex].cells[columnIndex]?.trim()) rowIndex += 1;
      const gapEnd = rowIndex - 1;
      const gapLength = gapEnd - gapStart + 1;
      if (gapLength > 2 || gapStart === 0 || rowIndex >= widget.rows.length) continue;

      const leftRaw = widget.rows[gapStart - 1].cells[columnIndex] ?? "";
      const rightRaw = widget.rows[rowIndex].cells[columnIndex] ?? "";
      const left = numericValue(leftRaw);
      const right = numericValue(rightRaw);
      if (left === null || right === null) continue;
      for (let offset = 1; offset <= gapLength; offset += 1) {
        const fraction = offset / (gapLength + 1);
        candidates.push({
          rowIndex: gapStart + offset - 1,
          columnIndex,
          value: formatHypothesis(left + ((right - left) * fraction), leftRaw, rightRaw),
        });
      }
    }
  }

  if (!candidates.length) {
    return {
      widget,
      requested: true,
      appliedPoints: 0,
      method: null,
      note: "No bounded internal gap had verified observations on both sides, so no hypothesis values were added.",
    };
  }
  if (candidates.length > maximumHypotheses) {
    return {
      widget,
      requested: true,
      appliedPoints: 0,
      method: null,
      note: `Found ${candidates.length} fillable gaps, above the safe limit of ${maximumHypotheses}; no hypothesis values were added.`,
    };
  }

  const rows: WidgetSpec["rows"] = widget.rows.map((row) => ({
    cells: [...row.cells],
    cellStatus: row.cells.map((cell, index) => widget.columns[index]?.dataType === "number" && !cell.trim()
      ? "missing" as const
      : "verified" as const),
  }));
  for (const candidate of candidates) {
    const row = rows[candidate.rowIndex];
    if (!row?.cellStatus) continue;
    row.cells[candidate.columnIndex] = candidate.value;
    row.cellStatus[candidate.columnIndex] = "unverified";
  }

  const method = "Linear interpolation between the immediately surrounding observed values; maximum two consecutive missing periods and six or 5% of numeric cells.";
  const annotation = `${candidates.length} unverified hypothesis point${candidates.length === 1 ? "" : "s"} marked H`;
  const subtitle = `${widget.subtitle}${widget.subtitle ? " · " : ""}${annotation}`.slice(0, 220);
  const summary = `${widget.summary}${widget.summary ? " " : ""}${annotation}. ${method}`.slice(0, 500);
  return {
    widget: { ...widget, rows, subtitle, summary },
    requested: true,
    appliedPoints: candidates.length,
    method,
    note: `${annotation}; observed values were not changed.`,
  };
}
