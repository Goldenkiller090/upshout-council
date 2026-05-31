import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { RunRequest, RunCallbacks } from "./types";

// Model aliases resolve against your Claude subscription via the local CLI.
function model(role: RunRequest["role"]): string {
  return role === "synth"
    ? process.env.CLAUDE_SYNTH_MODEL ?? "opus"
    : process.env.CLAUDE_EXPERT_MODEL ?? "sonnet";
}

/** Summarize a tool call's input into a short human label. */
function toolDetail(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "WebSearch") return String(i.query ?? "");
  if (name === "WebFetch") return String(i.url ?? "");
  const s = JSON.stringify(i);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

/**
 * Run one Claude Agent SDK query, forwarding streamed deltas. Uses the local
 * Claude subscription (the `claude` CLI login); WebSearch/WebFetch run headless
 * (permissions bypassed for this trusted local app).
 */
export async function runClaude(req: RunRequest, cb: RunCallbacks): Promise<string> {
  const options: Options = {
    systemPrompt: req.system,
    model: model(req.role),
    allowedTools: req.webSearch ? ["WebSearch", "WebFetch"] : [],
    includePartialMessages: true,
    maxTurns: req.maxTurns,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    // Don't inherit the user's CLAUDE.md / settings — keep runs isolated.
    settingSources: [],
  };

  let streamed = "";
  let finalText = "";

  for await (const message of query({ prompt: req.prompt, options })) {
    if (message.type === "stream_event") {
      const ev = message.event as {
        type: string;
        delta?: { type?: string; text?: string; thinking?: string };
      };
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
        streamed += ev.delta.text;
        cb.onText(ev.delta.text);
      } else if (
        ev.type === "content_block_delta" &&
        ev.delta?.type === "thinking_delta" &&
        ev.delta.thinking
      ) {
        cb.onThink?.(ev.delta.thinking);
      }
    } else if (message.type === "assistant") {
      // Surface tool use (web searches/fetches) as live activity.
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          cb.onTool?.(block.name, toolDetail(block.name, block.input));
        }
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") finalText = message.result;
    }
  }

  return finalText.trim() || streamed.trim();
}
