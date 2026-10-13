import { chatStream, ltSendAudio, synthesize, transcribe } from "./clients.ts";
import type { ChatMessage } from "./clients.ts";
import type { SelfhostConfig } from "./config.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { SentenceChunker } from "./sentences.ts";
import type { Session } from "./sessions.ts";

export type TurnEvent =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "ignored" }
  | { type: "done" }
  | { type: "error"; message: string };

export type TurnInput = { wav: Uint8Array } | { text: string };

type Item = { text: string; audio: Promise<Uint8Array> } | { error: unknown } | null;

/** Tiny async queue: one producer pushes, one consumer awaits. */
class AsyncQueue<T> {
  private items: T[] = [];
  private waiter: ((v: T) => void) | null = null;
  push(v: T) {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(v);
    } else {
      this.items.push(v);
    }
  }
  next(): Promise<T> {
    const first = this.items.shift();
    if (first !== undefined) return Promise.resolve(first);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

const hasContent = (s: string) => /[\p{L}\p{N}]/u.test(s);

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * One spoken (or typed) turn: listen -> think -> speak.
 * Each finished sentence is voiced and handed to the avatar immediately, so the
 * avatar starts answering while the model is still writing.
 *
 * Starting a new turn cancels the one in flight (that is how barge-in works).
 */
export async function* runTurn(
  cfg: SelfhostConfig,
  session: Session,
  input: TurnInput,
): AsyncGenerator<TurnEvent> {
  session.abort?.abort();
  const ctl = new AbortController();
  session.abort = ctl;
  const { signal } = ctl;
  const { persona } = session;
  const spoken: string[] = [];

  try {
    const userText =
      "text" in input
        ? input.text.trim().slice(0, 2000)
        : await transcribe(cfg, input.wav, persona.language, signal);
    if (signal.aborted) return;
    if (!hasContent(userText)) {
      yield { type: "ignored" };
      return;
    }
    yield { type: "user", text: userText };

    session.history.push({ role: "user", content: userText });
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(persona) },
      ...session.history.slice(-cfg.maxHistory),
    ];

    const queue = new AsyncQueue<Item>();
    void (async () => {
      try {
        const chunker = new SentenceChunker();
        const enqueue = (text: string) => {
          const audio = synthesize(cfg, text, persona.voice, signal);
          audio.catch(() => undefined); // surfaced when the consumer awaits it
          queue.push({ text, audio });
        };
        for await (const piece of chatStream(cfg, messages, signal)) {
          for (const s of chunker.push(piece)) enqueue(s);
        }
        for (const s of chunker.flush()) enqueue(s);
        queue.push(null);
      } catch (e) {
        queue.push({ error: e });
      }
    })();

    for (;;) {
      const item = await queue.next();
      if (item === null) break;
      if ("error" in item) throw item.error;
      const wav = await item.audio;
      if (signal.aborted) return;
      await ltSendAudio(cfg, session.id, wav, signal);
      spoken.push(item.text);
      yield { type: "assistant", text: item.text };
    }

    if (!spoken.length) throw new Error("Language model: returned an empty answer.");
    yield { type: "done" };
  } catch (e) {
    if (signal.aborted) return;
    yield { type: "error", message: errorMessage(e) };
  } finally {
    // Remember only what was actually said, even if the turn was cut short.
    if (spoken.length) session.history.push({ role: "assistant", content: spoken.join(" ") });
    if (session.abort === ctl) session.abort = null;
  }
}
