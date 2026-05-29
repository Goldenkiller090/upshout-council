import type { Card } from "./types";

const API_BASE =
  process.env.UPSHOT_API_BASE || "https://api-mainnet.upshotcards.net/api/v1";

/** Thrown when Bunny Shield returns its HTML challenge instead of JSON. */
export class BunnyShieldError extends Error {
  constructor() {
    super("Upshot API is behind Bunny Shield (got HTML challenge, not JSON).");
    this.name = "BunnyShieldError";
  }
}

/**
 * Extract a card ID from a raw ID or any upshot.cards URL.
 * Card IDs are ~25-char strings starting with "cm".
 */
export function parseCardId(input: string): string | null {
  const trimmed = input.trim();
  // Direct ID
  if (/^cm[a-z0-9]{15,}$/i.test(trimmed)) return trimmed;
  // Find a cm... token anywhere (e.g. inside a /card-detail/<id> URL)
  const match = trimmed.match(/cm[a-z0-9]{15,}/i);
  return match ? match[0] : null;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      // Look like a browser; doesn't defeat Bunny Shield but avoids naive UA blocks.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    throw new BunnyShieldError();
  }
  if (!res.ok) {
    throw new Error(`Upshot API ${res.status} for ${url}`);
  }
  return res.json();
}

/** Fetch and normalize a card by ID. Throws BunnyShieldError if blocked. */
export async function fetchCard(cardId: string): Promise<Card> {
  const detail = (await getJson(
    `${API_BASE}/cards/${cardId}?include=event,supply`
  )) as { data?: Record<string, unknown> };

  const data = detail.data;
  if (!data) throw new Error("Card not found");

  const card = normalizeCard(data);

  // Best-effort: enrich with a marketplace quote. Don't fail the whole request
  // if pricing is unavailable.
  try {
    const quote = (await getJson(
      `${API_BASE}/shopkeeper/${cardId}?quantity=1`
    )) as { data?: Record<string, unknown> };
    if (quote.data) {
      card.pricing = {
        currency: quote.data.currency as string | undefined,
        buyPrice: quote.data.buyPrice as string | undefined,
        sellPrice: quote.data.sellPrice as string | undefined,
        shopkeeperBalance: quote.data.shopkeeperBalance as string | undefined,
        isTradeable: quote.data.isTradeable as boolean | undefined,
      };
    }
  } catch {
    // ignore pricing failures
  }

  return card;
}

/** Normalize a raw card object (from API or pasted JSON) into our Card shape. */
export function normalizeCard(raw: Record<string, unknown>): Card {
  // Accept either a bare card object or a { data: {...} } envelope.
  const d = (raw.data as Record<string, unknown>) ?? raw;
  const event = (d.event as Record<string, unknown>) ?? undefined;
  return {
    id: String(d.id ?? ""),
    name: String(d.name ?? "Unknown card"),
    rarity: d.rarity as string | undefined,
    maxSupply: d.maxSupply as number | undefined,
    pointsValue: d.pointsValue as string | undefined,
    image: d.image as string | undefined,
    outcomeId: d.outcomeId as string | undefined,
    event: event
      ? {
          id: event.id as string | undefined,
          name: event.name as string | undefined,
          status: event.status as string | undefined,
          kind: event.kind as string | undefined,
          eventDate: event.eventDate as string | undefined,
          pricePerCard: event.pricePerCard as string | undefined,
          winningOutcomeId: (event.winningOutcomeId as string | null) ?? null,
          resolvedAt: (event.resolvedAt as string | null) ?? null,
        }
      : undefined,
  };
}

/** micro-units (6 decimals) → display number. 46620000 -> 46.62 */
export function fromMicro(value?: string | number): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return null;
  return n / 1_000_000;
}
