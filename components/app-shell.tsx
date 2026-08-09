"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LayoutItem, ResponsiveLayouts } from "react-grid-layout";
import { Activity, Clock3 } from "lucide-react";
import { ChatPanel } from "./chat-panel";
import { DashboardGrid } from "./dashboard-grid";
import { Sidebar } from "./sidebar";
import { demoWidgets } from "@/lib/demo-data";
import { buildDashboardContext, buildReferencedWidgetDataset } from "@/lib/dashboard-context";
import { emptyDashboard, loadDashboard, saveDashboard } from "@/lib/storage";
import type { UserDataset } from "@/lib/user-dataset";
import { buildRefreshContext, validateRefreshCandidate, type RefreshContext } from "@/lib/widget-refresh";
import type { AgentTrace, GenerateWidgetResult } from "@/lib/widget-schema";
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
  conversationContext = "",
  history: ChatMessage[] = [],
  skipClarification = false,
  userDataset: UserDataset | null = null,
  dashboardContext = "",
  refreshContext: RefreshContext | null = null,
) {
  const response = await fetch("/api/generate-widget", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      conversationContext,
      history: history.slice(-6).map(({ role, content }) => ({
        role,
        content: content.slice(0, 360),
      })),
      skipClarification,
      userData: userDataset,
      dashboardContext,
      refreshContext,
    }),
  });
  const payload = (await response.json()) as GenerateWidgetResult & {
    error?: string;
    code?: string;
    detail?: string;
    requestId?: string;
    retryable?: boolean;
    trace?: AgentTrace;
  };
  if (!response.ok) {
    throw new PolarisRequestError({
      message: payload.error || "查询失败。",
      code: payload.code || "request_failed",
      detail: payload.detail,
      requestId: payload.requestId,
      retryable: payload.retryable ?? false,
      trace: payload.trace,
    });
  }
  return payload;
}

type FailedRequest = {
  query: string;
  conversationContext: string;
  history: ChatMessage[];
  userDataset: UserDataset | null;
  dashboardContext: string;
  error: PolarisRequestError;
};

type RefreshNotice = {
  tone: "success" | "neutral" | "error";
  message: string;
};

class PolarisRequestError extends Error {
  code: string;
  detail?: string;
  requestId?: string;
  retryable: boolean;
  trace?: AgentTrace;

  constructor(input: {
    message: string;
    code: string;
    detail?: string;
    requestId?: string;
    retryable: boolean;
    trace?: AgentTrace;
  }) {
    super(input.message);
    this.name = "PolarisRequestError";
    this.code = input.code;
    this.detail = input.detail;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
    this.trace = input.trace;
  }
}

const RETRY_PATTERN = /^(?:重试|再试(?:一次)?|重来|重新试|retry|try again)[呢吧.!！?？\s]*$/i;
const EXPLAIN_FAILURE_PATTERN = /(?:为什么|为何|怎么).*(?:失败|错误)|(?:失败|错误).*(?:原因|什么)|what happened|why.*(?:fail|error)/i;

function explainFailure(failure: FailedRequest) {
  const error = failure.error;
  const identity = error.requestId ? `错误编号 ${error.requestId}。` : "";
  const nextStep = error.retryable
    ? "这类错误可以重试；发送“重试”会重放原始请求，不会把“重试”当成新数据问题。"
    : "原始请求已保留，但建议先按错误详情修正后再试。";
  return `上一次失败不是数据结论，而是 ${error.code}：${error.message}${error.detail ? ` ${error.detail}` : ""} ${identity}${nextStep}`.trim();
}

export function AppShell() {
  const [hydrated, setHydrated] = useState(false);
  const [widgets, setWidgets] = useState<DashboardWidget[]>(emptyDashboard.widgets);
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(emptyDashboard.layouts);
  const [messages, setMessages] = useState<ChatMessage[]>(emptyDashboard.messages);
  const [conversationContext, setConversationContext] = useState(
    emptyDashboard.conversationContext,
  );
  const [query, setQuery] = useState("");
  const [userDataset, setUserDataset] = useState<UserDataset | null>(null);
  const [loadingStage, setLoadingStage] = useState<"working" | "analyzing" | null>(null);
  const [lastFailedRequest, setLastFailedRequest] = useState<FailedRequest | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [refreshNotices, setRefreshNotices] = useState<Record<string, RefreshNotice>>({});
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [health, setHealth] = useState<ApiHealth>({ status: "error", model: null });

  useEffect(() => {
    const stored = loadDashboard();
    setWidgets(stored.widgets);
    setLayouts(stored.layouts);
    setMessages(stored.messages);
    setConversationContext(stored.conversationContext);
    setHydrated(true);

    fetch("/api/health")
      .then((response) => response.json())
      .then((result: ApiHealth) => setHealth(result))
      .catch(() => setHealth({ status: "error", model: null }));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveDashboard({ widgets, layouts, messages, conversationContext });
  }, [conversationContext, hydrated, layouts, messages, widgets]);

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
    const typedQuery = query.trim();
    if (EXPLAIN_FAILURE_PATTERN.test(typedQuery) && lastFailedRequest && !loadingStage) {
      const explanationMessages: ChatMessage[] = [
        { id: crypto.randomUUID(), role: "user", content: typedQuery },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: explainFailure(lastFailedRequest),
          tone: "error",
          trace: lastFailedRequest.error.trace,
        },
      ];
      setMessages((current) => [...current, ...explanationMessages].slice(-20));
      setQuery("");
      return;
    }

    const retrying = RETRY_PATTERN.test(typedQuery) && Boolean(lastFailedRequest);
    const cleanQuery = retrying
      ? lastFailedRequest!.query
      : typedQuery || (userDataset ? "Analyze this dataset and create the most useful visualization." : "");
    if (!cleanQuery || loadingStage) return;

    const contextualDataset = !retrying && !userDataset
      ? buildReferencedWidgetDataset(widgets, cleanQuery)
      : null;
    const requestContext = retrying ? lastFailedRequest!.conversationContext : conversationContext;
    const requestHistory = retrying ? lastFailedRequest!.history : messages;
    const requestDataset = retrying ? lastFailedRequest!.userDataset : userDataset ?? contextualDataset;
    const requestDashboardContext = retrying
      ? lastFailedRequest!.dashboardContext
      : buildDashboardContext(widgets, cleanQuery);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: retrying
        ? `重试上一次请求：${cleanQuery}`
        : requestDataset
          ? `${cleanQuery}\n\n${requestDataset.origin === "dashboard" ? "Using dashboard data" : "Attached data"}: ${requestDataset.name}`
          : cleanQuery,
    };
    setMessages((current) => [...current, userMessage].slice(-20));
    setQuery("");
    setLoadingStage(requestDataset ? "analyzing" : "working");

    try {
      const result = await requestWidget(
        cleanQuery,
        requestContext,
        requestHistory,
        false,
        requestDataset,
        requestDashboardContext,
      );
      if (typeof result.conversationContext === "string") {
        setConversationContext(result.conversationContext);
      }
      if (result.status !== "success" || !result.widget) {
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.message,
          tone: result.status === "cannot_answer" ? "error" : "normal",
          usage: result.usage,
          trace: result.trace,
        };
        setMessages((current) => [
          ...current,
          assistantMessage,
        ].slice(-20));
        if (result.status === "cannot_answer") {
          setLastFailedRequest({
            query: cleanQuery,
            conversationContext: requestContext,
            history: requestHistory,
            userDataset: requestDataset,
            dashboardContext: requestDashboardContext,
            error: new PolarisRequestError({
              message: result.message,
              code: "analysis_incomplete",
              detail: "The run completed without a renderable, sufficiently verified widget.",
              retryable: true,
              trace: result.trace,
            }),
          });
        } else {
          setLastFailedRequest(null);
        }
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
        usage: result.usage,
        trace: result.trace,
      };
      setMessages((current) => [
        ...current,
        assistantMessage,
      ].slice(-20));
      setLastFailedRequest(null);
      if (requestDataset) setUserDataset(null);
    } catch (error) {
      const failure = error instanceof PolarisRequestError
        ? error
        : new PolarisRequestError({
          message: error instanceof Error ? error.message : "查询失败。",
          code: "client_error",
          retryable: true,
        });
      setLastFailedRequest({
        query: cleanQuery,
        conversationContext: requestContext,
        history: requestHistory,
        userDataset: requestDataset,
        dashboardContext: requestDashboardContext,
        error: failure,
      });
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `${failure.message}${failure.requestId ? ` 错误编号：${failure.requestId}。` : ""}${failure.retryable ? " 可以发送“重试”重放原始请求。" : ""}`,
        tone: "error",
        trace: failure.trace,
      };
      setMessages((current) => [
        ...current,
        assistantMessage,
      ].slice(-20));
    } finally {
      setLoadingStage(null);
    }
  }, [conversationContext, lastFailedRequest, loadingStage, messages, query, userDataset, widgets]);

  const refreshWidget = useCallback(async (id: string) => {
    const existing = widgets.find((widget) => widget.id === id);
    if (!existing || refreshingIds.has(id)) return;

    setRefreshingIds((current) => new Set(current).add(id));
    setRefreshNotices((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      const ageMs = Date.now() - new Date(existing.generatedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs < 5 * 60 * 1_000) {
        setRefreshNotices((current) => ({
          ...current,
          [id]: { tone: "neutral", message: "Checked recently. Wait five minutes before checking the source again." },
        }));
        return;
      }

      const result = await requestWidget(
        existing.originalQuery,
        "",
        [],
        true,
        null,
        "",
        buildRefreshContext(existing),
      );
      if (result.status !== "success" || !result.widget) {
        setRefreshNotices((current) => ({
          ...current,
          [id]: { tone: "neutral", message: result.message || "No newer verified data was found. The existing widget was kept." },
        }));
        return;
      }
      const candidate = result.widget;
      const validation = validateRefreshCandidate(existing, candidate);
      if (!validation.compatible) {
        setRefreshNotices((current) => ({
          ...current,
          [id]: { tone: "error", message: `Refresh blocked: ${validation.reason}` },
        }));
        return;
      }
      if (!validation.changed) {
        setRefreshNotices((current) => ({
          ...current,
          [id]: { tone: "neutral", message: `Source checked${candidate.dataQuality?.coverageEnd ? ` through ${candidate.dataQuality.coverageEnd}` : ""}. No new or revised observations; the widget was not changed.` },
        }));
        return;
      }
      setWidgets((current) => current.map((widget) =>
        widget.id === id
          ? { ...candidate, id, originalQuery: existing.originalQuery, isDemo: false }
          : widget,
      ));
      const advanced = Boolean(
        candidate.dataQuality?.coverageEnd
        && existing.dataQuality?.coverageEnd
        && candidate.dataQuality.coverageEnd > existing.dataQuality.coverageEnd,
      );
      setRefreshNotices((current) => ({
        ...current,
        [id]: {
          tone: "success",
          message: advanced
            ? `Updated with verified observations through ${candidate.dataQuality?.coverageEnd}.`
            : `Updated with revised source observations${candidate.dataQuality?.coverageEnd ? ` through ${candidate.dataQuality.coverageEnd}` : ""}.`,
        },
      }));
    } catch (error) {
      setRefreshNotices((current) => ({
        ...current,
        [id]: {
          tone: "error",
          message: error instanceof Error ? error.message : "Refresh failed. Old data was kept.",
        },
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
    setRefreshNotices((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const loadDemo = useCallback(() => {
    setWidgets(demoWidgets);
    setLayouts(layoutsForWidgets(demoWidgets));
    setConversationContext("");
    setLastFailedRequest(null);
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
    setConversationContext("");
    setRefreshNotices({});
    setLastFailedRequest(null);
  }, []);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setConversationContext("");
    setLastFailedRequest(null);
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
            refreshNotices={refreshNotices}
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
        userDataset={userDataset}
        dashboardWidgetCount={widgets.length}
        onToggle={() => setChatCollapsed((value) => !value)}
        onClear={clearConversation}
        onQueryChange={setQuery}
        onDatasetChange={setUserDataset}
        onSubmit={submit}
        onFocusWidget={focusWidget}
      />
    </main>
  );
}
