import type { ChatMessage } from "./clients.ts";
import type { Persona } from "./prompt.ts";

export type Session = {
  id: string;
  persona: Persona;
  history: ChatMessage[];
  /** Aborts the reply that is currently being produced. */
  abort: AbortController | null;
  lastSeen: number;
};

const sessions = new Map<string, Session>();

export function createSession(id: string, persona: Persona): Session {
  const s: Session = { id, persona, history: [], abort: null, lastSeen: Date.now() };
  sessions.set(id, s);
  return s;
}

export function getSession(id: string | null | undefined): Session | undefined {
  if (!id) return undefined;
  const s = sessions.get(id);
  if (s) s.lastSeen = Date.now();
  return s;
}

export function removeSession(id: string): void {
  const s = sessions.get(id);
  s?.abort?.abort();
  sessions.delete(id);
}

/** Forget sessions nobody has touched for `ttlMs` (the browser closed without saying goodbye). */
export function sweepSessions(ttlMs: number, now = Date.now()): number {
  let removed = 0;
  for (const [id, s] of sessions) {
    if (now - s.lastSeen > ttlMs) {
      removeSession(id);
      removed++;
    }
  }
  return removed;
}

export function sessionCount(): number {
  return sessions.size;
}
