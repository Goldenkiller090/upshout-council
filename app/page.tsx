"use client";

import { useRef, useState } from "react";
import type { Card, CouncilEvent } from "@/lib/types";
import { EXPERTS } from "@/lib/experts";
import { fromMicro } from "@/lib/upshot";

type ExpertState = { round1: string; round2: string; active: boolean };

// Pull the latest probability + lean an expert committed to (round 2 wins over round 1).
function readout(st?: ExpertState): { prob: number | null; lean: string | null } {
  const text = `${st?.round1 ?? ""}\n${st?.round2 ?? ""}`;
  const probs = [...text.matchAll(/PROBABILITY:\s*(\d{1,3})/gi)];
  const leans = [...text.matchAll(/LEAN:\s*(BUY|HOLD|PASS)/gi)];
  const prob = probs.length ? Math.min(100, parseInt(probs[probs.length - 1][1], 10)) : null;
  const lean = leans.length ? leans[leans.length - 1][1].toUpperCase() : null;
  return { prob, lean };
}

export default function Home() {
  const [input, setInput] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [experts, setExperts] = useState<Record<string, ExpertState>>({});
  const [verdict, setVerdict] = useState("");
  const fetching = useRef(false);

  function resetRun() {
    setExperts(
      Object.fromEntries(
        EXPERTS.map((e) => [e.id, { round1: "", round2: "", active: false }])
      )
    );
    setVerdict("");
    setError("");
    setStatus("");
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
        break;
      case "expert_start":
        setExperts((prev) => ({
          ...prev,
          [ev.expertId]: { ...prev[ev.expertId], active: true },
        }));
        break;
      case "delta":
        setExperts((prev) => {
          const cur = prev[ev.expertId] ?? { round1: "", round2: "", active: true };
          const key = ev.round === 1 ? "round1" : "round2";
          return { ...prev, [ev.expertId]: { ...cur, [key]: cur[key] + ev.text } };
        });
        break;
      case "expert_done":
        setExperts((prev) => ({
          ...prev,
          [ev.expertId]: { ...prev[ev.expertId], active: false },
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

      {card && (
        <>
          <div className="section-label">PILOT GRID · 05</div>
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

                  {st?.round1 && (
                    <>
                      <div className="round-tag">
                        ROUND 1 · <b>RESEARCH</b>
                      </div>
                      <div className="body md-sm">
                        <Markdown source={st.round1} />
                      </div>
                    </>
                  )}
                  {st?.round2 && (
                    <>
                      <div className="round-tag">
                        ROUND 2 · <b>DEBATE</b>
                      </div>
                      <div className="body md-sm">
                        <Markdown source={st.round2} />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {verdict && <Verdict text={verdict} />}

      {card && (
        <div className="foot">
          UPSHOUT COUNCIL <b>//</b> NOT FINANCIAL ADVICE <b>//</b> IT&apos;S JUST NUMBERS
        </div>
      )}
    </div>
  );
}

function CardHeader({ card }: { card: Card }) {
  const buy = fromMicro(card.pricing?.buyPrice);
  const points = fromMicro(card.pointsValue);
  return (
    <div className="card-header">
      {card.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://arweave.net/${card.image}`} alt={card.name} />
      )}
      <div>
        <div className="name">{card.name}</div>
        <div className="meta">
          {card.rarity && <span className="pill">{card.rarity}</span>}
          {card.event?.status && <span className="pill">{card.event.status}</span>}
          {card.event?.name && <span>{card.event.name}</span>}
          {card.event?.eventDate && (
            <span>· {new Date(card.event.eventDate).toLocaleDateString()}</span>
          )}
          {points != null && <span>· {points} PTS</span>}
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

// Inline tokens: **bold**, `code`, [text](url).
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
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
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l: string) => /\|/.test(l) && /\S/.test(l.replace(/\|/g, ""));
const isTableSep = (l: string) => /^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(l);
const cells = (l: string) =>
  l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

// Lightweight markdown: headings, bullets, tables, paragraphs + inline tokens.
function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let table: string[] = [];

  const flushList = (k: string) => {
    if (!list.length) return;
    blocks.push(
      <ul key={k}>
        {list.map((li, i) => (
          <li key={i}>{inline(li, `${k}-${i}`)}</li>
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
            <tr>{head.map((c, i) => <th key={i}>{inline(c, `${k}h${i}`)}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `${k}${ri}-${ci}`)}</td>)}</tr>
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
      blocks.push(<h2 key={idx}>{inline(line.replace(/^#{1,6}\s/, ""), `h${idx}`)}</h2>);
    } else if (/^\s*[-*]\s/.test(line)) {
      list.push(line.replace(/^\s*[-*]\s/, ""));
    } else if (/^\s*---+\s*$/.test(line)) {
      flushList(`l${idx}`);
    } else if (line.trim() === "") {
      flushList(`l${idx}`);
    } else {
      flushList(`l${idx}`);
      blocks.push(<p key={idx}>{inline(line, `p${idx}`)}</p>);
    }
  });
  flushList("lend");
  flushTable("tend");

  return <>{blocks}</>;
}
