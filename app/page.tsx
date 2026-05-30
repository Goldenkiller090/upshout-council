"use client";

import { useRef, useState } from "react";
import type { Card, CouncilEvent } from "@/lib/types";
import { EXPERTS } from "@/lib/experts";
import { fromMicro } from "@/lib/upshot";

type RoundData = { text: string; think: string; tools: { tool: string; detail: string }[] };
type ExpertState = { r1: RoundData; r2: RoundData; active: boolean };

const emptyRound = (): RoundData => ({ text: "", think: "", tools: [] });
const emptyExpert = (): ExpertState => ({ r1: emptyRound(), r2: emptyRound(), active: false });

// Pull the latest probability + lean an expert committed to (round 2 wins over round 1).
function readout(st?: ExpertState): { prob: number | null; lean: string | null } {
  const text = `${st?.r1.text ?? ""}\n${st?.r2.text ?? ""}`;
  const probs = [...text.matchAll(/PROBABILITY:\s*(\d{1,3})/gi)];
  const leans = [...text.matchAll(/LEAN:\s*(BUY|HOLD|PASS)/gi)];
  const prob = probs.length ? Math.min(100, parseInt(probs[probs.length - 1][1], 10)) : null;
  const lean = leans.length ? leans[leans.length - 1][1].toUpperCase() : null;
  return { prob, lean };
}

type Phase = "idle" | "research" | "debate" | "verdict" | "done";

export default function Home() {
  const [input, setInput] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [experts, setExperts] = useState<Record<string, ExpertState>>({});
  const [verdict, setVerdict] = useState("");
  const fetching = useRef(false);

  function resetRun() {
    setExperts(Object.fromEntries(EXPERTS.map((e) => [e.id, emptyExpert()])));
    setVerdict("");
    setError("");
    setStatus("");
    setPhase("research");
  }

  async function handleResolve() {
    if (!input.trim() || fetching.current) return;
    fetching.current = true;
    setError("");
    setPasteMode(false);
    setCard(null);
    try {
      const res = await fetch(`/api/card?input=${encodeURIComponent(input)}`);
      const data = await res.json();
      if (res.status === 409 && data.error === "bunny_shield") {
        setPasteMode(true);
      } else if (!res.ok) {
        setError(data.error || "Failed to fetch card.");
      } else {
        setCard(data.card);
        startCouncil(data.card);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      fetching.current = false;
    }
  }

  async function handlePaste() {
    setError("");
    try {
      const res = await fetch("/api/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: pasteValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not parse pasted card.");
        return;
      }
      setPasteMode(false);
      setCard(data.card);
      startCouncil(data.card);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse pasted card.");
    }
  }

  async function startCouncil(c: Card) {
    resetRun();
    setRunning(true);
    setStatus("Convening the council…");
    try {
      const res = await fetch("/api/council", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card: c }),
      });
      if (!res.ok || !res.body) {
        setError("Failed to start the council.");
        setRunning(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          handleEvent(JSON.parse(json) as CouncilEvent);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stream error.");
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(ev: CouncilEvent) {
    switch (ev.type) {
      case "card":
        setCard(ev.card);
        break;
      case "status":
        setStatus(ev.message);
        if (ev.phase === "research" || ev.phase === "debate" || ev.phase === "verdict") {
          setPhase(ev.phase);
        }
        break;
      case "expert_start":
        setExperts((prev) => ({
          ...prev,
          [ev.expertId]: { ...(prev[ev.expertId] ?? emptyExpert()), active: true },
        }));
        break;
      case "delta":
        setExperts((prev) => {
          const cur = prev[ev.expertId] ?? emptyExpert();
          const rk = ev.round === 1 ? "r1" : "r2";
          return { ...prev, [ev.expertId]: { ...cur, [rk]: { ...cur[rk], text: cur[rk].text + ev.text } } };
        });
        break;
      case "think":
        setExperts((prev) => {
          const cur = prev[ev.expertId] ?? emptyExpert();
          const rk = ev.round === 1 ? "r1" : "r2";
          return { ...prev, [ev.expertId]: { ...cur, [rk]: { ...cur[rk], think: cur[rk].think + ev.text } } };
        });
        break;
      case "tool":
        setExperts((prev) => {
          const cur = prev[ev.expertId] ?? emptyExpert();
          const rk = ev.round === 1 ? "r1" : "r2";
          return {
            ...prev,
            [ev.expertId]: { ...cur, [rk]: { ...cur[rk], tools: [...cur[rk].tools, { tool: ev.tool, detail: ev.detail }] } },
          };
        });
        break;
      case "expert_done":
        setExperts((prev) => ({
          ...prev,
          [ev.expertId]: { ...(prev[ev.expertId] ?? emptyExpert()), active: false },
        }));
        break;
      case "verdict_delta":
        setVerdict((v) => v + ev.text);
        break;
      case "error":
        setError(ev.message);
        break;
      case "done":
        setStatus("Verdict delivered.");
        setPhase("done");
        break;
    }
  }

  return (
    <div className="wrap">
      <div className="frame">
        <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
      </div>
      <div className="gridfloor" />

      <header className="masthead">
        <div>
          <div className="brandtag">
            AG-SYS <b>//</b> PREDICTION RACING LEAGUE <b>//</b> EST.2099
          </div>
          <h1 className="title">
            UPSHOUT<span className="slash"> / </span>COUNCIL
          </h1>
          <div className="kata">アップショウト・カウンシル — 予測評議会</div>
        </div>
        <div className="regblock">
          <div className="barcode" />
          <small>UNIT 05 · ONLINE</small>
        </div>
      </header>

      <p className="subtitle">
        Five AI prediction-market pilots research, debate, and call your Upshot card.
      </p>

      <div className="searchbar">
        <span className="lead">CARD ID ▸</span>
        <input
          type="text"
          placeholder="paste a card ID or upshot.cards URL…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleResolve()}
          disabled={running}
        />
        <button onClick={handleResolve} disabled={running || !input.trim()}>
          {running ? "DELIBERATING" : "CONVENE"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {pasteMode && (
        <div className="paste-box">
          <h3>BUNNY SHIELD BLOCKED THE SERVER FETCH</h3>
          <p>
            Open the card in your browser, hit{" "}
            <code>{`/api/v1/cards/<id>?include=event,supply`}</code>, and paste the
            JSON here.
          </p>
          <textarea
            placeholder='{ "data": { "id": "cm…", "name": "…", "event": { … } } }'
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
          />
          <button className="solid" onClick={handlePaste} disabled={!pasteValue.trim()}>
            USE THIS CARD
          </button>
        </div>
      )}

      {card && <CardHeader card={card} />}

      {status && (
        <div className="status">
          {running && <span className="spinner" />}
          {status}
        </div>
      )}

      {verdict && <Verdict text={verdict} />}

      {card && phase !== "debate" && (
        <>
          <div className="section-label">
            PILOT GRID · 05{phase === "research" && " · RESEARCHING"}
          </div>
          <div className="grid">
            {EXPERTS.map((e, i) => {
              const st = experts[e.id];
              const { prob, lean } = readout(st);
              return (
                <div
                  key={e.id}
                  className="expert"
                  style={{
                    ["--xc" as string]: `var(--${e.id})`,
                    animationDelay: `${i * 70}ms`,
                  }}
                >
                  <div className="ehead">
                    <div>
                      <div className="pno">PILOT {String(i + 1).padStart(2, "0")}</div>
                      <div className="ename">{e.name}</div>
                    </div>
                    {st?.active && <span className="spinner" />}
                  </div>
                  <div className="ebias">{e.bias}</div>

                  <div className="readout">
                    <div className="bigp">
                      {prob != null ? prob : "––"}
                      <small>%</small>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${prob ?? 0}%` }} />
                    </div>
                    {lean && <span className={`lean ${lean}`}>{lean}</span>}
                  </div>

                  {st && hasRound(st.r1) && (
                    <Round label="ROUND 1 · RESEARCH" data={st.r1} mentions={false} />
                  )}
                  {st && hasRound(st.r2) && (
                    <Round label="ROUND 2 · DEBATE" data={st.r2} mentions />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {card && (phase === "debate" || phase === "verdict" || phase === "done") && (
        <>
          <div className="section-label">
            THE DEBATE FLOOR · WHO CHALLENGED WHOM
            {phase === "debate" && <span className="live">● LIVE</span>}
          </div>
          <DebateArena experts={experts} live={phase === "debate"} />
        </>
      )}

      {card && (
        <div className="foot">
          UPSHOUT COUNCIL <b>//</b> NOT FINANCIAL ADVICE <b>//</b> IT&apos;S JUST NUMBERS
        </div>
      )}
    </div>
  );
}

const hasRound = (r: RoundData) => !!(r.text || r.think || r.tools.length);

const toolIcon = (t: string) => (t === "WebSearch" ? "🔍" : t === "WebFetch" ? "🌐" : "⚙");

// One round of an expert's work: live search/fetch activity, thinking, then analysis.
function Round({ label, data, mentions }: { label: string; data: RoundData; mentions: boolean }) {
  const [a, b] = label.split("·");
  return (
    <>
      <div className="round-tag">
        {a}·<b>{b}</b>
      </div>
      {data.tools.length > 0 && (
        <div className="activity">
          {data.tools.map((t, i) => (
            <div className="act" key={i}>
              <span className="actk">{toolIcon(t.tool)}</span>
              <span className="actd">{t.detail || t.tool}</span>
            </div>
          ))}
        </div>
      )}
      {data.think.trim() && (
        <details className="think">
          <summary>internal reasoning</summary>
          <div className="think-body">{data.think}</div>
        </details>
      )}
      {data.text && (
        <div className="body md-sm">
          <Markdown source={data.text} mentions={mentions} />
        </div>
      )}
    </>
  );
}

type Exchange = { from: string; to: string; text: string };

function cleanSnippet(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Derive directed challenges from round-2 text: a sentence in pilot A's round-2
// take that names pilot B is an A→B exchange.
function debateExchanges(experts: Record<string, ExpertState>): Exchange[] {
  const res: Exchange[] = [];
  for (const e of EXPERTS) {
    const txt = experts[e.id]?.r2.text;
    if (!txt) continue;
    const sentences = txt.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/);
    const seen = new Set<string>();
    for (const s of sentences) {
      MENTION_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = MENTION_RE.exec(s))) {
        const to = MENTIONS[m[1]];
        if (!to || to === e.id) continue;
        const key = `${e.id}->${to}`;
        if (seen.has(key)) continue; // one exchange per directed pair per speaker
        seen.add(key);
        const snip = cleanSnippet(s);
        if (snip.length > 12) res.push({ from: e.id, to, text: snip.slice(0, 220) });
      }
    }
  }
  return res;
}

const shortName = (id: string) => (EXPERTS.find((e) => e.id === id)?.name ?? id).replace("The ", "");

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

function DebateArena({ experts, live }: { experts: Record<string, ExpertState>; live: boolean }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const exchanges = debateExchanges(experts);
  const edges = Array.from(new Set(exchanges.map((x) => `${x.from}->${x.to}`))).map((k) => {
    const [from, to] = k.split("->");
    return { from, to };
  });

  // A pair is a rebuttal when both directions exist (A challenged B and B challenged A).
  const dirs = new Set(exchanges.map((x) => `${x.from}->${x.to}`));
  const mutual = new Set<string>();
  for (const x of exchanges) if (dirs.has(`${x.to}->${x.from}`)) mutual.add(pairKey(x.from, x.to));

  // Group the feed by unordered pair so rebuttals render together.
  const groups: { key: string; items: Exchange[] }[] = [];
  const gIdx = new Map<string, number>();
  for (const x of exchanges) {
    const k = pairKey(x.from, x.to);
    if (!gIdx.has(k)) {
      gIdx.set(k, groups.length);
      groups.push({ key: k, items: [] });
    }
    groups[gIdx.get(k)!].items.push(x);
  }

  const W = 760, H = 420, cx = W / 2, cy = 196, R = 150, nodeR = 30;
  const N = EXPERTS.length;
  const pos = Object.fromEntries(
    EXPERTS.map((e, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
      return [e.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }];
    })
  ) as Record<string, { x: number; y: number }>;

  const pull = (p: { x: number; y: number }, t: { x: number; y: number }, d: number) => {
    const dx = t.x - p.x, dy = t.y - p.y, l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / l) * d, y: p.y + (dy / l) * d };
  };

  return (
    <div className="debate">
      <svg viewBox={`0 0 ${W} ${H}`} className="arena" role="img" aria-label="Debate graph">
        <defs>
          {EXPERTS.map((e) => (
            <marker key={e.id} id={`arw-${e.id}`} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
              <path d="M0,0 L9,4.5 L0,9 Z" fill={`var(--${e.id})`} />
            </marker>
          ))}
        </defs>

        {edges.map(({ from, to }, i) => {
          const a = pos[from], b = pos[to];
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const off = 30;
          const ctrl = { x: mx - (dy / len) * off, y: my + (dx / len) * off };
          const sa = pull(a, ctrl, nodeR + 2);
          const eb = pull(b, ctrl, nodeR + 8);
          const active = !hovered || hovered === from || hovered === to;
          const isMutual = mutual.has(pairKey(from, to));
          return (
            <path
              key={i}
              d={`M ${sa.x} ${sa.y} Q ${ctrl.x} ${ctrl.y} ${eb.x} ${eb.y}`}
              fill="none"
              stroke={`var(--${from})`}
              strokeWidth={hovered === from ? 2.8 : isMutual ? 2.2 : 1.5}
              strokeDasharray={isMutual ? undefined : "5 4"}
              markerEnd={`url(#arw-${from})`}
              opacity={active ? (isMutual ? 0.95 : 0.7) : 0.1}
            />
          );
        })}

        {EXPERTS.map((e, i) => {
          const p = pos[e.id];
          const { prob } = readout(experts[e.id]);
          const speaking = live && experts[e.id]?.active;
          const dim = hovered && hovered !== e.id && !edges.some((g) => (g.from === hovered && g.to === e.id) || (g.to === hovered && g.from === e.id));
          return (
            <g
              key={e.id}
              transform={`translate(${p.x},${p.y})`}
              onMouseEnter={() => setHovered(e.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer", opacity: dim ? 0.3 : 1 }}
            >
              {speaking && <circle className="speaking" r={nodeR + 6} fill="none" stroke={`var(--${e.id})`} strokeWidth={1.5} />}
              <circle r={nodeR} fill="#080a18" stroke={`var(--${e.id})`} strokeWidth={speaking ? 3 : 2} />
              <text textAnchor="middle" y={-2} className="node-name" fill={`var(--${e.id})`}>
                {shortName(e.id).toUpperCase()}
              </text>
              <text textAnchor="middle" y={13} className="node-prob" fill="#cdd6ea">
                {prob != null ? `${prob}%` : "··"}
              </text>
              <text textAnchor="middle" y={nodeR + 16} className="node-tag" fill="var(--dim)">
                P{String(i + 1).padStart(2, "0")}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="exchanges">
        {groups.length === 0 ? (
          <div className="exch-empty">
            {live ? "Pilots are taking the floor…" : "No direct challenges surfaced."}
          </div>
        ) : (
          groups.map((g, gi) => {
            const isRebuttal = g.items.length > 1;
            const [pa, pb] = g.key.split("|");
            return (
              <div
                className={`exch${isRebuttal ? " rebuttal" : ""}`}
                key={gi}
                onMouseEnter={() => setHovered(g.items[0].from)}
                onMouseLeave={() => setHovered(null)}
              >
                {isRebuttal ? (
                  <div className="exch-head">
                    <span style={{ color: `var(--${pa})` }}>{shortName(pa)}</span>
                    <span className="arrow rb">⇄ rebuttal ⇄</span>
                    <span style={{ color: `var(--${pb})` }}>{shortName(pb)}</span>
                  </div>
                ) : (
                  <div className="exch-head">
                    <span style={{ color: `var(--${g.items[0].from})` }}>{shortName(g.items[0].from)}</span>
                    <span className="arrow">▸ challenges ▸</span>
                    <span style={{ color: `var(--${g.items[0].to})` }}>{shortName(g.items[0].to)}</span>
                  </div>
                )}
                {g.items.map((x, xi) => (
                  <div className="exch-line" key={xi}>
                    {isRebuttal && (
                      <span className="who" style={{ color: `var(--${x.from})` }}>
                        {shortName(x.from)}:
                      </span>
                    )}
                    <span className="exch-body">“{x.text}”</span>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function CardImage({ image, name }: { image?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  // image may be a bare Arweave tx id or a full URL.
  const src = image
    ? /^https?:\/\//.test(image)
      ? image
      : `https://arweave.net/${image}`
    : null;
  if (!src || failed) {
    return <div className="card-img placeholder">◈</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="card-img" src={src} alt={name} onError={() => setFailed(true)} />
  );
}

function CardHeader({ card }: { card: Card }) {
  const buy = fromMicro(card.pricing?.buyPrice);
  // Show the reward on its actual rail: CASH cards pay in dollars (potentialPrize),
  // not points, so "0 PTS" was hiding the real prize.
  const rail = (card.prizeType ?? card.event?.kind ?? "").toUpperCase();
  const cash = fromMicro(card.potentialPrize ?? card.prizeAmount);
  const points = fromMicro(card.pointsValue);
  const reward =
    rail === "CASH" && cash != null
      ? `$${cash.toFixed(2)}`
      : points != null
        ? `${points} PTS`
        : null;
  return (
    <div className="card-header">
      <CardImage image={card.image} name={card.name} />
      <div>
        <div className="name">{card.name}</div>
        <div className="meta">
          {card.rarity && <span className="pill">{card.rarity}</span>}
          {card.event?.status && <span className="pill">{card.event.status}</span>}
          {card.event?.name && <span>{card.event.name}</span>}
          {card.event?.eventDate && (
            <span>· {new Date(card.event.eventDate).toLocaleDateString()}</span>
          )}
          {reward && <span>· {reward}</span>}
          {buy != null && (
            <span>· BUY {buy} {card.pricing?.currency ?? "GOLD"}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Verdict({ text }: { text: string }) {
  // Pull the number from the "Final probability" section if present; else first %.
  const section = text.match(/final probability[^\n]*\n+[^\d]*?(\d{1,3})\s*%/i);
  const heroMatch = section ?? text.match(/(\d{1,3})\s*%/);
  const hero = heroMatch ? heroMatch[1] : null;

  return (
    <div className="verdict">
      {hero && (
        <div className="hero">
          <div className="num">
            {hero}
            <small>%</small>
          </div>
          <div className="label">
            COUNCIL
            <br />
            WIN PROBABILITY
          </div>
        </div>
      )}
      <div className="verdict-md">
        <Markdown source={text} />
      </div>
    </div>
  );
}

// Other council members, keyed by the distinctive word in their name → color id.
const MENTIONS: Record<string, string> = {
  Quant: "quant",
  Insider: "insider",
  Contrarian: "contrarian",
  Sharp: "sharp",
  Newshound: "newshound",
};
const MENTION_RE = /\b(Quant|Insider|Contrarian|Sharp|Newshound)\b/g;

// Wrap mentions of other pilots so you can see who is debating whom.
function mentionize(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={`${keyBase}-mn${i}`} className="mention" style={{ ["--xc" as string]: `var(--${MENTIONS[m[1]]})` }}>
        {m[1]}
      </span>
    );
    last = MENTION_RE.lastIndex;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Inline tokens: **bold**, `code`, [text](url), plus optional pilot mentions.
function inline(text: string, keyBase: string, mentions = false): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const push = (s: string, k: string) => (mentions ? out.push(...mentionize(s, k)) : out.push(s));
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index), `${keyBase}-t${i}`);
    if (m[2] !== undefined) out.push(<strong key={`${keyBase}-${i}`}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<code key={`${keyBase}-${i}`}>{m[3]}</code>);
    else if (m[4] !== undefined)
      out.push(
        <a key={`${keyBase}-${i}`} href={m[5]} target="_blank" rel="noopener noreferrer">
          {m[4]}
        </a>
      );
    last = re.lastIndex;
    i++;
  }
  if (last < text.length) push(text.slice(last), `${keyBase}-tend`);
  return out;
}

const isTableRow = (l: string) => /\|/.test(l) && /\S/.test(l.replace(/\|/g, ""));
const isTableSep = (l: string) => /^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(l);
const cells = (l: string) =>
  l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

// Lightweight markdown: headings, bullets, tables, paragraphs + inline tokens.
function Markdown({ source, mentions = false }: { source: string; mentions?: boolean }) {
  const lines = source.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let table: string[] = [];

  const flushList = (k: string) => {
    if (!list.length) return;
    blocks.push(
      <ul key={k}>
        {list.map((li, i) => (
          <li key={i}>{inline(li, `${k}-${i}`, mentions)}</li>
        ))}
      </ul>
    );
    list = [];
  };
  const flushTable = (k: string) => {
    if (!table.length) return;
    const rows = table.filter((l) => !isTableSep(l)).map(cells);
    const [head, ...body] = rows;
    blocks.push(
      <table key={k}>
        {head && (
          <thead>
            <tr>{head.map((c, i) => <th key={i}>{inline(c, `${k}h${i}`, mentions)}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `${k}${ri}-${ci}`, mentions)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    );
    table = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (isTableRow(line)) {
      flushList(`l${idx}`);
      table.push(line);
      return;
    }
    flushTable(`t${idx}`);
    if (/^#{1,6}\s/.test(line)) {
      flushList(`l${idx}`);
      blocks.push(<h2 key={idx}>{inline(line.replace(/^#{1,6}\s/, ""), `h${idx}`, mentions)}</h2>);
    } else if (/^\s*[-*]\s/.test(line)) {
      list.push(line.replace(/^\s*[-*]\s/, ""));
    } else if (/^\s*---+\s*$/.test(line)) {
      flushList(`l${idx}`);
    } else if (line.trim() === "") {
      flushList(`l${idx}`);
    } else {
      flushList(`l${idx}`);
      blocks.push(<p key={idx}>{inline(line, `p${idx}`, mentions)}</p>);
    }
  });
  flushList("lend");
  flushTable("tend");

  return <>{blocks}</>;
}
