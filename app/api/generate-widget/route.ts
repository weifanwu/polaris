import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient, getOpenAIModel } from "@/lib/openai";
import {
  generateWidgetResultSchema,
  modelWidgetResultSchema,
  widgetSpecSchema,
  type GenerateWidgetResult,
} from "@/lib/widget-schema";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You turn a user's data question into exactly one dashboard widget.
Use Web Search for current values, prices, economic data, market data, or recent events. Use only numbers directly supported by search results; never recall, estimate, interpolate, or invent values.
Prefer 3–30 comparable rows or time-series rows. Return no more than 6 columns and 30 rows. Every row must contain exactly one string cell per column. Mark each column's data type and unit. For line_chart and bar_chart, use the first column as the x-axis and make every remaining series numeric. For metric, place the primary numeric value in the first row's first numeric column. Choose table when the shape is not clearly chartable.
If ambiguity would materially change the answer, return needs_clarification with widget null. If trustworthy search evidence is insufficient, return cannot_answer with widget null. A success response must contain a non-empty widget.
Do not output Markdown, HTML, React, JavaScript, or commentary outside the schema.`;

type SourceCandidate = { title: string; url: string };

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

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "缺少 OPENAI_API_KEY。你仍然可以使用 Load demo 预览界面。" },
      { status: 503 },
    );
  }

  let query = "";
  try {
    const body = (await request.json()) as { query?: unknown };
    query = typeof body.query === "string" ? body.query.trim() : "";
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
    const response = await client.responses.parse(
      {
        model: getOpenAIModel(),
        reasoning: { effort: "low" },
        tools: [{ type: "web_search", search_context_size: "medium" }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: [
          { role: "developer", content: SYSTEM_PROMPT },
          { role: "user", content: query },
        ],
        text: {
          format: zodTextFormat(modelWidgetResultSchema, "polaris_widget_result"),
        },
      },
      { timeout: 45_000 },
    );

    const parsed = response.output_parsed;
    if (!parsed) {
      throw new Error("Structured response was empty");
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

    const sources = collectSources(response);
    if (sources.length === 0) {
      return Response.json(
        { error: "搜索返回了数据，但没有可验证的来源链接，因此没有创建组件。" },
        { status: 422 },
      );
    }

    const widget = widgetSpecSchema.parse({
      ...parsed.widget,
      id: crypto.randomUUID(),
      originalQuery: query,
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
