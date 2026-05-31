import { NextRequest, NextResponse } from "next/server";
import { fetchEventCards, parseEventId, BunnyShieldError } from "@/lib/upshot";

export const runtime = "nodejs";

// GET /api/event?event=<id-or-url> — list every card (one per outcome) for an event.
export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get("event") ?? "";
  const eventId = parseEventId(input);
  if (!eventId) {
    return NextResponse.json(
      { error: "Enter an event ID or an upshot.cards/event/<id> URL." },
      { status: 400 }
    );
  }

  try {
    const { eventName, cards } = await fetchEventCards(eventId);
    if (!cards.length) {
      return NextResponse.json({ error: "No cards found for that event." }, { status: 404 });
    }
    return NextResponse.json({ eventId, eventName, count: cards.length, cards });
  } catch (err) {
    if (err instanceof BunnyShieldError) {
      return NextResponse.json({ error: "bunny_shield" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Failed to fetch event";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
