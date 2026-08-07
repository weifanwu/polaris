import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export function getOpenAIModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.6";
}

export function getOpenAIIntentModel() {
  return process.env.OPENAI_INTENT_MODEL?.trim() || "gpt-5.6-luna";
}

export function getOpenAIFastModel() {
  return process.env.OPENAI_FAST_MODEL?.trim() || "gpt-5.6-terra";
}
