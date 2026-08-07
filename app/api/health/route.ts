import { getOpenAIModel } from "@/lib/openai";

export const runtime = "nodejs";

export async function GET() {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ status: "missing_key", model: null });
  }

  return Response.json({ status: "connected", model: getOpenAIModel() });
}
