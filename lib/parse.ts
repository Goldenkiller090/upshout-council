// Client-safe parsing helpers (no server deps) shared by the council
// orchestrator and the UI. Robust to the ways models actually format numbers:
// markdown bold (**2**), decimals (2.5), ranges (1–2% / "1 to 3"), tilde (~2).

/** Drop markdown emphasis + tilde so the number regexes can stay simple. */
function deEmphasize(s: string): string {
  return s.replace(/[*_~`]/g, "");
}

const RANGE = /(\d{1,3}(?:\.\d+)?)\s*(?:[-–—]|to)?\s*(\d{1,3}(?:\.\d+)?)?/;

function midpoint(lo: number, hi: number | null): number {
  return Math.max(0, Math.min(100, Math.round(hi != null ? (lo + hi) / 2 : lo)));
}

/** Pull a committed probability + lean from an expert's free text. */
export function extractCall(text: string): { prob: number | null; lean: string | null } {
  const t = deEmphasize(text);
  const probs = [...t.matchAll(new RegExp(`PROBABILITY:\\s*${RANGE.source}`, "gi"))];
  let prob: number | null = null;
  if (probs.length) {
    const m = probs[probs.length - 1]; // last commitment wins (round 2 > round 1)
    prob = midpoint(parseFloat(m[1]), m[2] != null ? parseFloat(m[2]) : null);
  }
  const leans = [...t.matchAll(/LEAN:\s*(BUY|HOLD|PASS)/gi)];
  const lean = leans.length ? leans[leans.length - 1][1].toUpperCase() : null;
  return { prob, lean };
}

/** Pull the headline probability from a synthesizer verdict. */
export function extractVerdictProb(text: string): number | null {
  const t = deEmphasize(text);
  const scan = (s: string): number | null => {
    const m = s.match(new RegExp(`${RANGE.source}\\s*%`));
    return m ? midpoint(parseFloat(m[1]), m[2] != null ? parseFloat(m[2]) : null) : null;
  };
  // Prefer the number in the "Final probability" section.
  const sec = t.match(/final probability[^\n]*\n+([\s\S]{0,160})/i);
  if (sec) {
    const p = scan(sec[1]);
    if (p != null) return p;
  }
  return scan(t);
}
