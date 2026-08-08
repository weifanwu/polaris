import { bankOfCanadaConnector } from "./bank-of-canada";
import { statisticsCanadaConnector } from "./statistics-canada";
import { detectMaterialQualifiers } from "./query-capabilities";
import type { ConnectorBoundary, DataConnectorResult } from "./types";
import { usBureauLaborStatisticsConnector } from "./us-bureau-labor-statistics";
import { worldBankCommodityConnector } from "./world-bank-commodities";
import { worldBankIndicatorsConnector } from "./world-bank-indicators";

const CONNECTORS = [
  worldBankCommodityConnector,
  bankOfCanadaConnector,
  worldBankIndicatorsConnector,
  usBureauLaborStatisticsConnector,
  statisticsCanadaConnector,
];

export function inspectOfficialConnectorBoundary(query: string): ConnectorBoundary | null {
  for (const connector of CONNECTORS) {
    const boundary = connector.inspect?.(query);
    if (boundary) return boundary;
  }
  return null;
}

export async function resolveWithOfficialConnector(query: string): Promise<DataConnectorResult | null> {
  if (inspectOfficialConnectorBoundary(query)) return null;
  const materialQualifiers = detectMaterialQualifiers(query);
  for (const connector of CONNECTORS) {
    if (materialQualifiers.length && !connector.supportsQuery?.(query)) continue;
    try {
      const result = await connector.tryResolve(query);
      if (result) return result;
    } catch (error) {
      console.error(`[Polaris connector:${connector.id}]`, error);
    }
  }
  return null;
}
