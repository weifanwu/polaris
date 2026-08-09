"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Compass, Sparkles } from "lucide-react";
import { Responsive, useContainerWidth, type ResponsiveLayouts } from "react-grid-layout";
import type { DashboardWidget } from "@/types";
import { WidgetCard } from "./widget-card";

type Props = {
  widgets: DashboardWidget[];
  layouts: ResponsiveLayouts;
  refreshingIds: Set<string>;
  refreshErrors: Record<string, string>;
  onLayoutsChange: (layouts: ResponsiveLayouts) => void;
  onDelete: (id: string) => void;
  onRefresh: (id: string) => void;
};

export function DashboardGrid({
  widgets,
  layouts,
  refreshingIds,
  refreshErrors,
  onLayoutsChange,
  onDelete,
  onRefresh,
}: Props) {
  const { width, containerRef, mounted } = useContainerWidth();
  const [focusedWidgetId, setFocusedWidgetId] = useState<string | null>(null);
  const focusedWidget = widgets.find((widget) => widget.id === focusedWidgetId);
  const isFocusOpen = Boolean(focusedWidget);

  useEffect(() => {
    if (!isFocusOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusedWidgetId(null);
    };
    document.body.classList.add("widget-focus-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("widget-focus-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isFocusOpen]);

  if (widgets.length === 0) {
    return (
      <div className="empty-canvas">
        <div className="empty-orbit"><Compass size={28} /></div>
        <span><Sparkles size={13} /> Ready to analyze</span>
        <h2>Turn live research or your own data into insight.</h2>
        <p>Ask a question, paste a table, or upload a data file. Polaris will research, calculate, visualize, and explain the result here.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="grid-container">
      {mounted ? (
        <Responsive
          width={width}
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 900, sm: 640, xs: 420, xxs: 0 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={26}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: true, handle: ".widget-drag-handle", cancel: "button, a" }}
          resizeConfig={{
            enabled: true,
            handles: ["n", "e", "s", "w", "ne", "nw", "se", "sw"],
          }}
          onLayoutChange={(_layout, nextLayouts) => onLayoutsChange(nextLayouts)}
        >
          {widgets.map((widget) => (
            <div key={widget.id}>
              <WidgetCard
                widget={widget}
                refreshing={refreshingIds.has(widget.id)}
                refreshError={refreshErrors[widget.id]}
                focused={false}
                onDelete={() => onDelete(widget.id)}
                onRefresh={() => onRefresh(widget.id)}
                onToggleFocus={() => setFocusedWidgetId(widget.id)}
              />
            </div>
          ))}
        </Responsive>
      ) : null}
      {mounted && focusedWidget
        ? createPortal(
            <div
              className="widget-focus-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setFocusedWidgetId(null);
              }}
            >
              <div className="widget-focus-frame">
                <WidgetCard
                  widget={focusedWidget}
                  refreshing={refreshingIds.has(focusedWidget.id)}
                  refreshError={refreshErrors[focusedWidget.id]}
                  focused
                  onDelete={() => {
                    onDelete(focusedWidget.id);
                    setFocusedWidgetId(null);
                  }}
                  onRefresh={() => onRefresh(focusedWidget.id)}
                  onToggleFocus={() => setFocusedWidgetId(null)}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
