"use server";

import { AGENT_SYSTEM, type AgentPacket, PARSE_SYSTEM, type RunJson, sanitizeRun } from "@/lib/fermentation/agent";

const MODEL = process.env.FERMATWIN_MODEL ?? "gpt-4o-mini";

async function chatJson(system: string, user: string, json: boolean): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
    return body.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

/** Sentence to next run JSON. Returns null when the language API is off, so the client uses its offline parser. */
export async function parseTurn(
  utterance: string,
  current: RunJson,
  topCandidateId: string | null,
): Promise<{ run: RunJson; source: string } | null> {
  const text = await chatJson(
    PARSE_SYSTEM,
    JSON.stringify({ sentence: utterance.slice(0, 500), currentRun: current, topCandidateId }),
    true,
  );
  if (text === null) return null;
  try {
    return { run: sanitizeRun(JSON.parse(text), current), source: MODEL };
  } catch {
    // GPT returned prose instead of JSON: reject the turn and keep the previous run.
    return {
      run: { ...current, intent: "unsupported", unsupportedReason: "Language model did not return JSON." },
      source: MODEL,
    };
  }
}

/** Agent paragraph from the packet. Returns null when the language API is off, so the client uses the template. */
export async function writeParagraph(packet: AgentPacket): Promise<{ text: string; source: string } | null> {
  const text = await chatJson(AGENT_SYSTEM, JSON.stringify(packet), false);
  return text ? { text: text.trim(), source: MODEL } : null;
}
