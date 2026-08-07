import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";
import {
  generateWidgetResultSchema,
  intentResolutionSchema,
  modelWidgetResultSchema,
  widgetSpecSchema,
  type GenerateWidgetResult,
} from "@/lib/widget-schema";

export const runtime = "nodejs";

const INTENT_PROMPT = `Resolve a multi-turn data-dashboard conversation before any web research.
Treat the latest unresolved data request as the active goal. Merge follow-up answers with constraints established in earlier turns, including metric, geography, period, comparison groups, calculation method, and visualization choice. Never ask again for information the user already supplied. Ignore earlier requests that were already completed when a newer request is active.
If the user says remaining choices are flexible or says an option does not matter, choose a sensible comparable default instead of asking about it again. Ask one concise follow-up only when a missing choice would materially change the requested dataset. Do not ask for optional details that can be handled with a reasonable default.
When ready, resolvedQuery must be a concise, standalone restatement containing every material choice from the conversation. When clarification is needed, message must ask only for the still-missing information and resolvedQuery must summarize what is already known. Do not search the web or invent data.`;

const SYSTEM_PROMPT = `You turn a fully resolved data request into exactly one dashboard widget.
Use Web Search for current values, prices, economic data, market data, or recent events. Use only numbers directly supported by search results; never recall, estimate, interpolate, or invent values.
For exact lists and time series, search with the relevant English name, ticker, or identifier in addition to the user's language. Prefer direct historical-data tables and primary or official sources. Run additional searches and open the most useful result pages until every requested row is supported; do not stop after a snippet that contains only part of the requested range.
Prefer 3–30 comparable rows or time-series rows. Return no more than 6 columns and 30 rows. Every row must contain exactly one string cell per column. Mark each column's data type and unit. For line_chart and bar_chart, use the first column as the x-axis and make every remaining series numeric. For metric, place the primary numeric value in the first row's first numeric column. Choose table when the shape is not clearly chartable.
If ambiguity would materially change the answer, return needs_clarification with widget null. If trustworthy search evidence is insufficient, return cannot_answer with widget null. A success response must contain a non-empty widget.
Do not output Markdown, HTML, React, JavaScript, or commentary outside the schema.`;

const RETRY_PROMPT = `This is a second research pass because the first pass could not produce a complete, source-backed dataset.
Search again from scratch with different English query wording and inspect direct data pages rather than relying on search snippets. For market prices, prioritize historical quote tables from exchanges and established financial-data publishers and verify the requested completed trading dates. For economic data, prioritize the relevant central bank, statistics agency, or official release archive. Cross-check the full requested range when possible.
Keep the same strict accuracy standard: never fill a missing row from memory or inference.`;

type SourceCandidate = { title: string; url: string };
type ConversationTurn = { role: "user" | "assistant"; content: string };

function parseConversationHistory(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-12)
    .flatMap((turn): ConversationTurn[] => {
      if (!turn || typeof turn !== "object") return [];
      const candidate = turn as { role?: unknown; content?: unknown };
      if (
        (candidate.role !== "user" && candidate.role !== "assistant") ||
        typeof candidate.content !== "string"
      ) {
        return [];
      }
      const content = candidate.content.trim().slice(0, 1_000);
      return content ? [{ role: candidate.role, content }] : [];
    });
}

function collectSources(response: Awaited<ReturnType<ReturnType<typeof getOpenAIClient>["responses"]["parse"]>>) {
  const found = new Map<string, SourceCandidate>();

  for (const item of response.output) {
    if (item.type === "web_search_call" && "sources" in item.action) {
      for (const source of item.action.sources ?? []) {
        if (source.url) {
          found.set(source.url, {
            title: new URL(source.url).hostname,
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
              title: annotation.title || new URL(annotation.url).hostname,
              url: annotation.url,
            });
          }
        }
      }
    }
  }

  return Array.from(found.values()).slice(0, 5);
}

function friendlyError(error: unknown) {
  if (error instanceof OpenAI.AuthenticationError) {
    return [401, "OpenAI API key 无效，请检查 OPENAI_API_KEY。"] as const;
  }
  if (error instanceof OpenAI.RateLimitError) {
    return [429, "OpenAI 请求过于频繁或额度不足，请稍后再试。"] as const;
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return [504, "Web 搜索超时了，请缩小问题范围后重试。"] as const;
  }
  if (error instanceof OpenAI.APIError) {
    return [502, "OpenAI 暂时无法完成这次查询，请稍后再试。"] as const;
  }
  return [500, "生成组件时发生错误，请重试。"] as const;
}

async function searchForWidget(
  client: ReturnType<typeof getOpenAIClient>,
  query: string,
  retry: boolean,
) {
  return client.responses.parse(
    {
      model: getOpenAIModel(),
      reasoning: { effort: retry ? "high" : "medium" },
      tools: [{ type: "web_search", search_context_size: "high" }],
      tool_choice: "required",
      max_tool_calls: retry ? 10 : 8,
      include: ["web_search_call.action.sources"],
      input: [
        { role: "developer", content: SYSTEM_PROMPT },
        ...(retry ? [{ role: "developer" as const, content: RETRY_PROMPT }] : []),
        { role: "user", content: query },
      ],
      text: {
        format: zodTextFormat(modelWidgetResultSchema, "polaris_widget_result"),
      },
    },
    { timeout: 60_000 },
  );
}

async function resolveIntent(
  client: ReturnType<typeof getOpenAIClient>,
  query: string,
  history: ConversationTurn[],
) {
  return client.responses.parse(
    {
      model: getOpenAIModel(),
      reasoning: { effort: "low" },
      input: [
        { role: "developer", content: INTENT_PROMPT },
        ...history,
        { role: "user", content: query },
      ],
      text: {
        format: zodTextFormat(intentResolutionSchema, "polaris_resolved_intent"),
      },
    },
    { timeout: 20_000 },
  );
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "缺少 OPENAI_API_KEY。你仍然可以使用 Load demo 预览界面。" },
      { status: 503 },
    );
  }

  let query = "";
  let history: ConversationTurn[] = [];
  let skipClarification = false;
  try {
    const body = (await request.json()) as {
      query?: unknown;
      history?: unknown;
      skipClarification?: unknown;
    };
    query = typeof body.query === "string" ? body.query.trim() : "";
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
    const client = getOpenAIClient();
    let resolvedQuery = query;

    if (!skipClarification) {
      const intentResponse = await resolveIntent(client, query, history);
      const intent = intentResponse.output_parsed;
      if (!intent) {
        throw new Error("Structured intent response was empty");
      }
      if (intent.status === "needs_clarification") {
        return Response.json(
          generateWidgetResultSchema.parse({
            status: "needs_clarification",
            message: intent.message,
            widget: null,
          }),
        );
      }
      resolvedQuery = intent.resolvedQuery.trim().slice(0, 500) || query;
    }

    let response = await searchForWidget(client, resolvedQuery, false);
    let parsed = response.output_parsed;
    if (!parsed) {
      throw new Error("Structured response was empty");
    }

    let sources = collectSources(response);
    const needsResearchRetry =
      parsed.status === "cannot_answer" ||
      (parsed.status === "success" && (!parsed.widget || sources.length === 0));

    if (needsResearchRetry) {
      response = await searchForWidget(client, resolvedQuery, true);
      parsed = response.output_parsed;
      if (!parsed) {
        throw new Error("Structured retry response was empty");
      }
      sources = collectSources(response);
    }

    if (parsed.status !== "success" || !parsed.widget) {
      const result: GenerateWidgetResult = {
        status: parsed.status === "success" ? "cannot_answer" : parsed.status,
        message:
          parsed.status === "success"
            ? "搜索完成，但没有得到可渲染的数据。"
            : parsed.message,
        widget: null,
      };
      return Response.json(generateWidgetResultSchema.parse(result));
    }

    if (sources.length === 0) {
      return Response.json(
        { error: "搜索返回了数据，但没有可验证的来源链接，因此没有创建组件。" },
        { status: 422 },
      );
    }

    const widget = widgetSpecSchema.parse({
      ...parsed.widget,
      id: crypto.randomUUID(),
      originalQuery: resolvedQuery,
      sources,
      generatedAt: new Date().toISOString(),
    });

    return Response.json(
      generateWidgetResultSchema.parse({
        status: "success",
        message: parsed.message,
        widget,
      }),
    );
  } catch (error) {
    const [status, message] = friendlyError(error);
    return Response.json({ error: message }, { status });
  }
}
