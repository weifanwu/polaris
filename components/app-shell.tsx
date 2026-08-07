"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LayoutItem, ResponsiveLayouts } from "react-grid-layout";
import { Activity, Clock3 } from "lucide-react";
import { ChatPanel } from "./chat-panel";
import { DashboardGrid } from "./dashboard-grid";
import { Sidebar } from "./sidebar";
import { demoWidgets } from "@/lib/demo-data";
import { emptyDashboard, loadDashboard, saveDashboard } from "@/lib/storage";
import type { GenerateWidgetResult } from "@/lib/widget-schema";
import type { ApiHealth, ChatMessage, DashboardWidget } from "@/types";

const BREAKPOINT_COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 } as const;

function widgetSize(widget: DashboardWidget, columns: number) {
  if (widget.visualization === "metric") {
    return { w: Math.min(3, columns), h: 7 };
  }
  return { w: Math.min(6, columns), h: 14 };
}

function addWidgetToLayouts(
  layouts: ResponsiveLayouts,
  widget: DashboardWidget,
): ResponsiveLayouts {
  const next: ResponsiveLayouts = {};
  for (const [breakpoint, columns] of Object.entries(BREAKPOINT_COLS)) {
    const current = [...(layouts[breakpoint] ?? [])];
    const size = widgetSize(widget, columns);
    const bottom = current.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    const item: LayoutItem = {
      i: widget.id,
      x: 0,
      y: bottom,
      w: size.w,
      h: size.h,
      minW: Math.min(2, columns),
      minH: widget.visualization === "metric" ? 5 : 7,
    };
    next[breakpoint] = [...current, item];
  }
  return next;
}

function layoutsForWidgets(widgets: DashboardWidget[]) {
  return widgets.reduce<ResponsiveLayouts>(
    (layouts, widget) => addWidgetToLayouts(layouts, widget),
    {},
  );
}

async function requestWidget(
  query: string,
  history: ChatMessage[] = [],
  skipClarification = false,
) {
  const response = await fetch("/api/generate-widget", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      history: history.slice(-12).map(({ role, content }) => ({ role, content })),
      skipClarification,
    }),
  });
  const payload = (await response.json()) as GenerateWidgetResult & { error?: string };
  if (!response.ok) throw new Error(payload.error || "查询失败，请重试。");
  return payload;
}

export function AppShell() {
  const [hydrated, setHydrated] = useState(false);
  const [widgets, setWidgets] = useState<DashboardWidget[]>(emptyDashboard.widgets);
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(emptyDashboard.layouts);
  const [messages, setMessages] = useState<ChatMessage[]>(emptyDashboard.messages);
  const [query, setQuery] = useState("");
  const [loadingStage, setLoadingStage] = useState<"searching" | "structuring" | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [refreshErrors, setRefreshErrors] = useState<Record<string, string>>({});
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [health, setHealth] = useState<ApiHealth>({ status: "error", model: null });

  useEffect(() => {
    const stored = loadDashboard();
    setWidgets(stored.widgets);
    setLayouts(stored.layouts);
    setMessages(stored.messages);
    setHydrated(true);

    fetch("/api/health")
      .then((response) => response.json())
      .then((result: ApiHealth) => setHealth(result))
      .catch(() => setHealth({ status: "error", model: null }));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveDashboard({ widgets, layouts, messages });
  }, [hydrated, layouts, messages, widgets]);

  const latestGeneratedAt = useMemo(() => {
    if (!widgets.length) return null;
    return widgets.reduce((latest, widget) =>
      widget.generatedAt > latest ? widget.generatedAt : latest,
    widgets[0].generatedAt);
  }, [widgets]);

  const focusWidget = useCallback((id: string) => {
    setChatCollapsed(true);
    window.setTimeout(() => {
      document.getElementById(`widget-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
  }, []);

  const submit = useCallback(async () => {
    const cleanQuery = query.trim();
    if (!cleanQuery || loadingStage) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: cleanQuery,
    };
    setMessages((current) => [...current, userMessage].slice(-20));
    setQuery("");
    setLoadingStage("searching");
    const stageTimer = window.setTimeout(() => setLoadingStage("structuring"), 2_200);

    try {
      const result = await requestWidget(cleanQuery, messages);
      if (result.status !== "success" || !result.widget) {
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.message,
          tone: result.status === "cannot_answer" ? "error" : "normal",
        };
        setMessages((current) => [
          ...current,
          assistantMessage,
        ].slice(-20));
        return;
      }

      const widget: DashboardWidget = result.widget;
      setWidgets((current) => [...current, widget]);
      setLayouts((current) => addWidgetToLayouts(current, widget));
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.message || `Created “${widget.title}”.`,
        widgetId: widget.id,
      };
      setMessages((current) => [
        ...current,
        assistantMessage,
      ].slice(-20));
    } catch (error) {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: error instanceof Error ? error.message : "查询失败，请重试。",
        tone: "error",
      };
      setMessages((current) => [
        ...current,
        assistantMessage,
      ].slice(-20));
    } finally {
      window.clearTimeout(stageTimer);
      setLoadingStage(null);
    }
  }, [loadingStage, messages, query]);

  const refreshWidget = useCallback(async (id: string) => {
    const existing = widgets.find((widget) => widget.id === id);
    if (!existing || refreshingIds.has(id)) return;

    setRefreshingIds((current) => new Set(current).add(id));
    setRefreshErrors((current) => ({ ...current, [id]: "" }));
    try {
      const result = await requestWidget(existing.originalQuery, [], true);
      if (result.status !== "success" || !result.widget) {
        throw new Error(result.message);
      }
      setWidgets((current) => current.map((widget) =>
        widget.id === id
          ? { ...result.widget!, id, originalQuery: existing.originalQuery, isDemo: false }
          : widget,
      ));
    } catch (error) {
      setRefreshErrors((current) => ({
        ...current,
        [id]: error instanceof Error ? error.message : "Refresh failed. Old data was kept.",
      }));
    } finally {
      setRefreshingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [refreshingIds, widgets]);

  const deleteWidget = useCallback((id: string) => {
    setWidgets((current) => current.filter((widget) => widget.id !== id));
    setLayouts((current) => Object.fromEntries(
      Object.entries(current).map(([breakpoint, layout]) => [
        breakpoint,
        layout?.filter((item) => item.i !== id),
      ]),
    ));
  }, []);

  const loadDemo = useCallback(() => {
    setWidgets(demoWidgets);
    setLayouts(layoutsForWidgets(demoWidgets));
    setMessages([{
      id: crypto.randomUUID(),
      role: "assistant",
      content: "Loaded three local demo widgets. They are clearly marked and do not use Web Search.",
    }]);
  }, []);

  const clearDashboard = useCallback(() => {
    setWidgets([]);
    setLayouts({});
    setMessages([]);
    setRefreshErrors({});
  }, []);

  const clearConversation = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <main className="app-shell">
      <Sidebar
        collapsed={navCollapsed}
        health={health}
        onToggle={() => setNavCollapsed((value) => !value)}
        onLoadDemo={loadDemo}
        onClear={clearDashboard}
      />

      <section className="dashboard-panel">
        <header className="dashboard-header">
          <div>
            <span className="eyebrow"><Activity size={13} /> LIVE WORKSPACE</span>
            <h1>My Dashboard</h1>
            <p>Real-time signals, shaped around your questions.</p>
          </div>
          <div className="dashboard-stats">
            <div><span>WIDGETS</span><strong>{String(widgets.length).padStart(2, "0")}</strong></div>
            <div><span><Clock3 size={11} /> LAST UPDATE</span><strong>{latestGeneratedAt ? new Intl.DateTimeFormat("en-CA", { hour: "2-digit", minute: "2-digit" }).format(new Date(latestGeneratedAt)) : "—"}</strong></div>
          </div>
        </header>

        <div className="canvas-scroll">
          <DashboardGrid
            widgets={widgets}
            layouts={layouts}
            refreshingIds={refreshingIds}
            refreshErrors={refreshErrors}
            onLayoutsChange={setLayouts}
            onDelete={deleteWidget}
            onRefresh={refreshWidget}
          />
        </div>
      </section>

      <ChatPanel
        collapsed={chatCollapsed}
        query={query}
        messages={messages}
        loadingStage={loadingStage}
        onToggle={() => setChatCollapsed((value) => !value)}
        onClear={clearConversation}
        onQueryChange={setQuery}
        onSubmit={submit}
        onFocusWidget={focusWidget}
      />
    </main>
  );
}
