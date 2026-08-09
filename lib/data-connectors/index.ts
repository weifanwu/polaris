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

export type OfficialRecoveryAlternative = {
  connectorId: string;
  result: DataConnectorResult;
  proposedQuery: string;
  message: string;
};

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

export function buildOfficialRecoveryQuery(query: string) {
  const netMigration = /(?:net (?:international )?migration|净(?:国际)?移民)/i.test(query);
  const incompatibleFrequency = /(?:每月|逐月|月度|环比|每季|季度|monthly|months?|month.?over.?month|quarterly|quarters?|quarter.?over.?quarter|\bmom\b|\bqoq\b)/i.test(query);
  if (!netMigration || !incompatibleFrequency) return null;

  const annual = query
    .replace(/(?:每月|逐月|月度|环比|每季|季度)/gi, "年度")
    .replace(/(?:monthly|months?|month.?over.?month|quarterly|quarters?|quarter.?over.?quarter|\bmom\b|\bqoq\b)/gi, "annual")
    .replace(/\s{2,}/g, " ")
    .trim();
  return `${annual}；使用 World Bank SM.POP.NETM 的同口径年度净移民人数，不插值、不进行频率拆分`.slice(0, 500);
}

export async function resolveWithOfficialRecoveryAlternative(query: string): Promise<OfficialRecoveryAlternative | null> {
  const proposedQuery = buildOfficialRecoveryQuery(query);
  if (!proposedQuery) return null;
  const result = await worldBankIndicatorsConnector.tryResolve(proposedQuery);
  if (!result) return null;
  const chinese = /[\u3400-\u9fff]/.test(query);
  return {
    connectorId: worldBankIndicatorsConnector.id,
    result,
    proposedQuery,
    message: chinese
      ? "加拿大官方净移民主要按季度发布，美国可比序列主要按年度发布，因此不能诚实拆成月度值。建议改用 World Bank/UN 的 SM.POP.NETM 同口径年度净移民序列，对比过去10年；数据已经加载并验证，批准后会直接画图，不再搜索或调用模型。"
      : "Comparable monthly net-migration series are not published for both countries. Use the standardized annual World Bank/UN SM.POP.NETM series for the last 10 years instead; the data are already loaded and validated, so approval will render it without another search or model call.",
  };
}
