# Upshout Council

An AI council that researches and predicts on [Upshot Cards](https://upshot.cards).
Paste a card ID or URL and five prediction-market "pilots" — each with a different
bias — research it with web search, debate each other, and a synthesizer delivers a
final probability + BUY/HOLD/PASS verdict. Styled as a Designers Republic × WipEout '95
HUD.

## How it works

1. **Resolve the card** — `GET /api/card?input=<id-or-url>` fetches it from the Upshot API
   server-side. If Bunny Shield blocks the request (HTML challenge), the UI falls back to
   pasting the card JSON (`POST /api/card`).
2. **Convene the council** — `POST /api/council` streams the deliberation over SSE:
   - **Round 1** — the five experts research independently (parallel, web search).
   - **Round 2** — each rebuts the others after seeing their takes.
   - **Synthesis** — Opus weighs the arguments into a final verdict.

### The five pilots (`lib/experts.ts`)

| Pilot          | Bias                  |
| -------------- | --------------------- |
| The Quant      | Base rates & priors   |
| The Insider    | Domain expertise      |
| The Contrarian | Fade the consensus    |
| The Sharp      | Market & odds reader  |
| The Newshound  | Breaking news/recency |

Experts run on **Sonnet**; the synthesizer on **Opus** — both via the **Claude Agent SDK**,
which uses your local Claude Code login (your subscription), with the `WebSearch` tool.
No API key required.

## Setup

This runs **locally** on your Claude subscription (no API key, no per-call billing):

```bash
claude            # log in once via /login  (or: claude setup-token)
npm install
npm run dev       # http://localhost:3000
```

Make sure `ANTHROPIC_API_KEY` is **not** set in your environment — if it is, the Agent SDK
will bill the API instead of using your subscription. Optional: `UPSHOT_API_BASE`.

> Each query spawns the local `claude` CLI under the hood, so the `claude` binary must be on
> your PATH (it is, if you use Claude Code). Web search runs headless (permissions bypassed
> for this trusted local app).

> **Bunny Shield note:** the Upshot API flags IPs. If your IP is flagged, server-side
> card fetches return the HTML challenge — the UI then prompts you to paste the card JSON
> from your authenticated browser. See `upshot-api/BUNNY_SHIELD.md`.

## Layout

```
app/
  page.tsx              # the HUD dashboard (client)
  layout.tsx            # fonts + shell
  globals.css           # the whole aesthetic
  api/card/route.ts     # fetch / paste-fallback
  api/council/route.ts  # SSE deliberation stream
lib/
  council.ts            # orchestration (rounds + synthesis)
  experts.ts            # the five personas
  upshot.ts             # Upshot client + Bunny Shield detection
  types.ts
upshot-api/             # cloned API docs (reference)
```

Not financial advice. It's just numbers.
