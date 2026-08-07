import type { RequestUsage, WidgetSpec } from "@/lib/widget-schema";

export type { RequestUsage, WidgetSpec };

export type DashboardWidget = WidgetSpec & {
  isDemo?: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  widgetId?: string;
  tone?: "normal" | "error";
  usage?: RequestUsage;
};

export type ApiHealth = {
  status: "connected" | "missing_key" | "error";
  model: string | null;
};
