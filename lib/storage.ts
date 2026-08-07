import type { ResponsiveLayouts } from "react-grid-layout";
import type { ChatMessage, DashboardWidget } from "@/types";

const STORAGE_KEY = "polaris-dashboard:v1";

export type StoredDashboard = {
  widgets: DashboardWidget[];
  layouts: ResponsiveLayouts;
  messages: ChatMessage[];
};

export const emptyDashboard: StoredDashboard = {
  widgets: [],
  layouts: {},
  messages: [],
};

export function loadDashboard(): StoredDashboard {
  if (typeof window === "undefined") return emptyDashboard;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDashboard;
    const parsed = JSON.parse(raw) as Partial<StoredDashboard>;
    const widgets = Array.isArray(parsed.widgets) ? parsed.widgets : [];
    const widgetById = new Map(widgets.map((widget) => [widget.id, widget]));
    const layouts =
      parsed.layouts && typeof parsed.layouts === "object"
        ? Object.fromEntries(
            Object.entries(parsed.layouts).map(([breakpoint, layout]) => [
              breakpoint,
              layout?.map((item) => ({
                ...item,
                minW: Math.min(2, item.minW ?? 2),
                minH:
                  widgetById.get(item.i)?.visualization === "metric" ? 5 : 7,
              })),
            ]),
          )
        : {};
    return {
      widgets,
      layouts,
      messages: Array.isArray(parsed.messages)
        ? parsed.messages.slice(-20)
        : [],
    };
  } catch {
    return emptyDashboard;
  }
}

export function saveDashboard(state: StoredDashboard) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...state, messages: state.messages.slice(-20) }),
  );
}
