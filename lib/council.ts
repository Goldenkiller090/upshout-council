import Anthropic from "@anthropic-ai/sdk";
import type { Card, CouncilEvent, Expert } from "./types";
import { EXPERTS } from "./experts";
import { fromMicro } from "./upshot";

const EXPERT_MODEL = "claude-sonnet-4-6";
const SYNTH_MODEL = "claude-opus-4-8";

// Beta namespace because adaptive thinking + output_config.effort are typed there.
type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type BetaTool = Anthropic.Beta.Messages.BetaToolUnion;

const WEB_TOOLS: BetaTool[] = [
  { type: "web_search_20260209", name: "web_search" } as unknown as BetaTool,
];

type Emit = (event: CouncilEvent) => void;

/** Build a compact, factual brief about the card for every expert to share. */
function cardBrief(card: Card): string {
  const lines: string[] = [];
  lines.push(`Card: "${card.name}"`);
  if (card.rarity) lines.push(`Rarity: ${card.rarity}`);
  if (card.maxSupply != null) lines.push(`Max supply: ${card.maxSupply}`);
  const points = fromMicro(card.pointsValue);
  if (points != null) lines.push(`Points value if it wins: ${points}`);
  if (card.event) {
    const e = card.event;
    if (e.name) lines.push(`Event: ${e.name}`);
    if (e.status) lines.push(`Event status: ${e.status}`);
    if (e.kind) lines.push(`Event kind: ${e.kind}`);
    if (e.eventDate) lines.push(`Event date: ${e.eventDate}`);
    const perCard = fromMicro(e.pricePerCard);
    if (perCard != null) lines.push(`Mint price per card: ${perCard} GOLD`);
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
outcome (e.g. "ETH closes above $4000"). If the predicted outcome happens, the card "wins" and pays out points.
You are evaluating whether this card's predicted outcome will occur — i.e. the probability it WINS — and
whether buying it at the current marketplace price is a good bet.`;

// Stamped at request time; kept out of any cached prefix.
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Stream a beta Messages request, forwarding text deltas to `onText`.
 * Returns the final stop_reason. Web search runs server-side automatically.
 */
async function streamBeta(
  client: Anthropic,
  params: Omit<BetaParams, "stream">,
  onText: (text: string) => void
): Promise<string | null> {
  const stream = await client.beta.messages.create({ ...params, stream: true });
  let stopReason: string | null = null;
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onText(event.delta.text);
    } else if (event.type === "message_delta" && event.delta.stop_reason) {
      stopReason = event.delta.stop_reason;
    }
  }
  return stopReason;
}

/** Run one expert turn with web search; forwards deltas and returns full text. */
async function runExpert(
  client: Anthropic,
  expert: Expert,
  userPrompt: string,
  round: number,
  emit: Emit
): Promise<string> {
  emit({ type: "expert_start", expertId: expert.id, name: expert.name, bias: expert.bias, round });

  const system = `${expert.persona}\n\n${SHARED_CONTEXT}\n\nToday's date is ${today()}. Use the web_search tool to research current facts before you commit to a number. Cite what you find.`;

  let full = "";
  await streamBeta(
    client,
    {
      model: EXPERT_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system,
      tools: WEB_TOOLS,
      messages: [{ role: "user", content: userPrompt }],
    },
    (text) => {
      full += text;
      emit({ type: "delta", expertId: expert.id, round, text });
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
  const client = new Anthropic();
  const brief = cardBrief(card);

  // ---- Round 1: independent research ----
  emit({ type: "status", phase: "research", message: "Council researching independently…" });

  const round1Prompt = `Here is the card under review:\n\n${brief}\n\nResearch this outcome and give your independent assessment. End your response with two lines exactly:\nPROBABILITY: <0-100>%\nLEAN: <BUY | HOLD | PASS>`;

  const round1 = await Promise.all(
    EXPERTS.map((e) => runExpert(client, e, round1Prompt, 1, emit))
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

      return runExpert(client, e, prompt, 2, emit);
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

  const synthPrompt = `The card under review:\n\n${brief}\n\nThe council's takes:\n\n${finalTakes}\n\nDeliver the final verdict in markdown with these sections:\n\n## Verdict\nOne punchy sentence.\n\n## Final probability\nA single number 0–100% that the card WINS, plus your confidence (Low / Medium / High).\n\n## Recommendation\nBUY, HOLD, or PASS — and at the current price, is it +EV? One short paragraph.\n\n## Key factors\n3–5 bullets driving the call.\n\n## Risks\n2–3 bullets on what would make this wrong.`;

  await streamBeta(
    client,
    {
      model: SYNTH_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: synthSystem,
      messages: [{ role: "user", content: synthPrompt }],
    },
    (text) => emit({ type: "verdict_delta", text })
  );

  emit({ type: "done" });
}
