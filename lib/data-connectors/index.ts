import { bankOfCanadaConnector } from "./bank-of-canada";
import { irccPermanentResidentsConnector } from "./ircc-permanent-residents";
import { statisticsCanadaConnector } from "./statistics-canada";
import { detectMaterialQualifiers } from "./query-capabilities";
import {
  ConnectorUnavailableError,
  type DataConnectorResolution,
  type DataConnectorResult,
} from "./types";
import { usBureauLaborStatisticsConnector } from "./us-bureau-labor-statistics";
import { worldBankCommodityConnector } from "./world-bank-commodities";
import { worldBankIndicatorsConnector } from "./world-bank-indicators";

const CONNECTORS = [
  irccPermanentResidentsConnector,
  worldBankCommodityConnector,
  bankOfCanadaConnector,
  worldBankIndicatorsConnector,
  usBureauLaborStatisticsConnector,
  statisticsCanadaConnector,
];

export async function resolveOfficialConnector(query: string): Promise<DataConnectorResolution> {
  const materialQualifiers = detectMaterialQualifiers(query);
  for (const connector of CONNECTORS) {
    if (materialQualifiers.length && !connector.supportsQuery?.(query)) continue;
    try {
      const result = await connector.tryResolve(query);
      if (result) return { status: "success", connectorId: connector.id, result };
    } catch (error) {
      console.error(`[Polaris connector:${connector.id}]`, error);
      if (error instanceof ConnectorUnavailableError) {
        return {
          status: "unavailable",
          connectorId: error.connectorId,
          sourceName: error.sourceName,
          message: error.message,
          ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
        };
      }
      return {
        status: "unavailable",
        connectorId: connector.id,
        sourceName: connector.id,
        message: "The matched official data source is temporarily unavailable.",
      };
    }
  }
  return { status: "unsupported" };
}

export async function resolveWithOfficialConnector(query: string): Promise<DataConnectorResult | null> {
  const resolution = await resolveOfficialConnector(query);
  return resolution.status === "success" ? resolution.result : null;
}

export async function resolveWithOfficialProxy(query: string): Promise<DataConnectorResult | null> {
  for (const connector of CONNECTORS) {
    if (!connector.tryResolveProxy) continue;
    try {
      const result = await connector.tryResolveProxy(query);
      if (result) return result;
    } catch (error) {
      console.error(`[Polaris proxy:${connector.id}]`, error);
    }
  }
  return null;
}
