// Shared types for Upshout Council.

/** A prediction card, normalized from the Upshot API response. */
export interface Card {
  id: string;
  name: string;
  rarity?: string;
  maxSupply?: number;
  pointsValue?: string;
  /** Reward rail: CASH | POINTS | GOLD | SHOT. Determines which prize field is live. */
  prizeType?: string;
  /** Cash/prize amount in micro-units (only meaningful for non-points rails). */
  prizeAmount?: string;
  /** Current potential payout if this card wins, in micro-units. */
  potentialPrize?: string;
  /** Realized/locked payout, in micro-units (equals potential until resolution). */
  actualPrize?: string;
  /** How many of maxSupply have been minted — if minted >= maxSupply, the mint is sold out. */
  minted?: number;
  /** How many copies the queried wallet owns (set when listing a profile's cards). */
  owned?: number;
  image?: string;
  outcomeId?: string;
  /** The specific outcome this card represents (e.g. "≤ 20%", "Frampton"). */
  outcomeName?: string;
  event?: {
    id?: string;
    name?: string;
    status?: string; // ACTIVE | RESOLVED
    kind?: string; // SKILL | CASH | INSTANT
    eventDate?: string;
    pricePerCard?: string;
    /** Total event prize pool, in micro-units. */
    prizePool?: string;
    winningOutcomeId?: string | null;
    resolvedAt?: string | null;
  };
  /** Marketplace quote, if we could fetch it. */
  pricing?: {
    currency?: string;
    buyPrice?: string;
    sellPrice?: string;
    shopkeeperBalance?: string | number;
    isTradeable?: boolean;
  };
}

export interface Expert {
  id: string;
  name: string;
  /** Short tag shown in the UI. */
  bias: string;
  /** System prompt establishing the persona. */
  persona: string;
}

/** Server-Sent Event payloads streamed from /api/council. */
export type CouncilEvent =
  | { type: "status"; phase: string; message: string }
  | { type: "card"; card: Card }
  | { type: "expert_start"; expertId: string; name: string; bias: string; round: number }
  | { type: "delta"; expertId: string; round: number; text: string }
  | { type: "think"; expertId: string; round: number; text: string }
  | { type: "tool"; expertId: string; round: number; tool: string; detail: string }
  | { type: "expert_done"; expertId: string; round: number }
  | { type: "verdict_delta"; text: string }
  | {
      /** Cumulative token/cost spend for this card so far (updated per turn). */
      type: "cost";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      costUsd: number;
    }
  | {
      type: "reconcile";
      min: number;
      max: number;
      median: number;
      headline: number | null;
      divergent: boolean;
    }
  | { type: "done" }
  | { type: "error"; message: string };
