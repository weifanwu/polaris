"use client";

import { useCallback, useEffect, useMemo, useState, type SetStateAction } from "react";
import type { LayoutItem, ResponsiveLayouts } from "react-grid-layout";
import { Activity, Clock3 } from "lucide-react";
import { ChatPanel } from "./chat-panel";
import { DashboardGrid } from "./dashboard-grid";
import { Sidebar } from "./sidebar";
import { buildDashboardContext, buildReferencedWidgetDataset } from "@/lib/dashboard-context";
import {
  createDashboard,
  emptyWorkspace,
  loadWorkspace,
  normalizeDashboardName,
  saveWorkspace,
  type StoredDashboard,
  type StoredWorkspace,
} from "@/lib/storage";
import type { UserDataset } from "@/lib/user-dataset";
import { buildRefreshContext, validateRefreshCandidate, type RefreshContext } from "@/lib/widget-refresh";
import { buildRecoveryExecutionTrace, isRecoveryApproval, isRecoveryDismissal } from "@/lib/recovery-proposal";
import type { AgentTrace, GenerateWidgetResult } from "@/lib/widget-schema";
import type { ApiHealth, ChatMessage, DashboardWidget, RecoveryProposal } from "@/types";

const BREAKPOINT_COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 } as const;
const ZERO_USAGE = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, webSearchCalls: 0, modelCalls: 0 };

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

function resolveState<T>(value: SetStateAction<T>, current: T) {
  return typeof value === "function" ? (value as (previous: T) => T)(current) : value;
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
      message: payload.error || "The request failed.",
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
  const identity = error.requestId ? ` Request ID: ${error.requestId}.` : "";
  const nextStep = error.retryable
    ? " This error is retryable. Send “retry” to replay the original request instead of treating it as a new data question."
    : " The original request is preserved, but its error details need to be addressed before retrying.";
  return `The previous failure was not a data conclusion. It was ${error.code}: ${error.message}${error.detail ? ` ${error.detail}` : ""}${identity}${nextStep}`.trim();
}

export function AppShell() {
  const [hydrated, setHydrated] = useState(false);
  const [workspace, setWorkspace] = useState<StoredWorkspace>(emptyWorkspace);
  const [query, setQuery] = useState("");
  const [userDataset, setUserDataset] = useState<UserDataset | null>(null);
  const [loadingStage, setLoadingStage] = useState<"working" | "analyzing" | null>(null);
  const [lastFailedRequest, setLastFailedRequest] = useState<FailedRequest | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [refreshNotices, setRefreshNotices] = useState<Record<string, RefreshNotice>>({});
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [health, setHealth] = useState<ApiHealth>({ status: "error", model: null });

  const activeDashboard = useMemo(
    () => workspace.dashboards.find((dashboard) => dashboard.id === workspace.activeDashboardId)
      ?? workspace.dashboards[0]
      ?? emptyWorkspace.dashboards[0],
    [workspace],
  );
  const widgets = activeDashboard.widgets;
  const layouts = activeDashboard.layouts;
  const messages = activeDashboard.messages;
  const conversationContext = activeDashboard.conversationContext;
  const pendingRecovery = activeDashboard.pendingRecovery;

  const updateActiveDashboard = useCallback((updater: (dashboard: StoredDashboard) => StoredDashboard) => {
    setWorkspace((current) => ({
      ...current,
      dashboards: current.dashboards.map((dashboard) => dashboard.id === current.activeDashboardId
        ? { ...updater(dashboard), updatedAt: new Date().toISOString() }
        : dashboard),
    }));
  }, []);

  const setWidgets = useCallback((value: SetStateAction<DashboardWidget[]>) => {
    updateActiveDashboard((dashboard) => ({ ...dashboard, widgets: resolveState(value, dashboard.widgets) }));
  }, [updateActiveDashboard]);
  const setLayouts = useCallback((value: SetStateAction<ResponsiveLayouts>) => {
    updateActiveDashboard((dashboard) => ({ ...dashboard, layouts: resolveState(value, dashboard.layouts) }));
  }, [updateActiveDashboard]);
  const setMessages = useCallback((value: SetStateAction<ChatMessage[]>) => {
    updateActiveDashboard((dashboard) => ({ ...dashboard, messages: resolveState(value, dashboard.messages) }));
  }, [updateActiveDashboard]);
  const setConversationContext = useCallback((value: SetStateAction<string>) => {
    updateActiveDashboard((dashboard) => ({ ...dashboard, conversationContext: resolveState(value, dashboard.conversationContext) }));
  }, [updateActiveDashboard]);
  const setPendingRecovery = useCallback((value: SetStateAction<RecoveryProposal | null>) => {
    updateActiveDashboard((dashboard) => ({ ...dashboard, pendingRecovery: resolveState(value, dashboard.pendingRecovery) }));
  }, [updateActiveDashboard]);

  useEffect(() => {
    setWorkspace(loadWorkspace());
    setHydrated(true);

    fetch("/api/health")
      .then((response) => response.json())
      .then((result: ApiHealth) => setHealth(result))
      .catch(() => setHealth({ status: "error", model: null }));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveWorkspace(workspace);
  }, [hydrated, workspace]);

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

  const approveRecovery = useCallback((approvalText = "Use recommended chart") => {
    if (!pendingRecovery || loadingStage) return;
    const widget = pendingRecovery.widget;
    setWidgets((current) => [...current, widget]);
    setLayouts((current) => addWidgetToLayouts(current, widget));
    setConversationContext(pendingRecovery.proposedQuery);
    setPendingRecovery(null);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user" as const, content: approvalText },
      {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: `Created “${widget.title}” from the verified data collected in the previous run. No new search or model call was made.`,
        widgetId: widget.id,
        usage: ZERO_USAGE,
        trace: buildRecoveryExecutionTrace(pendingRecovery),
      },
    ].slice(-20));
    setQuery("");
    setLastFailedRequest(null);
  }, [loadingStage, pendingRecovery, setConversationContext, setLayouts, setMessages, setPendingRecovery, setWidgets]);

  const dismissRecovery = useCallback((withMessage = false, userText = "Dismiss") => {
    if (!pendingRecovery || loadingStage) return;
    setPendingRecovery(null);
    if (withMessage) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user" as const, content: userText },
        { id: crypto.randomUUID(), role: "assistant" as const, content: "The suggested alternative was dismissed. Ask for a different metric, frequency, or scope whenever you are ready." },
      ].slice(-20));
    }
    setQuery("");
  }, [loadingStage, pendingRecovery, setMessages, setPendingRecovery]);

  const submit = useCallback(async () => {
    const typedQuery = query.trim();
    if (pendingRecovery && isRecoveryApproval(typedQuery) && !loadingStage) {
      approveRecovery(typedQuery);
      return;
    }
    if (pendingRecovery && isRecoveryDismissal(typedQuery) && !loadingStage) {
      dismissRecovery(true, typedQuery);
      return;
    }
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
    if (pendingRecovery) setPendingRecovery(null);

    const contextualDataset = !retrying && !userDataset
      ? buildReferencedWidgetDataset(widgets, cleanQuery)
      : null;
    const requestContext = retrying ? lastFailedRequest!.conversationContext : conversationContext;
    const requestHistory = retrying ? lastFailedRequest!.history : messages;
    const requestDataset = retrying ? lastFailedRequest!.userDataset : userDataset ?? contextualDataset;
    const requestDashboardContext = retrying
      ? lastFailedRequest!.dashboardContext
      : buildDashboardContext(widgets, cleanQuery, activeDashboard.name);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: retrying
        ? `Retrying the previous request: ${cleanQuery}`
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
        if (result.status === "needs_approval" && result.recoveryProposal) {
          setPendingRecovery(result.recoveryProposal);
        }
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
      setPendingRecovery(null);
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
          message: error instanceof Error ? error.message : "The request failed.",
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
        content: `${failure.message}${failure.requestId ? ` Request ID: ${failure.requestId}.` : ""}${failure.retryable ? " Send “retry” to replay the original request." : ""}`,
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
  }, [activeDashboard.name, approveRecovery, conversationContext, dismissRecovery, lastFailedRequest, loadingStage, messages, pendingRecovery, query, setConversationContext, setLayouts, setMessages, setPendingRecovery, setWidgets, userDataset, widgets]);

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
          ? { ...candidate, id, originalQuery: existing.originalQuery }
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
  }, [refreshingIds, setWidgets, widgets]);

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
  }, [setLayouts, setWidgets]);

  const clearDashboard = useCallback(() => {
    updateActiveDashboard((dashboard) => ({
      ...dashboard,
      widgets: [],
      layouts: {},
      messages: [],
      conversationContext: "",
      pendingRecovery: null,
    }));
    setRefreshNotices({});
    setLastFailedRequest(null);
    setUserDataset(null);
  }, [updateActiveDashboard]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setConversationContext("");
    setPendingRecovery(null);
    setLastFailedRequest(null);
  }, [setConversationContext, setMessages, setPendingRecovery]);

  const selectDashboard = useCallback((id: string) => {
    if (id === workspace.activeDashboardId || loadingStage || refreshingIds.size) return;
    if (!workspace.dashboards.some((dashboard) => dashboard.id === id)) return;
    setWorkspace((current) => ({ ...current, activeDashboardId: id }));
    setQuery("");
    setUserDataset(null);
    setLastFailedRequest(null);
    setRefreshNotices({});
  }, [loadingStage, refreshingIds.size, workspace.activeDashboardId, workspace.dashboards]);

  const addDashboard = useCallback((name: string) => {
    if (workspace.dashboards.length >= 12 || loadingStage || refreshingIds.size) return;
    const dashboard = createDashboard(name);
    setWorkspace((current) => ({
      ...current,
      activeDashboardId: dashboard.id,
      dashboards: [...current.dashboards, dashboard],
    }));
    setQuery("");
    setUserDataset(null);
    setLastFailedRequest(null);
    setRefreshNotices({});
  }, [loadingStage, refreshingIds.size, workspace.dashboards.length]);

  const renameDashboard = useCallback((id: string, name: string) => {
    setWorkspace((current) => ({
      ...current,
      dashboards: current.dashboards.map((dashboard) => dashboard.id === id
        ? { ...dashboard, name: normalizeDashboardName(name), updatedAt: new Date().toISOString() }
        : dashboard),
    }));
  }, []);

  const deleteDashboard = useCallback((id: string) => {
    if (loadingStage || refreshingIds.size) return;
    const target = workspace.dashboards.find((dashboard) => dashboard.id === id);
    if (!target || workspace.dashboards.length <= 1) return;
    if (!window.confirm(`Delete “${target.name}” and its saved widgets and conversation?`)) return;
    setWorkspace((current) => {
      if (current.dashboards.length <= 1) return current;
      const dashboards = current.dashboards.filter((dashboard) => dashboard.id !== id);
      return {
        ...current,
        dashboards,
        activeDashboardId: current.activeDashboardId === id ? dashboards[0].id : current.activeDashboardId,
      };
    });
    setQuery("");
    setUserDataset(null);
    setLastFailedRequest(null);
    setRefreshNotices({});
  }, [loadingStage, refreshingIds.size, workspace.dashboards]);

  return (
    <main className="app-shell">
      <Sidebar
        collapsed={navCollapsed}
        health={health}
        dashboards={workspace.dashboards.map((dashboard) => ({
          id: dashboard.id,
          name: dashboard.name,
          widgetCount: dashboard.widgets.length,
        }))}
        activeDashboardId={activeDashboard.id}
        busy={Boolean(loadingStage) || refreshingIds.size > 0}
        onToggle={() => setNavCollapsed((value) => !value)}
        onSelect={selectDashboard}
        onCreate={addDashboard}
        onRename={renameDashboard}
        onDelete={deleteDashboard}
        onClear={clearDashboard}
      />

      <section className="dashboard-panel">
        <header className="dashboard-header">
          <div>
            <span className="eyebrow"><Activity size={13} /> LIVE WORKSPACE</span>
            <h1>{activeDashboard.name}</h1>
            <p>One focused workspace, with its own data and agent memory.</p>
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
        dashboardName={activeDashboard.name}
        recoveryProposal={pendingRecovery}
        onToggle={() => setChatCollapsed((value) => !value)}
        onClear={clearConversation}
        onQueryChange={setQuery}
        onDatasetChange={setUserDataset}
        onSubmit={submit}
        onApproveRecovery={() => approveRecovery()}
        onDismissRecovery={() => dismissRecovery()}
        onFocusWidget={focusWidget}
      />
    </main>
  );
}
