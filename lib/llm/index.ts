import type { LlmRunner, Provider } from "./types";
import { runClaude } from "./claude";

export type { Provider, LlmRole, RunRequest, RunCallbacks, LlmRunner } from "./types";

/** Which backend the council runs on. Set LLM_PROVIDER=codex to use a ChatGPT sub. */
export function activeProvider(): Provider {
  return (process.env.LLM_PROVIDER ?? "claude").toLowerCase() === "codex"
    ? "codex"
    : "claude";
}

/** Human label for the active provider, for status lines. */
export function providerLabel(): string {
  return activeProvider() === "codex" ? "Codex (ChatGPT)" : "Claude";
}

/** Dispatch one agent turn to the active provider. */
export const runAgent: LlmRunner = async (req, cb) => {
  if (activeProvider() === "codex") {
    // Lazy-load so Claude-only setups never touch the Codex SDK/binary.
    const { runCodex } = await import("./codex");
    return runCodex(req, cb);
  }
  return runClaude(req, cb);
};
