import type { WidgetSpec } from "@/types";

export function DataTable({ widget }: { widget: WidgetSpec }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {widget.columns.map((column) => (
              <th key={column.key}>
                {column.label}
                {column.unit ? <span>{column.unit}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {widget.rows.map((row, rowIndex) => (
            <tr key={`${widget.id}-${rowIndex}`}>
              {row.cells.map((cell, cellIndex) => (
                <td
                  key={`${widget.id}-${rowIndex}-${cellIndex}`}
                  className={[
                    widget.columns[cellIndex]?.dataType === "number" ? "numeric" : "",
                    row.cellStatus?.[cellIndex] === "unverified" ? "unverified" : "",
                  ].filter(Boolean).join(" ") || undefined}
                  title={row.cellStatus?.[cellIndex] === "unverified" ? "Unverified hypothesis value" : undefined}
                >
                  {row.cellStatus?.[cellIndex] === "unverified" ? `≈ ${cell}` : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
