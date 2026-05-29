// Dev driver: run the real council end-to-end on a synthetic-but-researchable card.
// Usage: npx tsx scripts/run-council.ts
import { runCouncil } from "../lib/council";
import type { Card, CouncilEvent } from "../lib/types";

const card: Card = {
  id: "cmTESTeth4000jun2026demo",
  name: "Ethereum Closes Above $4,000 on June 30, 2026",
  rarity: "RARE",
  maxSupply: 334,
  pointsValue: "86000000", // 86 pts
  outcomeId: "outcome-yes",
  event: {
    name: "ETH Price — End of June 2026",
    status: "ACTIVE",
    kind: "SKILL",
    eventDate: "2026-06-30T00:00:00.000Z",
    pricePerCard: "1890000", // 1.89 GOLD
    winningOutcomeId: null,
    resolvedAt: null,
  },
  pricing: {
    currency: "GOLD",
    buyPrice: "5910000", // 5.91 GOLD
    sellPrice: "5000000",
    shopkeeperBalance: "12",
    isTradeable: true,
  },
};

const expertText: Record<string, { r1: string; r2: string }> = {};
let verdict = "";

const emit = (ev: CouncilEvent) => {
  switch (ev.type) {
    case "status":
      process.stderr.write(`\n=== ${ev.phase.toUpperCase()}: ${ev.message} ===\n`);
      break;
    case "expert_start":
      process.stderr.write(`  ▸ R${ev.round} ${ev.name} started\n`);
      break;
    case "delta": {
      const k = ev.expertId;
      expertText[k] ??= { r1: "", r2: "" };
      if (ev.round === 1) expertText[k].r1 += ev.text;
      else expertText[k].r2 += ev.text;
      break;
    }
    case "expert_done":
      process.stderr.write(`  ✓ R${ev.round} ${ev.expertId} done\n`);
      break;
    case "verdict_delta":
      verdict += ev.text;
      break;
    case "error":
      process.stderr.write(`\n!! ERROR: ${ev.message}\n`);
      break;
    case "done":
      process.stderr.write(`\n=== DONE ===\n`);
      break;
  }
};

async function main() {
  const start = Date.now();
  await runCouncil(card, emit);

  // Print readable transcript to stdout.
  console.log("\n\n############ COUNCIL TRANSCRIPT ############");
  console.log(`Card: ${card.name}\n`);
  for (const [id, t] of Object.entries(expertText)) {
    console.log(`\n========== ${id.toUpperCase()} ==========`);
    console.log("--- ROUND 1 ---\n" + t.r1.trim());
    console.log("\n--- ROUND 2 ---\n" + t.r2.trim());
  }
  console.log("\n\n############ FINAL VERDICT ############\n");
  console.log(verdict.trim());
  console.log(`\n\n(elapsed: ${Math.round((Date.now() - start) / 1000)}s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
