import type { ThreadItem } from "@openai/codex-sdk";
import type { RunRequest, RunCallbacks } from "./types";

// Codex runs against a ChatGPT subscription via the local `codex` CLI login
// (run `codex login` once). Models differ from Claude's aliases.
function model(role: RunRequest["role"]): string {
  return role === "synth"
    ? process.env.CODEX_SYNTH_MODEL ?? "gpt-5-codex"
    : process.env.CODEX_EXPERT_MODEL ?? "gpt-5-codex";
}

/**
 * Run one Codex turn via the Codex SDK, mapping its JSONL event stream onto the
 * provider callbacks. Codex has no separate system-prompt field, so the persona
 * is prepended to the prompt. Runs read-only and never prompts for approval.
 */
export async function runCodex(req: RunRequest, cb: RunCallbacks): Promise<string> {
  // Dynamic import so Claude-only deployments never load the Codex binary.
  const { Codex } = await import("@openai/codex-sdk");
  const codex = new Codex();

  const thread = codex.startThread({
    model: model(req.role),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    workingDirectory: process.cwd(),
    networkAccessEnabled: req.webSearch,
    webSearchEnabled: req.webSearch,
    webSearchMode: req.webSearch ? "live" : "disabled",
    ...(process.env.CODEX_REASONING_EFFORT
      ? { modelReasoningEffort: process.env.CODEX_REASONING_EFFORT as never }
      : {}),
  });

  const prompt = `${req.system}\n\n========================================\nTASK:\n${req.prompt}`;

  // Streamed items arrive as whole or growing blocks (started → updated →
  // completed), so we emit only the delta beyond what we've already sent per id.
  const sent = new Map<string, number>();
  const toolFired = new Set<string>();
  const completed = new Map<string, string>();

  const pushDelta = (id: string, full: string, fn?: (t: string) => void) => {
    if (!fn) return;
    const prev = sent.get(id) ?? 0;
    if (full.length > prev) {
      fn(full.slice(prev));
      sent.set(id, full.length);
    }
  };

  const handle = (item: ThreadItem) => {
    switch (item.type) {
      case "agent_message":
        completed.set(item.id, item.text);
        pushDelta(item.id, item.text, cb.onText);
        break;
      case "reasoning":
        pushDelta(item.id, item.text, cb.onThink);
        break;
      case "web_search":
        if (!toolFired.has(item.id)) {
          toolFired.add(item.id);
          cb.onTool?.("WebSearch", item.query);
        }
        break;
      case "command_execution":
        if (!toolFired.has(item.id)) {
          toolFired.add(item.id);
          cb.onTool?.("Shell", item.command);
        }
        break;
    }
  };

  const { events } = await thread.runStreamed(prompt, { signal: req.signal });
  for await (const ev of events) {
    if (ev.type === "item.started" || ev.type === "item.updated" || ev.type === "item.completed") {
      handle(ev.item);
    } else if (ev.type === "turn.completed") {
      // Codex reports token usage per turn (no cost — subscription-billed).
      const u = (ev as { usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number } }).usage;
      if (u) {
        cb.onUsage?.({
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.cached_input_tokens ?? 0,
          cacheCreationTokens: 0,
          costUsd: 0,
        });
      }
    } else if (ev.type === "turn.failed") {
      throw new Error(ev.error?.message ?? "Codex turn failed");
    } else if (ev.type === "error") {
      throw new Error(ev.message);
    }
  }

  // Final text = the agent's message(s), in completion order.
  return Array.from(completed.values()).join("\n").trim();
}
