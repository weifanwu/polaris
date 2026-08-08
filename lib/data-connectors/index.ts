import { bankOfCanadaConnector } from "./bank-of-canada";
import type { DataConnectorResult } from "./types";
import { worldBankCommodityConnector } from "./world-bank-commodities";

const CONNECTORS = [worldBankCommodityConnector, bankOfCanadaConnector];

export async function resolveWithOfficialConnector(query: string): Promise<DataConnectorResult | null> {
  for (const connector of CONNECTORS) {
    try {
      const result = await connector.tryResolve(query);
      if (result) return result;
    } catch (error) {
      console.error(`[Polaris connector:${connector.id}]`, error);
    }
  }
  return null;
}
