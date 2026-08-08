import type { WidgetSpec } from "@/lib/widget-schema";

export type ConnectorWidget = Omit<WidgetSpec, "id" | "originalQuery" | "generatedAt">;

export type DataConnectorResult = {
  message: string;
  widget: ConnectorWidget;
};

export type ConnectorBoundary = {
  status: "needs_clarification" | "cannot_answer";
  message: string;
  conversationContext?: string;
};

export type DataConnector = {
  id: string;
  inspect?: (query: string) => ConnectorBoundary | null;
  supportsQuery?: (query: string) => boolean;
  tryResolve: (query: string) => Promise<DataConnectorResult | null>;
};
