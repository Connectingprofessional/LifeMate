import { loadConfig } from "./config.ts";
import { sweepSessions } from "./sessions.ts";

/** One config for the whole server process, plus a janitor for abandoned sessions. */
export const cfg = loadConfig();

const globalWithTimer = globalThis as { __lifemateSweeper?: ReturnType<typeof setInterval> };
if (!globalWithTimer.__lifemateSweeper) {
  globalWithTimer.__lifemateSweeper = setInterval(() => sweepSessions(cfg.sessionTtlMs), 60_000);
  globalWithTimer.__lifemateSweeper.unref?.();
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function ping(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return res.status < 500 ? { ok: true, detail: "ok" } : { ok: false, detail: `HTTP ${res.status}` };
  } catch {
    return { ok: false, detail: "not reachable" };
  }
}

/** Checks each backing service so a missing one is named, not guessed at. */
export async function checkServices(): Promise<{ name: string; ok: boolean; detail: string }[]> {
  const checks: [string, string][] = [
    ["Avatar video", `${cfg.liveTalkingUrl}/`],
    ["Language model", `${cfg.llmBaseUrl}/models`],
    ["Speech-to-text", `${cfg.sttBaseUrl}/models`],
    ["Text-to-speech", `${cfg.ttsBaseUrl}/audio/voices`],
  ];
  return Promise.all(checks.map(async ([name, url]) => ({ name, ...(await ping(url)) })));
}
