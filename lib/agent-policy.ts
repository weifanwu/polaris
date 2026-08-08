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

export function resolveDeterministicFollowUp(query: string, conversationContext: string) {
  if (!conversationContext) return null;
  const cleanQuery = query.trim();

  if (/^(?:软件|IT|信息技术|计算机).{0,4}(?:行业|产业)$/i.test(cleanQuery)) {
    return `${conversationContext.slice(0, 420)}; confirmed scope: software industry`.slice(0, 500);
  }
  if (/^(?:软件|IT|信息技术|计算机).{0,4}(?:职业|工种)$/i.test(cleanQuery)) {
    return `${conversationContext.slice(0, 420)}; confirmed scope: software occupation`.slice(0, 500);
  }

  const confirmsCurrentRange = /^(?:当前|现在|到现在|对的|是的|没错|current|yes|correct)$/i.test(cleanQuery);
  const hasRelativeRange = /(?:最近|过去|近|last|past).{0,16}(?:个?月|年|months?|years?)/i.test(conversationContext);
  if (confirmsCurrentRange && hasRelativeRange) {
    return `${conversationContext.slice(0, 400)}; rolling range ends at the latest available observation`.slice(0, 500);
  }

  return null;
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

export function buildResearchFallbackInstruction(query: string) {
  const hasMaterialSlice =
    /(?:\bindustry\b|\bsector\b|\boccupation\b|\bprofession\b|\bnaics\b|行业|产业|职业|工种|青年|老年|男性|女性|食品|能源|核心|省|州|城市)/i.test(query);

  return `The deterministic connector registry did not return an exact match. Web research is mandatory for this request.
- Search for the exact requested metric and every requested dimension first; do not stop merely because one official API lacks the series.
- Search credible primary data, downloadable tables, government releases, industry reports, and well-attributed secondary sources.
- If the exact series cannot be verified, search for a useful adjacent or proxy measure before returning cannot_answer.
- A proxy result must be named as a proxy in the title, subtitle, column labels, and summary, and must explain how its scope differs from the request.
- Never substitute a national total or another aggregate for a requested subgroup${hasMaterialSlice ? "; this request contains a material subgroup/category qualifier" : ""}.
- Return cannot_answer only after the web-search budget cannot find either the exact series or a useful, honestly labelled proxy.`;
}
