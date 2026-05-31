# Upshout Council

An AI council that researches and predicts on [Upshot Cards](https://upshot.cards).
Paste a card ID or URL and five prediction-market **pilots** — each with a different
bias — research it with web search, debate each other, and a synthesizer delivers a
final probability + **BUY / HOLD / PASS** verdict. Styled as a Designers Republic ×
WipEout '95 HUD.

> **It runs on a subscription you already pay for — not an API key.** Point it at your
> **Claude** plan *or* your **ChatGPT (Codex)** plan and it drives that CLI locally. No
> per-call billing.

---

## Pick cards two ways

- **Paste links** — one or many card IDs / `upshot.cards` URLs (one per line). Each becomes
  its own council run.
- **From wallet** — enter a wallet address or `upshot.cards/profile/0x…` URL to load every
  card that profile owns, then **search and filter** (by prize currency you can win —
  CASH / GOLD / SHOT — and by rarity) and multi-select which to predict. Only cards still
  **open to predict** (not resolved, not past their event date) are shown.
- **Event** — paste an `upshot.cards/event/<id>` URL to fetch every outcome card in that
  event and auto-run them. Shown as a **compact verdict list** (no per-card debate UI,
  since events can have many cards): each row has a live status dot, and on finish the win
  probability, a BUY/HOLD/PASS call, and a **BUY ↗** link straight to the card.

Selected cards run as **parallel councils** — up to **3 at once** (they share your single
subscription), the rest queue automatically. Each card gets its own independent panel with
its own **Stop** button, so runs never interrupt or bleed into each other. Stop aborts the
stream end-to-end (client → server → every agent), so it actually stops spending your plan.

After the verdict, a **reconciliation** note flags when the synthesizer's headline
probability lands outside where the four pilots actually landed — a cue to read *The split*
before trusting the number.

## How it works

1. **Resolve the card** — `GET /api/card?input=<id-or-url>` fetches it from the Upshot API
   server-side (or `GET /api/cards?wallet=<addr>` for a whole profile). If Bunny Shield
   blocks the request (HTML challenge), the UI falls back to pasting the card JSON
   (`POST /api/card`).
2. **Convene the council** — `POST /api/council` streams the deliberation over SSE:
   - **Round 1** — the four experts research independently (parallel, web search).
   - **Round 2** — each rebuts the others after seeing their takes.
   - **Synthesis** — a final verdict weighs the arguments into one probability + call.

The orchestration (`lib/council.ts`) is provider-agnostic: it asks `lib/llm` to run each
turn, and `lib/llm` dispatches to whichever backend you selected.

### The four pilots (`lib/experts.ts`)

| Pilot          | Bias                  |
| -------------- | --------------------- |
| The Quant      | Base rates & priors   |
| The Insider    | Domain expertise      |
| The Contrarian | Fade the consensus    |
| The Sharp      | Market & odds reader  |

(Recency is a cross-cutting instruction every pilot follows, rather than a dedicated seat.)

Experts run on the faster model (Sonnet / `gpt-5-codex`); the synthesizer on the strongest
(Opus / `gpt-5-codex`). Both via your subscription — see below.

---

## Setup

### 0. Prerequisites

- **Node.js 18+**
- A working login for **one** of the two providers (next step).

```bash
git clone https://github.com/hazy2go/upshout-council.git
cd upshout-council
npm install
cp .env.example .env.local
```

### 1. Pick your provider

Edit `.env.local` and set `LLM_PROVIDER` to `claude` or `codex`.

<details open>
<summary><b>Option A — Claude (Claude Code subscription)</b></summary>

Uses the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
which drives your local `claude` CLI login.

```bash
# 1. Install Claude Code if you don't have it, then log in once:
claude            # then run /login   (or: claude setup-token)

# 2. In .env.local:
LLM_PROVIDER=claude
```

> ⚠️ Make sure **`ANTHROPIC_API_KEY` is NOT set** in your environment. If it is, the SDK
> bills the API instead of using your subscription.

The `claude` binary must be on your `PATH` (it is, if you use Claude Code). Optional model
overrides: `CLAUDE_EXPERT_MODEL` (default `sonnet`), `CLAUDE_SYNTH_MODEL` (default `opus`).
</details>

<details>
<summary><b>Option B — Codex (ChatGPT subscription)</b></summary>

Uses the [Codex SDK](https://www.npmjs.com/package/@openai/codex-sdk), which drives your
local `codex` CLI login. Web search runs through Codex's built-in search tool.

```bash
# 1. Install Codex if you don't have it:
npm install -g @openai/codex          # or: brew install codex

# 2. Log in with your ChatGPT plan (opens a browser):
codex             # choose "Sign in with ChatGPT"   (or: codex login)

# 3. In .env.local:
LLM_PROVIDER=codex
```

> ⚠️ Make sure **`OPENAI_API_KEY` / `CODEX_API_KEY` are NOT set**. If they are, Codex bills
> the API instead of using your ChatGPT subscription.

Optional overrides: `CODEX_EXPERT_MODEL` / `CODEX_SYNTH_MODEL` (default `gpt-5-codex`),
`CODEX_REASONING_EFFORT` (`minimal`|`low`|`medium`|`high`|`xhigh`).

> Web search availability depends on your ChatGPT plan. If a run can't search, the council
> still reasons but won't cite fresh facts.
</details>

### 2. Run it

```bash
npm run dev       # http://localhost:3000
```

Paste an Upshot card ID or URL and watch the council deliberate. The header shows which
provider is active (`…via Claude` / `…via Codex (ChatGPT)`).

Quick CLI smoke test without the UI:

```bash
npm run council:demo
```

---

## Switching providers

It's just one env var — no code change:

```bash
LLM_PROVIDER=claude   # Claude plan
LLM_PROVIDER=codex    # ChatGPT plan
```

Restart `npm run dev` after changing `.env.local`.

---

## Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | `claude` | `claude` or `codex` |
| `CLAUDE_EXPERT_MODEL` | `sonnet` | expert model (Claude) |
| `CLAUDE_SYNTH_MODEL` | `opus` | synthesizer model (Claude) |
| `CODEX_EXPERT_MODEL` | `gpt-5-codex` | expert model (Codex) |
| `CODEX_SYNTH_MODEL` | `gpt-5-codex` | synthesizer model (Codex) |
| `CODEX_REASONING_EFFORT` | — | Codex reasoning effort |
| `UPSHOT_API_BASE` | mainnet | override the Upshot API URL |
| `UPSHOT_SHOT_USD` | — | dollars per 1 SHOT (for USD EV; see below) |
| `UPSHOT_BEARER` | — | replay browser auth for server-side card fetch |
| `UPSHOT_COOKIE` | — | Bunny Shield cookies (the part that clears the shield) |
| `COUNCIL_EXPERT_TIMEOUT_MS` | `210000` | abort a hung expert turn (keeps partial output) |
| `COUNCIL_SYNTH_TIMEOUT_MS` | `180000` | abort a hung synthesis turn |

### Pricing & expected value

Upshot cards pay on different rails — **CASH** (USD-pegged), **POINTS/GOLD**, or **SHOT** —
and trade on a secondary market that's often in a *different* currency than the prize. The
council:

- judges value against the **live secondary-market buy price**, not the mint price (mints
  are frequently sold out and unobtainable), and
- converts the buy price to USD when possible. Upshot exposes **no SHOT/USD rate**, so set
  `UPSHOT_SHOT_USD` to get dollar EV directly; otherwise the council reports the
  **break-even** rate ("BUY only if 1 SHOT < $X") instead of guessing.

### Bunny Shield note

The Upshot API sits behind Bunny Shield, which flags IPs. If your IP is flagged, server-side
card fetches return the HTML challenge — the UI then prompts you to paste the card JSON from
your authenticated browser. To fetch server-side, replay your browser session via
`UPSHOT_BEARER` + `UPSHOT_COOKIE`. See `upshot-api/BUNNY_SHIELD.md`.

---

## Layout

```
app/
  page.tsx              # the HUD dashboard (client)
  layout.tsx            # fonts + shell
  globals.css           # the whole aesthetic
  api/card/route.ts     # fetch / paste-fallback
  api/council/route.ts  # SSE deliberation stream
lib/
  council.ts            # orchestration (rounds + synthesis), provider-agnostic
  llm/
    index.ts            # provider dispatch (LLM_PROVIDER) + runAgent()
    claude.ts           # Claude Agent SDK runner (Claude sub)
    codex.ts            # Codex SDK runner (ChatGPT sub)
    types.ts            # shared RunRequest / callbacks contract
  experts.ts            # the four personas
  upshot.ts             # Upshot client + Bunny Shield detection
  types.ts
upshot-api/             # cloned API docs (reference)
```

Adding a third provider is just another file in `lib/llm/` implementing `LlmRunner` and a
branch in `lib/llm/index.ts`.

---

Not financial advice. It's just numbers.
