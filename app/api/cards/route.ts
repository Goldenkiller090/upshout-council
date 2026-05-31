import { NextRequest, NextResponse } from "next/server";
import {
  fetchOwnedCards,
  parseWallet,
  isPredictable,
  BunnyShieldError,
} from "@/lib/upshot";

export const runtime = "nodejs";

// GET /api/cards?wallet=<address-or-profile-url>&all=<0|1>
// Lists the cards a wallet owns. By default only returns cards still open to
// predict on (not resolved, not past their event date); pass all=1 for everything.
export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get("wallet") ?? "";
  const all = req.nextUrl.searchParams.get("all") === "1";
  const wallet = parseWallet(input);
  if (!wallet) {
    return NextResponse.json(
      { error: "Enter a wallet address (0x…) or an Upshot profile URL." },
      { status: 400 }
    );
  }

  try {
    let cards = await fetchOwnedCards(wallet);
    const total = cards.length;
    if (!all) cards = cards.filter(isPredictable);
    // Soonest deadline first; undated last.
    cards.sort(
      (a, b) =>
        (Date.parse(a.event?.eventDate ?? "") || Infinity) -
        (Date.parse(b.event?.eventDate ?? "") || Infinity)
    );
    return NextResponse.json({ wallet, total, shown: cards.length, cards });
  } catch (err) {
    if (err instanceof BunnyShieldError) {
      return NextResponse.json({ error: "bunny_shield" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Failed to fetch cards";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
