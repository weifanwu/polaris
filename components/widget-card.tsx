"use client";

import { useState } from "react";
import {
  BrainCircuit,
  ExternalLink,
  GripHorizontal,
  Maximize2,
  Minimize2,
  MoveDiagonal2,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { DashboardWidget } from "@/types";
import { BarWidget } from "./widgets/bar-widget";
import { DataTable } from "./widgets/data-table";
import { LineWidget } from "./widgets/line-widget";
import { MetricWidget } from "./widgets/metric-widget";

type Props = {
  widget: DashboardWidget;
  refreshing: boolean;
  refreshError?: string;
  focused: boolean;
  onDelete: () => void;
  onRefresh: () => void;
  onToggleFocus: () => void;
};

function WidgetContent({ widget }: { widget: DashboardWidget }) {
  switch (widget.visualization) {
    case "line_chart":
      return <LineWidget widget={widget} />;
    case "bar_chart":
      return <BarWidget widget={widget} />;
    case "metric":
      return <MetricWidget widget={widget} />;
    default:
      return <DataTable widget={widget} />;
  }
}

export function WidgetCard({
  widget,
  refreshing,
  refreshError,
  focused,
  onDelete,
  onRefresh,
  onToggleFocus,
}: Props) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const quality = widget.dataQuality;
  const isUserData = quality?.method === "user_data";
  const coverage = quality && quality.requestedPoints > 0
    ? Math.round((quality.availablePoints / quality.requestedPoints) * 100)
    : null;

  return (
    <article
      className={`widget-card ${focused ? "focused" : ""}`}
      id={focused ? undefined : `widget-${widget.id}`}
    >
      <header className={`widget-header ${focused ? "" : "widget-drag-handle"}`}>
        <div className="widget-heading">
          <span className="drag-mark" aria-hidden="true"><GripHorizontal size={15} /></span>
          <div>
            <div className="widget-title-row">
              <h3>{widget.title}</h3>
              {widget.isDemo ? <span className="demo-pill">Demo data</span> : null}
              {quality ? (
                <span
                  className={`quality-pill ${quality.method === "official_connector" ? "official" : quality.method === "user_data" ? "uploaded" : "searched"}`}
                  title={`${quality.sourceName} · ${quality.availablePoints}/${quality.requestedPoints} verified observations`}
                >
                  {quality.method === "official_connector" ? <ShieldCheck size={10} /> : quality.method === "user_data" ? <FileSpreadsheetIcon /> : <SearchCheck size={10} />}
                  {quality.method === "official_connector" ? "Official" : quality.method === "user_data" ? "Your data" : "Web verified"}
                </span>
              ) : null}
            </div>
            <p>{widget.subtitle}</p>
            {quality?.scope ? <small className="widget-scope">{quality.scope}</small> : null}
          </div>
        </div>
        <div className="widget-actions">
          <button
            className={`icon-button ${showAnalysis ? "active" : ""}`}
            onClick={() => setShowAnalysis((value) => !value)}
            aria-label={`${showAnalysis ? "Hide" : "Show"} analysis for ${widget.title}`}
            title="Analysis and methodology"
          >
            <BrainCircuit size={15} />
          </button>
          <button
            className="icon-button"
            onClick={onToggleFocus}
            aria-label={`${focused ? "Restore" : "Expand"} ${widget.title}`}
            title={focused ? "Restore widget" : "Expand widget"}
          >
            {focused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            className="icon-button"
            onClick={onRefresh}
            disabled={refreshing || isUserData}
            aria-label={`Refresh ${widget.title}`}
            title={isUserData ? "Re-upload the source data to refresh" : "Refresh with original question"}
          >
            <RefreshCw size={15} className={refreshing ? "spin" : undefined} />
          </button>
          <button
            className="icon-button danger"
            onClick={onDelete}
            aria-label={`Delete ${widget.title}`}
            title="Delete widget"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      <div className="widget-content"><WidgetContent widget={widget} /></div>
      {showAnalysis ? (
        <section className="widget-analysis" aria-label="Polaris analysis">
          <div><BrainCircuit size={14} /><strong>POLARIS ANALYSIS</strong></div>
          <p>{widget.summary || "No additional analysis was generated."}</p>
        </section>
      ) : null}

      <footer className="widget-footer">
        <div className="source-list">
          {widget.isDemo ? (
            <span className="local-source">Local preview · not Web Search</span>
          ) : isUserData ? (
            <span className="local-source">User supplied · {quality?.sourceName}</span>
          ) : widget.sources.length ? (
            widget.sources.slice(0, 5).map((source, index) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.title}>
                {index + 1}. {source.title}<ExternalLink size={10} />
              </a>
            ))
          ) : (
            <span className="source-missing">Source unavailable</span>
          )}
        </div>
        {!focused ? (
          <span className="resize-cue" title="Drag any edge or corner to resize">
            <MoveDiagonal2 size={11} /> Resize
          </span>
        ) : null}
        {quality && coverage !== null ? (
          <span
            className={`coverage-stat ${coverage === 100 ? "complete" : "partial"}`}
            title={`${quality.availablePoints} available · ${quality.missingPoints} missing · ${quality.coverageStart ?? "—"} to ${quality.coverageEnd ?? "—"}`}
          >
            {coverage}% coverage
          </span>
        ) : null}
        <time dateTime={widget.generatedAt}>
          {new Intl.DateTimeFormat("en-CA", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(widget.generatedAt))}
        </time>
      </footer>
      {refreshError ? <div className="widget-error">{refreshError}</div> : null}
    </article>
  );
}

function FileSpreadsheetIcon() {
  return <span aria-hidden="true" className="uploaded-dot" />;
}
