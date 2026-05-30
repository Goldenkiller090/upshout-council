import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { Card, CouncilEvent, Expert } from "./types";
import { EXPERTS } from "./experts";
import { fromMicro } from "./upshot";

// Model aliases resolve against your Claude subscription via the local CLI.
const EXPERT_MODEL = "sonnet";
const SYNTH_MODEL = "opus";

type Emit = (event: CouncilEvent) => void;

/** Format micro-units as a USD amount, e.g. 732920721 -> "$732.92". */
function usd(value?: string | number): string | null {
  const n = fromMicro(value);
  return n == null ? null : `$${n.toFixed(2)}`;
}

/**
 * Describe what the card pays if it wins. Upshot has separate reward rails —
 * CASH (real money in `potentialPrize`), POINTS/GOLD (in `pointsValue`), and SHOT
 * (a raffle/prize entry). A CASH card legitimately has pointsValue 0 and vice
 * versa, so we must read the right field for the rail or the brief understates it.
 */
function formatReward(card: Card): string {
  const rail = (card.prizeType ?? card.event?.kind ?? "").toUpperCase();
  const cash = usd(card.potentialPrize ?? card.prizeAmount);
  const points = fromMicro(card.pointsValue);

  if (rail === "CASH") {
    return `Reward if it wins: CASH — ${cash ?? "$0.00"} cash payout (this is a cash card; points are 0 by design)`;
  }
  if (rail === "SHOT") {
    return `Reward if it wins: a SHOT (raffle/prize entry)${cash ? `, prize ${cash}` : ""}`;
  }
  if (points != null && points > 0) {
    return `Reward if it wins: ${points} ${rail === "GOLD" ? "GOLD" : "points"}`;
  }
  // Unknown rail — surface whatever is non-zero rather than defaulting to points.
  if (cash && cash !== "$0.00") return `Reward if it wins: ${cash} (${rail || "prize"})`;
  return `Reward if it wins: ${points ?? 0} points`;
}

/** Build a compact, factual brief about the card for every expert to share. */
function cardBrief(card: Card): string {
  const lines: string[] = [];
  lines.push(`Card: "${card.name}"`);
  if (card.rarity) lines.push(`Rarity: ${card.rarity}`);
  if (card.maxSupply != null) lines.push(`Max supply: ${card.maxSupply}`);
  lines.push(formatReward(card));
  if (card.event) {
    const e = card.event;
    const isCash = (card.prizeType ?? e.kind ?? "").toUpperCase() === "CASH";
    if (e.name) lines.push(`Event: ${e.name}`);
    if (e.status) lines.push(`Event status: ${e.status}`);
    if (e.kind) lines.push(`Event kind: ${e.kind}`);
    if (e.eventDate) lines.push(`Event date: ${e.eventDate}`);
    const perCard = isCash ? usd(e.pricePerCard) : fromMicro(e.pricePerCard);
    if (perCard != null) lines.push(`Mint price per card: ${isCash ? perCard : `${perCard} GOLD`}`);
    const pool = isCash ? usd(e.prizePool) : fromMicro(e.prizePool);
    if (pool != null) lines.push(`Event prize pool: ${isCash ? pool : `${pool} GOLD`}`);
    if (e.status === "RESOLVED") {
      lines.push(
        `ALREADY RESOLVED — winning outcome: ${e.winningOutcomeId ?? "n/a"}, this card's outcome: ${card.outcomeId ?? "n/a"}`
      );
    }
  }
  if (card.pricing) {
    const buy = fromMicro(card.pricing.buyPrice);
    const sell = fromMicro(card.pricing.sellPrice);
    if (buy != null) lines.push(`Marketplace buy price: ${buy} ${card.pricing.currency ?? "GOLD"}`);
    if (sell != null) lines.push(`Marketplace sell price: ${sell} ${card.pricing.currency ?? "GOLD"}`);
    if (card.pricing.isTradeable != null) lines.push(`Tradeable: ${card.pricing.isTradeable}`);
  }
  return lines.join("\n");
}

const SHARED_CONTEXT = `Upshot Cards is a prediction-market platform: a "card" represents a specific
outcome (e.g. "ETH closes above $4000"). If the predicted outcome happens, the card "wins" and pays out a
reward. Rewards come on different rails depending on the card: CASH (real money), POINTS/GOLD (in-app points),
or a SHOT (a raffle/prize entry) — the brief states which rail and amount apply to this card.
You are evaluating whether this card's predicted outcome will occur — i.e. the probability it WINS — and
whether buying it at the current marketplace price is a good bet given that reward.`;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Run one Agent SDK query, forwarding streamed text deltas to `onText`.
 * Returns the final assistant text. Uses the local Claude subscription;
 * WebSearch/WebFetch run headless (permissions bypassed for this trusted app).
 */
interface QueryCallbacks {
  onText: (text: string) => void;
  onThink?: (text: string) => void;
  onTool?: (tool: string, detail: string) => void;
}

/** Summarize a tool call's input into a short human label. */
function toolDetail(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "WebSearch") return String(i.query ?? "");
  if (name === "WebFetch") return String(i.url ?? "");
  const s = JSON.stringify(i);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

async function runQuery(
  prompt: string,
  opts: { system: string; model: string; tools: string[]; maxTurns: number },
  cb: QueryCallbacks
): Promise<string> {
  const options: Options = {
    systemPrompt: opts.system,
    model: opts.model,
    allowedTools: opts.tools,
    includePartialMessages: true,
    maxTurns: opts.maxTurns,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    // Don't inherit the user's CLAUDE.md / settings — keep runs isolated.
    settingSources: [],
  };

  let streamed = "";
  let finalText = "";

  for await (const message of query({ prompt, options })) {
    if (message.type === "stream_event") {
      const ev = message.event as {
        type: string;
        delta?: { type?: string; text?: string; thinking?: string };
      };
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
        streamed += ev.delta.text;
        cb.onText(ev.delta.text);
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
        cb.onThink?.(ev.delta.thinking);
      }
    } else if (message.type === "assistant") {
      // Surface tool use (web searches/fetches) as live activity.
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          cb.onTool?.(block.name, toolDetail(block.name, block.input));
        }
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") finalText = message.result;
    }
  }

  return finalText.trim() || streamed.trim();
}

/** Run one expert turn with web search; forwards deltas and returns full text. */
async function runExpert(
  expert: Expert,
  userPrompt: string,
  round: number,
  emit: Emit
): Promise<string> {
  emit({ type: "expert_start", expertId: expert.id, name: expert.name, bias: expert.bias, round });

  const system = `${expert.persona}\n\n${SHARED_CONTEXT}\n\nToday's date is ${today()}. Use the WebSearch tool to research current facts before you commit to a number. Cite what you find. Keep your written analysis tight — a few short paragraphs.`;

  const full = await runQuery(
    userPrompt,
    { system, model: EXPERT_MODEL, tools: ["WebSearch", "WebFetch"], maxTurns: 16 },
    {
      onText: (text) => emit({ type: "delta", expertId: expert.id, round, text }),
      onThink: (text) => emit({ type: "think", expertId: expert.id, round, text }),
      onTool: (tool, detail) => emit({ type: "tool", expertId: expert.id, round, tool, detail }),
    }
  );

  emit({ type: "expert_done", expertId: expert.id, round });
  return full;
}

/**
 * Orchestrate the full council deliberation:
 *   Round 1 — five experts independently research and give a take (parallel)
 *   Round 2 — each expert rebuts the others after seeing all takes (parallel)
 *   Synthesis — Opus weighs everything into a final verdict (streamed)
 */
export async function runCouncil(card: Card, emit: Emit): Promise<void> {
  const brief = cardBrief(card);

  // ---- Round 1: independent research ----
  emit({ type: "status", phase: "research", message: "Council researching independently…" });

  const round1Prompt = `Here is the card under review:\n\n${brief}\n\nResearch this outcome and give your independent assessment. End your response with two lines exactly:\nPROBABILITY: <0-100>%\nLEAN: <BUY | HOLD | PASS>`;

  const round1 = await Promise.all(
    EXPERTS.map((e) => runExpert(e, round1Prompt, 1, emit))
  );

  // ---- Round 2: rebuttal / deliberation ----
  emit({ type: "status", phase: "debate", message: "Council debating each other's takes…" });

  const round2 = await Promise.all(
    EXPERTS.map((e, selfIdx) => {
      const others = EXPERTS.map((x, i) =>
        i === selfIdx ? null : `### ${x.name} (${x.bias})\n${round1[i].trim()}`
      )
        .filter(Boolean)
        .join("\n\n");

      const prompt = `The card under review:\n\n${brief}\n\nHere are the other council members' first-round takes:\n\n${others}\n\nWhere do you disagree with them, and why? Do any of their points change your view? Research further if needed. Then give your UPDATED assessment, ending with two lines exactly:\nPROBABILITY: <0-100>%\nLEAN: <BUY | HOLD | PASS>`;

      return runExpert(e, prompt, 2, emit);
    })
  );

  const finalTakes = EXPERTS.map(
    (e, i) =>
      `### ${e.name} (${e.bias})\nRound 1:\n${round1[i].trim()}\n\nRound 2 (after debate):\n${round2[i].trim()}`
  ).join("\n\n");

  // ---- Synthesis: final verdict ----
  emit({ type: "status", phase: "verdict", message: "Synthesizing the final verdict…" });

  const synthSystem = `You are the chair of a prediction-market council. Five expert analysts with different
biases (a quant, a domain insider, a contrarian, a market/odds reader, and a news analyst) have each researched
and debated a card. Weigh their arguments — don't just average them. Note where they agree and where the
disagreement is most informative. Be decisive but honest about uncertainty.\n\n${SHARED_CONTEXT}\n\nToday's date is ${today()}.`;

  const synthPrompt = `The card under review:\n\n${brief}\n\nThe council's takes:\n\n${finalTakes}\n\nDeliver the final verdict in markdown with these sections:\n\n## Verdict\nOne punchy sentence.\n\n## Final probability\nA single number 0–100% that the card WINS, plus your confidence (Low / Medium / High).\n\n## The split\nState the range of the five pilots' probabilities (lowest–highest, naming who anchored each end), then call out the SINGLE most informative disagreement — the one clash that actually matters for the decision — and say which side you sided with and why. Don't just note they agreed; surface where the tension was.\n\n## Recommendation\nBUY, HOLD, or PASS — and at the current price, is it +EV? One short paragraph.\n\n## Key factors\n3–5 bullets driving the call.\n\n## Risks\n2–3 bullets on what would make this wrong.`;

  await runQuery(
    synthPrompt,
    { system: synthSystem, model: SYNTH_MODEL, tools: [], maxTurns: 2 },
    { onText: (text) => emit({ type: "verdict_delta", text }) }
  );

  emit({ type: "done" });
}
