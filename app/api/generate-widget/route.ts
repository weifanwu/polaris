import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  buildResearchFallbackInstruction,
  inferPartialDataPolicy,
  inferResearchMode,
  isCompleteQualifiedDataRequest,
  isKnownProxyResearchRequest,
  parseConversationContext,
  parseConversationHistory,
  resolveDeterministicFollowUp,
  type ConversationTurn,
  type ResearchMode,
} from "@/lib/agent-policy";
import {
  getOpenAIClient,
  getOpenAIFastModel,
  getOpenAIIntentModel,
  getOpenAIModel,
} from "@/lib/openai";
import {
  resolveWithOfficialConnector,
  resolveWithOfficialProxy,
} from "@/lib/data-connectors";
import {
  generateWidgetResultSchema,
  intentResolutionSchema,
  modelWidgetResultSchema,
  widgetSpecSchema,
  type GenerateWidgetResult,
  type RequestUsage,
} from "@/lib/widget-schema";

export const runtime = "nodejs";

const INTENT_PROMPT = `Goal: turn the latest user message plus compact conversation state into one standalone data request.

Success criteria:
- Preserve supplied metric, geography, comparison groups, period, calculation, source preference, and chart type.
- Preserve every qualifier, especially industry versus occupation; never silently drop a qualifier to make a connector match.
- Never ask again for a supplied choice. If the user says remaining choices are flexible, choose a comparable default.
- Relative periods such as "last 10 years" are complete specifications. Interpret them as trailing calendar periods ending at the latest available observation; never ask for explicit start and end dates.
- "Current", "up to now", "当前", and short confirmations confirm a rolling range ending at the latest available observation.
- Once the user has selected industry or occupation, retain that choice and do not ask the same distinction again.
- Ask one short question only when a missing choice materially changes the dataset.
- Treat a new unrelated request as a replacement for the prior context.
- Set researchMode to complex for multi-source comparisons, long monthly histories, derived calculations, or fragmented datasets; otherwise simple.
- Set allowPartialData true unless the user explicitly requires a complete uninterrupted dataset. "Use what is available" always means true.

resolvedQuery is the compact conversation memory: include all known constraints whether ready or awaiting clarification. Do not search or invent data.`;

const SYSTEM_PROMPT = `Goal: create one source-backed dashboard widget from a resolved data request using Web Search.

Success criteria:
- Search with concise English identifiers as needed and prefer official or primary data pages.
- Use only retrieved numbers. Never recall, estimate, interpolate, or silently convert missing values to zero.
- Return 2–120 useful rows when charting a series, no more than 6 columns, and exactly one string cell per column. When a verified source exposes the requested history, preserve the full requested range instead of truncating it to a sample.
- For charts, the first column is the x-axis and remaining series are numeric. Use an empty string for a genuinely missing numeric value.
- Stop as soon as the available evidence can answer the core request usefully. Search again only for a missing required fact or comparison series.
- For fragmented series, split searches by source, entity, or date range instead of repeating the same broad query.
- You may calculate requested arithmetic from retrieved values. For month-over-month change, require both adjacent verified months and omit the calculation when either month is missing.
- If partial data is allowed, do not reject a useful chart because some requested dates are unavailable. Include verified rows, preserve gaps, and state the actual coverage and omissions in the subtitle or summary.
- For comparisons, align matching dates when possible. Rows may contain one verified series and one empty cell when coverage differs.
- Satisfy every qualifier in the resolved request. Never replace an industry, occupation, geography, demographic group, or frequency with an aggregate merely because aggregate data is easier to find.
- If the exact qualified series is unavailable, search for a credible adjacent or proxy measure before failing. Label any proxy explicitly in the title, subtitle, columns, and summary, and explain the scope difference.
- Never label an aggregate chart as the requested subgroup. A national total is not a valid proxy for an industry, occupation, geography, demographic group, or category unless the user explicitly asks for that total.
- Return cannot_answer only when fewer than two useful chart rows can be verified, no trustworthy source exists, or the result cannot be rendered honestly.

Output only the required structured result. Every success must contain a non-empty widget.`;

const exactSeriesDiscoverySchema = z.object({
  exactSeriesFound: z.boolean(),
  evidence: z.string().max(300),
});

type SourceCandidate = { title: string; url: string };
type ParsedResponse = Awaited<
  ReturnType<ReturnType<typeof getOpenAIClient>["responses"]["parse"]>
>;

function safeHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "Source";
  }
}

function collectSources(response: ParsedResponse) {
  const found = new Map<string, SourceCandidate>();

  for (const item of response.output) {
    if (item.type === "web_search_call" && "sources" in item.action) {
      for (const source of item.action.sources ?? []) {
        if (source.url) {
          found.set(source.url, {
            title: safeHostname(source.url),
            url: source.url,
          });
        }
      }
    }

    if (item.type === "message") {
      for (const content of item.content) {
        if (content.type !== "output_text") continue;
        for (const annotation of content.annotations) {
          if (annotation.type === "url_citation") {
            found.set(annotation.url, {
              title: annotation.title || safeHostname(annotation.url),
              url: annotation.url,
            });
          }
        }
      }
    }
  }

  return Array.from(found.values()).slice(0, 5);
}

function readUsage(response: ParsedResponse): RequestUsage {
  const usage = response.usage;
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details.cached_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    webSearchCalls: response.output.filter((item) => item.type === "web_search_call").length,
    modelCalls: 1,
  };
}

function addUsage(...items: RequestUsage[]): RequestUsage {
  return items.reduce<RequestUsage>(
    (total, item) => ({
      inputTokens: total.inputTokens + item.inputTokens,
      cachedInputTokens: total.cachedInputTokens + item.cachedInputTokens,
      outputTokens: total.outputTokens + item.outputTokens,
      webSearchCalls: total.webSearchCalls + item.webSearchCalls,
      modelCalls: total.modelCalls + item.modelCalls,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      webSearchCalls: 0,
      modelCalls: 0,
    },
  );
}

const ZERO_USAGE: RequestUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  webSearchCalls: 0,
  modelCalls: 0,
};

function inferFrequency(query: string) {
  if (/(逐日|每天|每日|交易日|daily|trading days?)/i.test(query)) return "daily" as const;
  if (/(每周|逐周|weekly)/i.test(query)) return "weekly" as const;
  if (/(每月|逐月|环比|同比|monthly|month.over.month|year.over.year)/i.test(query)) return "monthly" as const;
  if (/(每季|季度|quarterly)/i.test(query)) return "quarterly" as const;
  if (/(每年|年度|annual|yearly)/i.test(query)) return "annual" as const;
  return "unknown" as const;
}

function buildWebDataQuality(widget: NonNullable<GenerateWidgetResult["widget"]>, query: string) {
  const numericIndices = widget.columns.flatMap((column, index) => column.dataType === "number" ? [index] : []);
  const numericCells = widget.rows.flatMap((row) => numericIndices.map((index) => row.cells[index]?.trim() ?? ""));
  const availablePoints = numericCells.filter(Boolean).length;
  const requestedPoints = numericCells.length;
  return {
    method: "web_search" as const,
    sourceName: widget.sources[0]?.title || "Web Search",
    requestedPoints,
    availablePoints,
    missingPoints: requestedPoints - availablePoints,
    coverageStart: widget.rows[0]?.cells[0] || null,
    coverageEnd: widget.rows.at(-1)?.cells[0] || null,
    frequency: inferFrequency(query),
    verifiedAt: new Date().toISOString(),
  };
}

function connectorResponse(
  connectorResult: Awaited<ReturnType<typeof resolveWithOfficialConnector>>,
  query: string,
  usage: RequestUsage,
) {
  if (!connectorResult) return null;
  const widget = widgetSpecSchema.parse({
    ...connectorResult.widget,
    id: crypto.randomUUID(),
    originalQuery: query,
    generatedAt: new Date().toISOString(),
  });
  return Response.json(generateWidgetResultSchema.parse({
    status: "success",
    message: connectorResult.message,
    widget,
    conversationContext: query,
    usage,
  }));
}

function friendlyError(error: unknown) {
  if (error instanceof OpenAI.AuthenticationError) {
    return [401, "OpenAI API key 无效，请检查 OPENAI_API_KEY。"] as const;
  }
  if (error instanceof OpenAI.RateLimitError) {
    return [429, "OpenAI 请求过于频繁或额度不足，请稍后再试。"] as const;
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return [504, "本次检索达到时间预算，已停止继续消耗。可以缩小范围或接受部分数据后重试。"] as const;
  }
  if (error instanceof OpenAI.APIError) {
    return [502, "OpenAI 暂时无法完成这次查询，请稍后再试。"] as const;
  }
  return [500, "生成组件时发生错误，请重试。"] as const;
}

async function searchForWidget(
  client: ReturnType<typeof getOpenAIClient>,
  query: string,
  researchMode: ResearchMode,
  allowPartialData: boolean,
) {
  const complex = researchMode === "complex";
  const proxyDiscovery = isKnownProxyResearchRequest(query);
  const maxToolCalls = proxyDiscovery ? 3 : complex ? 6 : 3;
  const searchContextSize = proxyDiscovery ? "low" : complex ? "medium" : "low";
  const researchBrief = `Research budget: ${proxyDiscovery ? "proxy discovery, at most 3 web searches" : complex ? "complex, at most 6 web searches" : "simple, at most 3 web searches"}.
Partial verified rows: ${allowPartialData ? "allowed and preferred over failure" : "not allowed; the requested range must be complete"}.`;

  return client.responses.parse(
    {
      model: complex ? getOpenAIModel() : getOpenAIFastModel(),
      reasoning: { effort: "low" },
      tools: [
        {
          type: "web_search",
          search_context_size: searchContextSize,
        },
      ],
      tool_choice: "required",
      max_tool_calls: maxToolCalls,
      max_output_tokens: 6_000,
      prompt_cache_key: complex
        ? "polaris-research-complex-v3"
        : "polaris-research-simple-v3",
      include: ["web_search_call.action.sources"],
      input: [
        { role: "developer", content: SYSTEM_PROMPT },
        { role: "developer", content: researchBrief },
        { role: "developer", content: buildResearchFallbackInstruction(query) },
        { role: "user", content: query },
      ],
      text: {
        verbosity: "low",
        format: zodTextFormat(modelWidgetResultSchema, "polaris_widget_result"),
      },
    },
    { timeout: complex ? 75_000 : 45_000 },
  );
}

async function discoverExactSeries(
  client: ReturnType<typeof getOpenAIClient>,
  query: string,
) {
  return client.responses.parse(
    {
      model: getOpenAIFastModel(),
      reasoning: { effort: "none" },
      tools: [{ type: "web_search", search_context_size: "low" }],
      tool_choice: "required",
      max_tool_calls: 1,
      max_output_tokens: 400,
      prompt_cache_key: "polaris-exact-series-discovery-v1",
      include: ["web_search_call.action.sources"],
      input: [
        {
          role: "developer",
          content: `Perform one focused Web Search. Determine whether a trustworthy source publishes the exact requested time series with actual downloadable or tabulated values. Broad aggregates, related occupations, estimates, and proxies do not count as the exact series. Set exactSeriesFound true only when the exact geography, population/industry scope, frequency, metric, and requested history are available.`,
        },
        { role: "user", content: query },
      ],
      text: {
        verbosity: "low",
        format: zodTextFormat(exactSeriesDiscoverySchema, "polaris_exact_series_discovery"),
      },
    },
    { timeout: 25_000 },
  );
}

async function resolveIntent(
  client: ReturnType<typeof getOpenAIClient>,
  query: string,
  conversationContext: string,
  fallbackHistory: ConversationTurn[],
) {
  const compactState = conversationContext
    ? [{ role: "developer" as const, content: `Known conversation state: ${conversationContext}` }]
    : fallbackHistory;

  return client.responses.parse(
    {
      model: getOpenAIIntentModel(),
      reasoning: { effort: "none" },
      max_output_tokens: 500,
      prompt_cache_key: "polaris-intent-v3",
      input: [
        { role: "developer", content: INTENT_PROMPT },
        ...compactState,
        { role: "user", content: query },
      ],
      text: {
        verbosity: "low",
        format: zodTextFormat(intentResolutionSchema, "polaris_resolved_intent"),
      },
    },
    { timeout: 15_000 },
  );
}

export async function POST(request: Request) {
  let query = "";
  let conversationContext = "";
  let history: ConversationTurn[] = [];
  let skipClarification = false;
  try {
    const body = (await request.json()) as {
      query?: unknown;
      conversationContext?: unknown;
      history?: unknown;
      skipClarification?: unknown;
    };
    query = typeof body.query === "string" ? body.query.trim() : "";
    conversationContext = parseConversationContext(body.conversationContext);
    history = parseConversationHistory(body.history);
    skipClarification = body.skipClarification === true;
  } catch {
    return Response.json({ error: "请求格式无效。" }, { status: 400 });
  }

  if (!query || query.length > 500) {
    return Response.json(
      { error: "请输入 1–500 个字符的数据问题。" },
      { status: 400 },
    );
  }

  try {
    if ((!conversationContext && history.length === 0) || skipClarification) {
      const directResult = await resolveWithOfficialConnector(query);
      const directResponse = connectorResponse(directResult, query, ZERO_USAGE);
      if (directResponse) return directResponse;
    }

    const deterministicFollowUp = !skipClarification
      ? resolveDeterministicFollowUp(query, conversationContext)
      : null;
    const completeQualifiedRequest = isCompleteQualifiedDataRequest(query);

    if (!process.env.OPENAI_API_KEY && !deterministicFollowUp && !completeQualifiedRequest) {
      return Response.json(
        { error: "缺少 OPENAI_API_KEY。官方数据连接器仍可直接回答支持的数据集。" },
        { status: 503 },
      );
    }

    const client = process.env.OPENAI_API_KEY ? getOpenAIClient() : null;
    let resolvedQuery = query;
    let researchMode = inferResearchMode(query);
    let allowPartialData = inferPartialDataPolicy(query);
    let intentUsage: RequestUsage | null = null;

    if (!skipClarification) {
      if (deterministicFollowUp || completeQualifiedRequest) {
        resolvedQuery = deterministicFollowUp ?? query;
        researchMode = inferResearchMode(resolvedQuery);
        allowPartialData = inferPartialDataPolicy(resolvedQuery);
        intentUsage = ZERO_USAGE;
      } else {
        if (!client) throw new Error("OpenAI client is unavailable");
        const intentResponse = await resolveIntent(
          client,
          query,
          conversationContext,
          history,
        );
        intentUsage = readUsage(intentResponse);
        const intent = intentResponse.output_parsed;
        if (!intent) {
          throw new Error("Structured intent response was empty");
        }

        const nextContext = intent.resolvedQuery.trim().slice(0, 500) || query;
        if (intent.status === "needs_clarification") {
          return Response.json(
            generateWidgetResultSchema.parse({
              status: "needs_clarification",
              message: intent.message.trim().slice(0, 500),
              widget: null,
              conversationContext: nextContext,
              usage: intentUsage,
            }),
          );
        }

        resolvedQuery = nextContext;
        researchMode = intent.researchMode;
        allowPartialData = intent.allowPartialData;
      }
    }

    const connectorResult = await resolveWithOfficialConnector(resolvedQuery);
    const resolvedConnectorResponse = connectorResponse(
      connectorResult,
      resolvedQuery,
      intentUsage ?? ZERO_USAGE,
    );
    if (resolvedConnectorResponse) return resolvedConnectorResponse;

    if (!client) {
      return Response.json(
        { error: "这个限定条件没有匹配到官方连接器，并且缺少用于检索的 OPENAI_API_KEY。" },
        { status: 503 },
      );
    }

    let accumulatedUsage = intentUsage ?? ZERO_USAGE;
    let proxyCandidate: Awaited<ReturnType<typeof resolveWithOfficialProxy>> = null;
    if (isKnownProxyResearchRequest(resolvedQuery)) {
      proxyCandidate = await resolveWithOfficialProxy(resolvedQuery);
      const discoveryResponse = await discoverExactSeries(client, resolvedQuery);
      accumulatedUsage = addUsage(accumulatedUsage, readUsage(discoveryResponse));
      if (proxyCandidate) {
        const proxyResponse = connectorResponse(proxyCandidate, resolvedQuery, accumulatedUsage);
        if (proxyResponse) return proxyResponse;
      }
    }

    const response = await searchForWidget(
      client,
      resolvedQuery,
      researchMode,
      allowPartialData,
    );
    const parsed = response.output_parsed;
    if (!parsed) {
      throw new Error("Structured response was empty");
    }

    const usage = addUsage(accumulatedUsage, readUsage(response));
    const sources = collectSources(response);

    if (parsed.status !== "success" || !parsed.widget || sources.length === 0) {
      const proxyResult = parsed.status === "cannot_answer"
        ? proxyCandidate ?? await resolveWithOfficialProxy(resolvedQuery)
        : null;
      const proxyResponse = connectorResponse(proxyResult, resolvedQuery, usage);
      if (proxyResponse) return proxyResponse;

      const message =
        parsed.status === "success" && sources.length === 0
          ? "找到了数据，但没有可验证的来源链接，因此没有创建组件。"
          : parsed.status === "success"
            ? "搜索完成，但没有得到可渲染的数据。"
            : parsed.message;
      const result: GenerateWidgetResult = {
        status: parsed.status === "needs_clarification" ? "needs_clarification" : "cannot_answer",
        message: message.trim().slice(0, 500),
        widget: null,
        conversationContext: resolvedQuery,
        usage,
      };
      return Response.json(generateWidgetResultSchema.parse(result));
    }

    const widget = widgetSpecSchema.parse({
      ...parsed.widget,
      id: crypto.randomUUID(),
      originalQuery: resolvedQuery,
      sources,
      generatedAt: new Date().toISOString(),
    });
    const widgetWithQuality = widgetSpecSchema.parse({
      ...widget,
      dataQuality: buildWebDataQuality(widget, resolvedQuery),
    });

    return Response.json(
      generateWidgetResultSchema.parse({
        status: "success",
        message: parsed.message.trim().slice(0, 500),
        widget: widgetWithQuality,
        conversationContext: resolvedQuery,
        usage,
      }),
    );
  } catch (error) {
    const [status, message] = friendlyError(error);
    return Response.json({ error: message }, { status });
  }
}
