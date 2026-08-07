"use client";

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

  if (widgets.length === 0) {
    return (
      <div className="empty-canvas">
        <div className="empty-orbit"><Compass size={28} /></div>
        <span><Sparkles size={13} /> Ready for a question</span>
        <h2>Turn the live web into your dashboard.</h2>
        <p>Ask for a price, time series, comparison, or metric in the chat panel. Polaris will search, structure, and pin the result here.</p>
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
          rowHeight={34}
          margin={[14, 14]}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: true, handle: ".widget-drag-handle", cancel: "button, a" }}
          resizeConfig={{ enabled: true, handles: ["se"] }}
          onLayoutChange={(_layout, nextLayouts) => onLayoutsChange(nextLayouts)}
        >
          {widgets.map((widget) => (
            <div key={widget.id}>
              <WidgetCard
                widget={widget}
                refreshing={refreshingIds.has(widget.id)}
                refreshError={refreshErrors[widget.id]}
                onDelete={() => onDelete(widget.id)}
                onRefresh={() => onRefresh(widget.id)}
              />
            </div>
          ))}
        </Responsive>
      ) : null}
    </div>
  );
}
