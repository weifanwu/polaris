import type { ResponsiveLayouts } from "react-grid-layout";
import type { ChatMessage, DashboardWidget } from "@/types";

const STORAGE_KEY = "polaris-dashboard:v1";

export type StoredDashboard = {
  widgets: DashboardWidget[];
  layouts: ResponsiveLayouts;
  messages: ChatMessage[];
  conversationContext: string;
};

export const emptyDashboard: StoredDashboard = {
  widgets: [],
  layouts: {},
  messages: [],
  conversationContext: "",
};

function isLegacyQualifiedAggregate(widget: DashboardWidget) {
  const qualified = /(?:\bindustry\b|\bsector\b|\boccupation\b|行业|产业|职业|软件|信息技术|计算机)/i.test(widget.originalQuery ?? "");
  return qualified
    && widget.dataQuality?.sourceName === "Statistics Canada WDS"
    && !widget.dataQuality.scope;
}

function isLoopingSoftwareContext(value: unknown) {
  return typeof value === "string"
    && /(software|\bit\b|软件|信息技术|计算机)/i.test(value)
    && /(unemployment|失业)/i.test(value);
}

export function loadDashboard(): StoredDashboard {
  if (typeof window === "undefined") return emptyDashboard;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDashboard;
    const parsed = JSON.parse(raw) as Partial<StoredDashboard>;
    const storedWidgets = Array.isArray(parsed.widgets) ? parsed.widgets : [];
    const removedLegacyWidgets = storedWidgets.filter(isLegacyQualifiedAggregate).length;
    const widgets = storedWidgets.filter((widget) => !isLegacyQualifiedAggregate(widget));
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
      messages: [
        ...(Array.isArray(parsed.messages) ? parsed.messages.slice(-19) : []),
        ...(removedLegacyWidgets > 0 ? [{
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: `已移除 ${removedLegacyWidgets} 个旧版组件：它们包含行业/职业限定，但实际使用了全国总体序列。请用原问题重新生成。`,
          tone: "error" as const,
        }] : []),
      ].slice(-20),
      conversationContext:
        typeof parsed.conversationContext === "string" && !isLoopingSoftwareContext(parsed.conversationContext)
          ? parsed.conversationContext.slice(0, 500)
          : "",
    };
  } catch {
    return emptyDashboard;
  }
}

export function saveDashboard(state: StoredDashboard) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...state,
      messages: state.messages.slice(-20),
      conversationContext: state.conversationContext.slice(0, 500),
    }),
  );
}
