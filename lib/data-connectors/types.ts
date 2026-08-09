import type { WidgetSpec } from "@/lib/widget-schema";

export type ConnectorWidget = Omit<WidgetSpec, "id" | "originalQuery" | "generatedAt">;

export type DataConnectorResult = {
  message: string;
  widget: ConnectorWidget;
};

export class ConnectorUnavailableError extends Error {
  connectorId: string;
  sourceName: string;
  retryAfterSeconds?: number;

  constructor(input: {
    connectorId: string;
    sourceName: string;
    message: string;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "ConnectorUnavailableError";
    this.connectorId = input.connectorId;
    this.sourceName = input.sourceName;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

export type DataConnectorResolution =
  | { status: "success"; connectorId: string; result: DataConnectorResult }
  | {
      status: "unavailable";
      connectorId: string;
      sourceName: string;
      message: string;
      retryAfterSeconds?: number;
    }
  | { status: "unsupported" };

export type DataConnector = {
  id: string;
  supportsQuery?: (query: string) => boolean;
  tryResolve: (query: string) => Promise<DataConnectorResult | null>;
  tryResolveProxy?: (query: string) => Promise<DataConnectorResult | null>;
};
