import type { ResponsiveLayouts } from "react-grid-layout";
import type { ChatMessage, DashboardWidget } from "@/types";

const LEGACY_STORAGE_KEY = "polaris-dashboard:v1";
const WORKSPACE_STORAGE_KEY = "polaris-workspace:v2";
const MAX_DASHBOARDS = 12;

export type StoredDashboard = {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  layouts: ResponsiveLayouts;
  messages: ChatMessage[];
  conversationContext: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredWorkspace = {
  version: 2;
  activeDashboardId: string;
  dashboards: StoredDashboard[];
};

const INITIAL_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export const emptyDashboard: StoredDashboard = {
  id: "default",
  name: "My Dashboard",
  widgets: [],
  layouts: {},
  messages: [],
  conversationContext: "",
  createdAt: INITIAL_TIMESTAMP,
  updatedAt: INITIAL_TIMESTAMP,
};

export const emptyWorkspace: StoredWorkspace = {
  version: 2,
  activeDashboardId: emptyDashboard.id,
  dashboards: [emptyDashboard],
};

export function createDashboard(name = "Untitled Dashboard"): StoredDashboard {
  const timestamp = new Date().toISOString();
  return {
    ...emptyDashboard,
    id: crypto.randomUUID(),
    name: normalizeDashboardName(name),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeDashboardName(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 40) || "Untitled Dashboard";
}

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

function sanitizeDashboard(value: unknown, fallbackName: string): StoredDashboard | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<StoredDashboard>;
  const storedWidgets = Array.isArray(parsed.widgets) ? parsed.widgets : [];
  const removedLegacyWidgets = storedWidgets.filter(isLegacyQualifiedAggregate).length;
  const widgets = storedWidgets.filter((widget) => !isLegacyQualifiedAggregate(widget));
  const widgetById = new Map(widgets.map((widget) => [widget.id, widget]));
  const layouts = parsed.layouts && typeof parsed.layouts === "object"
    ? Object.fromEntries(
        Object.entries(parsed.layouts).map(([breakpoint, layout]) => [
          breakpoint,
          layout?.map((item) => ({
            ...item,
            minW: Math.min(2, item.minW ?? 2),
            minH: widgetById.get(item.i)?.visualization === "metric" ? 5 : 7,
          })),
        ]),
      )
    : {};
  const timestamp = new Date().toISOString();
  return {
    id: typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.slice(0, 80) : crypto.randomUUID(),
    name: normalizeDashboardName(typeof parsed.name === "string" ? parsed.name : fallbackName),
    widgets,
    layouts,
    messages: [
      ...(Array.isArray(parsed.messages) ? parsed.messages.slice(-19) : []),
      ...(removedLegacyWidgets > 0 ? [{
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: `${removedLegacyWidgets} legacy widget${removedLegacyWidgets === 1 ? " was" : "s were"} removed because the requested subgroup had been replaced with a national aggregate. Run the original question again to rebuild it safely.`,
        tone: "error" as const,
      }] : []),
    ].slice(-20),
    conversationContext:
      typeof parsed.conversationContext === "string" && !isLoopingSoftwareContext(parsed.conversationContext)
        ? parsed.conversationContext.slice(0, 500)
        : "",
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : timestamp,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : timestamp,
  };
}

export function migrateWorkspace(value: unknown): StoredWorkspace | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<StoredWorkspace>;
  if (parsed.version !== 2 || !Array.isArray(parsed.dashboards)) return null;
  const dashboards = parsed.dashboards
    .slice(0, MAX_DASHBOARDS)
    .flatMap((dashboard, index) => {
      const sanitized = sanitizeDashboard(dashboard, `Dashboard ${index + 1}`);
      return sanitized ? [sanitized] : [];
    });
  if (!dashboards.length) return null;
  const requestedActiveId = typeof parsed.activeDashboardId === "string" ? parsed.activeDashboardId : "";
  return {
    version: 2,
    activeDashboardId: dashboards.some((dashboard) => dashboard.id === requestedActiveId)
      ? requestedActiveId
      : dashboards[0].id,
    dashboards,
  };
}

function migrateLegacyDashboard(value: unknown): StoredWorkspace | null {
  const dashboard = sanitizeDashboard(value, "My Dashboard");
  if (!dashboard) return null;
  return { version: 2, activeDashboardId: dashboard.id, dashboards: [dashboard] };
}

export function loadWorkspace(): StoredWorkspace {
  if (typeof window === "undefined") return emptyWorkspace;

  try {
    const current = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const workspace = current ? migrateWorkspace(JSON.parse(current)) : null;
    if (workspace) return workspace;

    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    const migrated = legacy ? migrateLegacyDashboard(JSON.parse(legacy)) : null;
    if (migrated) {
      saveWorkspace(migrated);
      return migrated;
    }
  } catch {
    return emptyWorkspace;
  }
  return emptyWorkspace;
}

export function saveWorkspace(state: StoredWorkspace) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    WORKSPACE_STORAGE_KEY,
    JSON.stringify({
      version: 2,
      activeDashboardId: state.activeDashboardId,
      dashboards: state.dashboards.slice(0, MAX_DASHBOARDS).map((dashboard) => ({
        ...dashboard,
        name: normalizeDashboardName(dashboard.name),
        messages: dashboard.messages.slice(-20),
        conversationContext: dashboard.conversationContext.slice(0, 500),
      })),
    } satisfies StoredWorkspace),
  );
}
