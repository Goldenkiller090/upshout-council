import { NextRequest } from "next/server";
import type { Card, CouncilEvent } from "@/lib/types";
import { runCouncil } from "@/lib/council";

export const runtime = "nodejs";
export const maxDuration = 300; // allow the full deliberation to run on Vercel

// POST /api/council  { card: Card }  → streams the deliberation as SSE.
export async function POST(req: NextRequest) {
  let card: Card;
  try {
    const body = await req.json();
    card = body.card as Card;
    if (!card?.id || !card?.name) throw new Error("missing card");
  } catch {
    return new Response("Invalid card payload", { status: 400 });
  }

  const encoder = new TextEncoder();
  // Abort the whole deliberation when the client disconnects / hits Stop, so we
  // stop spending the subscription the moment nobody is listening.
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (event: CouncilEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Echo the card so the UI can render its header immediately.
      emit({ type: "card", card });

      try {
        await runCouncil(card, emit, ac.signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Council failed";
        if (!ac.signal.aborted) emit({ type: "error", message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
