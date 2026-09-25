import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

export interface JsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface LlmInfo {
  provider: "OpenAI" | "Anthropic" | null;
  model: string | null;
  error?: string;
}

export function llmInfo(): LlmInfo {
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_MODEL || null;
    return {
      provider: "OpenAI",
      model,
      error: model ? undefined : "OPENAI_MODEL is not set. Add OPENAI_MODEL=<model id> to .env.local.",
    };
  }
  if (process.env.ANTHROPIC_API_KEY) return { provider: "Anthropic", model: ANTHROPIC_MODEL };
  return { provider: null, model: null, error: "No LLM configured: set OPENAI_API_KEY (+ OPENAI_MODEL) or ANTHROPIC_API_KEY in .env.local." };
}

export function llmLabel(): string {
  const i = llmInfo();
  if (!i.provider) return "none (cache only)";
  return i.model ? `${i.provider} ${i.model}` : `${i.provider} (OPENAI_MODEL not set)`;
}

export async function complete({
  system,
  user,
  jsonSchema,
  maxTokens = 4000,
}: {
  system: string;
  user: string;
  jsonSchema?: JsonSchema;
  maxTokens?: number;
}): Promise<string> {
  const info = llmInfo();
  if (info.error) throw new Error(info.error);

  if (info.provider === "OpenAI") {
    const client = new OpenAI();
    const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: info.model!,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: jsonSchema
        ? { type: "json_schema", json_schema: { name: jsonSchema.name, schema: jsonSchema.schema, strict: true } }
        : undefined,
    };
    let res: OpenAI.Chat.ChatCompletion;
    try {
      res = await client.chat.completions.create(request);
    } catch (err) {
      // Some OpenAI models (reasoning models) only accept the default temperature.
      if (!/temperature/i.test((err as Error).message)) throw err;
      const { temperature: _omit, ...rest } = request;
      void _omit;
      res = await client.chat.completions.create(rest);
    }
    const msg = res.choices[0]?.message;
    if (msg?.refusal) throw new Error(`OpenAI refused: ${msg.refusal}`);
    return (msg?.content ?? "").trim();
  }

  const client = new Anthropic();
  const res = await client.messages.create({
    model: info.model!,
    max_tokens: maxTokens,
    temperature: 0,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

export function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
  if (start < 0 || end < start) throw new Error("no JSON found in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}
