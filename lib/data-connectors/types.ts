import type { WidgetSpec } from "@/lib/widget-schema";

export type ConnectorWidget = Omit<WidgetSpec, "id" | "originalQuery" | "generatedAt">;

export type DataConnectorResult = {
  message: string;
  widget: ConnectorWidget;
};

export type DataConnector = {
  id: string;
  tryResolve: (query: string) => Promise<DataConnectorResult | null>;
};
