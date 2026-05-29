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

Experts run on **Claude Sonnet 4.6**; the synthesizer on **Claude Opus 4.8** (adaptive
thinking, `effort: high`), both with the `web_search_20260209` server tool.

## Setup

```bash
cp .env.example .env        # add your ANTHROPIC_API_KEY
npm install
npm run dev                 # http://localhost:3000
```

Required env: `ANTHROPIC_API_KEY`. Optional: `UPSHOT_API_BASE`.

## Deploy (Vercel)

Push to a repo, import in Vercel, set `ANTHROPIC_API_KEY`. The `/api/council` route sets
`maxDuration = 300` for the full deliberation.

> **Bunny Shield note:** the Upshot API flags IPs. If Vercel's IP is flagged, server-side
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
