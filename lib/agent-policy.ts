export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ResearchMode = "simple" | "complex";

export function parseConversationHistory(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-4)
    .flatMap((turn): ConversationTurn[] => {
      if (!turn || typeof turn !== "object") return [];
      const candidate = turn as { role?: unknown; content?: unknown };
      if (
        (candidate.role !== "user" && candidate.role !== "assistant") ||
        typeof candidate.content !== "string"
      ) {
        return [];
      }
      const content = candidate.content.trim().slice(0, 400);
      return content ? [{ role: candidate.role, content }] : [];
    });
}

export function parseConversationContext(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

export function inferResearchMode(query: string): ResearchMode {
  const complexPattern =
    /(每月|逐月|环比|同比|历史|最近.{0,8}(?:个月|年)|过去.{0,8}(?:个月|年)|monthly|month.over.month|year.over.year|historical|time.?series|last\s+\d+\s+(?:months|years))/i;
  return complexPattern.test(query) ? "complex" : "simple";
}

export function inferPartialDataPolicy(query: string) {
  return !/(必须完整|完整连续|全部月份都要|不能缺失|complete uninterrupted|no missing data)/i.test(
    query,
  );
}
