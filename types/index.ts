import type { WidgetSpec } from "@/lib/widget-schema";

export type { WidgetSpec };

export type DashboardWidget = WidgetSpec & {
  isDemo?: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  widgetId?: string;
  tone?: "normal" | "error";
};

export type ApiHealth = {
  status: "connected" | "missing_key" | "error";
  model: string | null;
};
