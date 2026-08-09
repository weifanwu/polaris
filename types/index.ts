import type { AgentTrace, RequestUsage, WidgetSpec } from "@/lib/widget-schema";

export type { AgentTrace, RequestUsage, WidgetSpec };

export type DashboardWidget = WidgetSpec;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  widgetId?: string;
  tone?: "normal" | "error";
  usage?: RequestUsage;
  trace?: AgentTrace;
};

export type ApiHealth = {
  status: "connected" | "missing_key" | "error";
  model: string | null;
};
