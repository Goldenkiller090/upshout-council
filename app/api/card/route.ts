import { NextRequest, NextResponse } from "next/server";
import { fetchCard, parseCardId, BunnyShieldError, normalizeCard } from "@/lib/upshot";

export const runtime = "nodejs";

// GET /api/card?input=<id-or-url>  → fetch and normalize a card server-side.
export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get("input") ?? "";
  const cardId = parseCardId(input);
  if (!cardId) {
    return NextResponse.json(
      { error: "Could not find a card ID in that input. Paste a card ID or upshot.cards URL." },
      { status: 400 }
    );
  }

  try {
    const card = await fetchCard(cardId);
    return NextResponse.json({ card });
  } catch (err) {
    if (err instanceof BunnyShieldError) {
      // Signal the client to fall back to manual paste.
      return NextResponse.json(
        { error: "bunny_shield", cardId },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to fetch card";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// POST /api/card  { json: <pasted card JSON object or string> } → normalize it.
// Used for the Bunny Shield paste fallback.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const raw = typeof body.json === "string" ? JSON.parse(body.json) : body.json;
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "Pasted value is not valid card JSON." }, { status: 400 });
    }
    const card = normalizeCard(raw as Record<string, unknown>);
    if (!card.id || !card.name) {
      return NextResponse.json(
        { error: "That JSON doesn't look like a card (missing id/name)." },
        { status: 400 }
      );
    }
    return NextResponse.json({ card });
  } catch {
    return NextResponse.json({ error: "Could not parse the pasted JSON." }, { status: 400 });
  }
}
