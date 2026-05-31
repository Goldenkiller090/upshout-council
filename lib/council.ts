import type { Card, CouncilEvent, Expert } from "./types";
import { EXPERTS } from "./experts";
import { fromMicro } from "./upshot";
import { runAgent, providerLabel } from "./llm";
import { extractCall } from "./parse";

/** One-line, token-cheap digest of a round-1 take for feeding to others/the synth. */
function digest(expert: Expert, text: string): string {
  const { prob, lean } = extractCall(text);
  const body = text.replace(/PROBABILITY:[\s\S]*$/i, "").trim();
  const thesis = body.replace(/\s+/g, " ").slice(0, 280);
  return `### ${expert.name} (${expert.bias}) — ${prob ?? "?"}% · ${lean ?? "?"}\n${thesis}${
    body.length > 280 ? "…" : ""
  }`;
}

type Emit = (event: CouncilEvent) => void;

/** Format micro-units as a USD amount, e.g. 732920721 -> "$732.92". */
function usd(value?: string | number): string | null {
  const n = fromMicro(value);
  return n == null ? null : `$${n.toFixed(2)}`;
}

// Upshot has no SHOT/USD rate endpoint (even its own UI shows raw SHOT), so the
// dollar value of a SHOT price can only be known if the operator supplies a rate.
// Set UPSHOT_SHOT_USD (dollars per 1 SHOT) to let the council compute USD EV
// directly; otherwise it computes the break-even SHOT price instead of guessing.
const SHOT_USD = process.env.UPSHOT_SHOT_USD
  ? Number(process.env.UPSHOT_SHOT_USD)
  : null;

/** Convert a display amount in a given currency to USD when we can. */
function toUsd(amount: number, currency?: string): number | null {
  const c = (currency ?? "").toUpperCase();
  if (c === "CASH") return amount; // CASH is USD-pegged
  if (c === "SHOT" && SHOT_USD != null && !Number.isNaN(SHOT_USD)) return amount * SHOT_USD;
  return null;
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
    const pool = isCash ? usd(e.prizePool) : fromMicro(e.prizePool);
    if (pool != null) lines.push(`Event prize pool: ${isCash ? pool : `${pool} GOLD`}`);
    if (e.status === "RESOLVED") {
      lines.push(
        `ALREADY RESOLVED — winning outcome: ${e.winningOutcomeId ?? "n/a"}, this card's outcome: ${card.outcomeId ?? "n/a"}`
      );
    }
  }

  // ---- Cost to acquire: anchor on the REAL price, not the (often sold-out) mint ----
  const soldOut =
    card.maxSupply != null && card.minted != null && card.minted >= card.maxSupply;
  const mintNum = fromMicro(card.event?.pricePerCard);
  const buy = fromMicro(card.pricing?.buyPrice);
  const cur = card.pricing?.currency ?? "GOLD";
  if (buy != null) {
    const buyUsd = toUsd(buy, cur);
    lines.push(
      `Cost to BUY now (live secondary-market ask): ${buy} ${cur}${buyUsd != null ? ` (≈ $${buyUsd.toFixed(2)})` : ""}`
    );
    const sell = fromMicro(card.pricing?.sellPrice);
    if (sell != null) lines.push(`Sell-back (bid): ${sell} ${cur}`);

    // Deterministic break-even (computed in code, not left to the model).
    const isCashPrize = (card.prizeType ?? card.event?.kind ?? "").toUpperCase() === "CASH";
    const prizeUsd = isCashPrize ? fromMicro(card.potentialPrize ?? card.prizeAmount) : null;
    if (prizeUsd && prizeUsd > 0) {
      if (buyUsd != null) {
        const be = (buyUsd / prizeUsd) * 100;
        lines.push(
          `Break-even win probability at this price: ${be.toFixed(be < 1 ? 2 : 1)}% — BUY only if you believe the outcome is MORE likely than this; PASS if less.`
        );
      } else {
        lines.push(
          `Break-even in USD needs a ${cur}/USD rate (none set) — solve for the break-even ${cur} value instead: it's +EV iff win_prob × $${prizeUsd.toFixed(2)} > ${buy} ${cur}.`
        );
      }
    }
  }
  if (mintNum != null) {
    const mintLabel = (card.prizeType ?? card.event?.kind ?? "").toUpperCase() === "CASH"
      ? `$${mintNum.toFixed(2)}`
      : `${mintNum} GOLD`;
    lines.push(
      soldOut
        ? `Mint price was ${mintLabel}, but max supply (${card.maxSupply}) is fully minted — you CANNOT buy at mint. Judge value against the BUY price above, not the mint price.`
        : `Mint price per card: ${mintLabel}`
    );
  }
  if (card.pricing?.isTradeable != null) lines.push(`Tradeable: ${card.pricing.isTradeable}`);

  // ---- Guard: don't "forecast" a settled or past-deadline event from priors ----
  const eventMs = card.event?.eventDate ? Date.parse(card.event.eventDate) : NaN;
  const pastDeadline = !Number.isNaN(eventMs) && eventMs < Date.now();
  const resolved = card.event?.status === "RESOLVED" || !!card.event?.winningOutcomeId;
  if (resolved || pastDeadline) {
    lines.unshift(
      `⚠️ RESOLUTION ALERT: this event is ${
        resolved ? "marked RESOLVED" : "past its event date"
      } (${card.event?.eventDate ?? "date unknown"}). Your FIRST task is to WEB-SEARCH the ACTUAL outcome and state plainly whether this card WON or LOST. Do NOT forecast a settled event from priors — find the real result. If you cannot confirm it, say so explicitly and do not invent a probability.`
    );
  }
  return lines.join("\n");
}

const SHARED_CONTEXT = `Upshot Cards is a prediction-market platform: a "card" represents a specific
outcome (e.g. "ETH closes above $4000"). If the predicted outcome happens, the card "wins" and pays out a
reward. Rewards come on different rails depending on the card: CASH (real money), POINTS/GOLD (in-app points),
or a SHOT (a raffle/prize entry) — the brief states which rail and amount apply to this card.
You are evaluating whether this card's predicted outcome will occur — i.e. the probability it WINS — and
whether buying it is a good bet given that reward.

Judging value (BUY / HOLD / PASS):
- Base your call on the ACTUAL price to acquire the card right now — the "Cost to BUY now" line — NOT the
  mint price, which is frequently sold out and unobtainable.
- The reward and the buy price are often in DIFFERENT currencies (e.g. reward in CASH/USD, price in SHOT).
  A bet is +EV when  win_probability × reward  >  buy_price.  Convert to a common currency before comparing.
- If the brief already shows the buy price converted to USD (≈ $X), compare directly against the USD reward.
- If you are NOT given a USD value for the buy currency, DO NOT invent an exchange rate. Instead solve for the
  break-even rate: the maximum the buy currency can be worth for the bet to stay +EV
  (break_even_price_per_unit = win_probability × reward_usd ÷ buy_price_in_units), and frame your lean around it
  — e.g. "BUY only if 1 SHOT is worth less than $0.0020; PASS if you value SHOT above that." State the assumption.`;

const today = () => new Date().toISOString().slice(0, 10);

/** Run one expert turn with web search; forwards deltas and returns full text. */
async function runExpert(
  expert: Expert,
  userPrompt: string,
  round: number,
  emit: Emit
): Promise<string> {
  emit({ type: "expert_start", expertId: expert.id, name: expert.name, bias: expert.bias, round });

  const system = `${expert.persona}\n\n${SHARED_CONTEXT}\n\nToday's date is ${today()}. Use web search to research current facts BEFORE you commit to a number — weight the most recent information heavily and stamp the date of time-sensitive facts (a settled or stale fact must not be treated as a live forecast). Cite what you find. Keep your written analysis tight — a few short paragraphs.`;

  const full = await runAgent(
    { role: "expert", system, prompt: userPrompt, webSearch: true, maxTurns: 16 },
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
  emit({
    type: "status",
    phase: "research",
    message: `Council researching independently (via ${providerLabel()})…`,
  });

  const round1Prompt = `Here is the card under review:\n\n${brief}\n\nResearch this outcome and give your independent assessment. End your response with two lines exactly:\nPROBABILITY: <0-100>%\nLEAN: <BUY | HOLD | PASS>`;

  const round1 = await Promise.all(
    EXPERTS.map((e) => runExpert(e, round1Prompt, 1, emit))
  );

  // ---- Round 2: rebuttal / deliberation ----
  emit({ type: "status", phase: "debate", message: "Council debating each other's takes…" });

  const round2 = await Promise.all(
    EXPERTS.map((e, selfIdx) => {
      // Feed digests, not full transcripts — same signal, a fraction of the tokens.
      const others = EXPERTS.map((x, i) => (i === selfIdx ? null : digest(x, round1[i])))
        .filter(Boolean)
        .join("\n\n");

      const prompt = `The card under review:\n\n${brief}\n\nHere are the other council members' first-round takes (digested):\n\n${others}\n\nWhere do you disagree with them, and why? Do any of their points change your view? Research further if needed. Then give your UPDATED assessment, ending with two lines exactly:\nPROBABILITY: <0-100>%\nLEAN: <BUY | HOLD | PASS>`;

      return runExpert(e, prompt, 2, emit);
    })
  );

  // Synth gets each pilot's FINAL (round-2) take in full, plus a one-line digest of
  // where they started — enough to see movement without re-sending both rounds whole.
  const finalTakes = EXPERTS.map(
    (e, i) =>
      `${digest(e, round1[i])}\n\n### ${e.name} (${e.bias}) — FINAL take (after debate):\n${round2[i].trim()}`
  ).join("\n\n");

  // ---- Synthesis: final verdict ----
  emit({ type: "status", phase: "verdict", message: "Synthesizing the final verdict…" });

  const synthSystem = `You are the chair of a prediction-market council. Four expert analysts with different
biases (a quant on base rates, a domain insider on resolution mechanics, a contrarian, and a market/odds reader)
have each researched and debated a card. Weigh their arguments — don't just average them. Note where they agree
and where the disagreement is most informative. Be decisive but honest about uncertainty.\n\n${SHARED_CONTEXT}\n\nToday's date is ${today()}.`;

  const synthPrompt = `The card under review:\n\n${brief}\n\nThe council's takes:\n\n${finalTakes}\n\nDeliver the final verdict in markdown with these sections:\n\n## Verdict\nOne punchy sentence.\n\n## Final probability\nA single number 0–100% that the card WINS, plus your confidence (Low / Medium / High).\n\n## The split\nState the range of the four pilots' probabilities (lowest–highest, naming who anchored each end), then call out the SINGLE most informative disagreement — the one clash that actually matters for the decision — and say which side you sided with and why. Don't just note they agreed; surface where the tension was.\n\n## Recommendation\nBUY, HOLD, or PASS — and at the current price, is it +EV? One short paragraph.\n\n## Key factors\n3–5 bullets driving the call.\n\n## Risks\n2–3 bullets on what would make this wrong.`;

  await runAgent(
    { role: "synth", system: synthSystem, prompt: synthPrompt, webSearch: false, maxTurns: 2 },
    { onText: (text) => emit({ type: "verdict_delta", text }) }
  );

  emit({ type: "done" });
}
