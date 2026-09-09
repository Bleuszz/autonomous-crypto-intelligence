export type ResearchDraft = {
  fact: string;
  inference: string;
  uncertainty: string;
  speculation: string;
  raw: string;
  model: string;
};

function splitSections(text: string): Omit<ResearchDraft, "raw" | "model"> {
  const grab = (label: string) => {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*([\\s\\S]*?)(?=\\n\\s*(FACT|INFERENCE|UNCERTAINTY|SPECULATION)\\b|$)`, "i");
    const m = text.match(re);
    return m?.[1]?.trim() ?? "";
  };
  return {
    fact: grab("FACT") || "The model did not emit a FACT section. Treat the raw output as unverified.",
    inference: grab("INFERENCE") || "",
    uncertainty: grab("UNCERTAINTY") || "",
    speculation: grab("SPECULATION") || "",
  };
}

export async function runResearch(promptContext: string): Promise<{ ok: true; draft: ResearchDraft } | { ok: false; error: string }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: false, error: "AI research is unavailable in this environment" };

  const sys = `You are a crypto research analyst for a paper-trading desk.
Separate your answer into exactly four sections headed:
FACT
INFERENCE
UNCERTAINTY
SPECULATION

Rules:
- FACT: only statements supported by the supplied evidence. Include numbers and timestamps from the evidence.
- INFERENCE: reasoned conclusions, labelled as inference.
- UNCERTAINTY: what is missing, stale, or unverified (on-chain completeness, wallet identity, social authenticity).
- SPECULATION: optional hypotheses. Never present as fact.
- Never claim a token is safe. Never promise profit. Never invent prices, balances, or contract flags.
- Keep each section concise (under 140 words).`;

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 1100,
        temperature: 0.2,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: promptContext },
        ],
      }),
    });
    if (!res.ok) return { ok: false, error: `xAI API error ${res.status}` };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content ?? "";
    if (!raw.trim()) return { ok: false, error: "Empty model response" };
    return { ok: true, draft: { ...splitSections(raw), raw, model: "grok-4.5" } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "research failed" };
  }
}
