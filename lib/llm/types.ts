// Provider-agnostic contract for running one agent turn.
//
// The council doesn't care whether a turn runs on the Claude subscription
// (Claude Agent SDK) or a ChatGPT/Codex subscription (Codex SDK) — it just
// needs streamed text, optional reasoning, tool-activity callbacks, and the
// final text back. Each provider implements `LlmRunner`.

export type Provider = "claude" | "codex";

/** Logical role — each provider maps this to a concrete model. */
export type LlmRole = "expert" | "synth";

export interface RunRequest {
  role: LlmRole;
  /** System / persona instructions for the turn. */
  system: string;
  /** The user prompt. */
  prompt: string;
  /** Whether this turn may use web search. */
  webSearch: boolean;
  /** Soft cap on agent turns (Claude honours this; Codex manages its own). */
  maxTurns: number;
  /** Abort the turn (e.g. a per-expert timeout) so one hung agent can't stall the batch. */
  signal?: AbortSignal;
}

/** Token/cost accounting for one completed turn (zeros when a provider can't report it). */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface RunCallbacks {
  /** Streamed assistant text (deltas). */
  onText: (text: string) => void;
  /** Streamed reasoning/thinking, if the provider exposes it. */
  onThink?: (text: string) => void;
  /** Tool activity (web search, shell, etc.) surfaced as live status. */
  onTool?: (tool: string, detail: string) => void;
  /** Token/cost usage for the turn, reported once when the turn completes. */
  onUsage?: (usage: TurnUsage) => void;
}

/** Runs one turn, streaming via callbacks, and resolves with the full final text. */
export type LlmRunner = (req: RunRequest, cb: RunCallbacks) => Promise<string>;
